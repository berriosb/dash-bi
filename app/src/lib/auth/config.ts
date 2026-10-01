import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { magicLink } from 'better-auth/plugins';
import { db, type Tx } from '@/db/client';
import * as schema from '@/db/schema';
import { orgs, orgMembers } from '@/db/schema';
import { eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { sendEmail } from '@/lib/email';
import { MagicLinkEmail } from './messages';
import { logger } from '@/lib/logger';

function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'org';
}

async function uniqueSlug(tx: Tx, base: string): Promise<string> {
  let candidate = base;
  let suffix = 0;
  // Slug uniqueness is a GLOBAL constraint, not a per-tenant one, so the probe
  // has to see every org. Going through `orgs` directly stopped working once
  // RLS was enabled on it: the provisioning user belongs to no org yet, so the
  // query returned nothing and the new org collided with orgs_slug_idx on
  // someone else's slug. `dashbi_slug_is_taken` (migration 0015) answers the
  // one question this actually needs.
  while (suffix < 50) {
    const rows = await tx.execute(
      sql`SELECT dashbi_slug_is_taken(${candidate}) AS taken`,
    );
    if (!(rows[0] as { taken: boolean }).taken) return candidate;
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }
  return `${base}-${Date.now()}`;
}

async function provisionOrgForUser(
  userId: string,
  email: string,
  displayName?: string | null,
): Promise<string> {
  const seedName = displayName?.trim() || email.split('@')[0] || 'Mi organización';
  const baseSlug = slugify(seedName);

  // The org id is generated here, not by the database, and the INSERT has no
  // RETURNING. Both are load-bearing, and the reason was measured rather than
  // assumed: in PostgreSQL `INSERT ... RETURNING` also evaluates the table's
  // SELECT policy on the row it is about to return, and a row that policy
  // filters makes the whole statement fail with `new row violates row-level
  // security policy` (a message that blames WITH CHECK and points at the wrong
  // policy). A brand-new org has no `org_members` row yet, so `orgs_read` does
  // not match it — asking for the id back is asking to read a row this session
  // cannot read. The alternative, widening `orgs_read` with an
  // `OR id = app_current_org_id()` branch, would re-open the exact id-based
  // hole that made the org switcher return one org instead of N. See
  // migration 0015.
  const orgId = randomUUID();

  // Run the entire provisioning flow inside a single transaction, with the
  // GUCs set explicitly because the RLS policies read them.
  return await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE NONE`);
    // `app.current_org_id` gets the *org* id. It used to be set to the user id,
    // with a comment claiming `org_members_isolation` needed it — but that
    // policy only checks `user_id`, never `org_id`. Meanwhile the `audit_log`
    // insert below is scoped by `org_id = app_current_org_id()`, so the old
    // value only ever worked by accident. The org id is correct for both.
    await tx.execute(
      sql`SELECT set_config('app.current_org_id', ${orgId}, true)`,
    );
    await tx.execute(
      sql`SELECT set_config('app.current_user_id', ${userId}, true)`,
    );
    await tx.execute(
      sql`SELECT set_config('app.current_user_role', ${'admin'}, true)`,
    );

    const slug = await uniqueSlug(tx, baseSlug);

    await tx.insert(orgs).values({
      id: orgId,
      name: seedName,
      slug,
      plan: 'free',
      defaultTheme: 'moderno-saas',
      llmProvider: 'openai',
      llmModel: 'gpt-4o',
    });

    await tx.insert(orgMembers).values({
      orgId,
      userId,
      role: 'admin',
      joinedAt: new Date(),
    });

    await tx
      .update(schema.users)
      .set({ activeOrgId: orgId })
      .where(eq(schema.users.id, userId));

    // Write the audit row inside the same transaction so it is also
    // visible under the same GUCs (audit_log_isolation).
    await tx.insert(schema.auditLog).values({
      orgId,
      userId,
      action: 'org.created',
      resource: `org:${orgId}`,
      metadata: { source: 'signup' },
    });

    return orgId;
  });
}

/**
 * better-auth setup.
 *
 * Sprint 1 v0.2: implementación de `auth.md §3.2`.
 *
 * Features:
 * - Drizzle adapter sobre Postgres (requiere BETTER_AUTH_SECRET >=32 chars)
 * - Email + password con hash seguro (bcrypt o argon2)
 * - requireEmailVerification desde día 1 (recomendado por auditoría)
 * - Magic links passwordless (10 min expiration)
 * - Google OAuth (incluye scopes para Sheets connector)
 * - Custom rate limits por endpoint (login 5/min, signup 3/min, etc.)
 * - Sesiones de 30 días con cookie HTTP-only + Secure (en prod)
 *
 * Ver auth.md §3.2 para la spec completa.
 */
export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      user: schema.users,
      session: schema.sessions,
      account: schema.accounts,
      verification: schema.verifications,
    },
  }),

  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL || 'http://localhost:3000',

  // Sprint 1.5: better-auth's default `generateId` produces 32-char
  // alphanumeric strings (see `@better-auth/utils/random`). Our schema
  // declares `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` so
  // better-auth's string IDs collide with the UUID cast. The cleanest
  // fix is to let Postgres generate the ID via the column's
  // `defaultRandom()` and pass it back through RETURNING.
  advanced: {
    cookiePrefix: 'dashbi',
    useSecureCookies: process.env.NODE_ENV === 'production',
    database: {
      generateId: false,
    },
  },

  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    autoSignIn: false,  // signin solo después de verificar email
    sendResetPassword: async ({ user, url }) => {
      // Importante: NO bloquear signup si email provider caído
      try {
        await sendEmail({
          to: user.email,
          subject: 'Restablecé tu contraseña en dash-bi',
          html: `<p>Hacé click en el siguiente link para restablecer tu contraseña:</p>
                 <p><a href="${url}">Restablecer contraseña</a></p>
                 <p>Si no solicitaste este email, podés ignorarlo.</p>`,
          text: `Restablecé tu contraseña: ${url}`,
        });
      } catch (error) {
        // Logged pero no propagado (T4)
        console.error('sendResetPassword failed:', error);
      }
    },
  },

  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          return { data: user };
        },
        after: async (user) => {
          // Provision org + membership. We use `db.transaction` (not
          // `withSystemContext`) because the better-auth `after` hook
          // runs outside any open transaction. We set the GUCs
          // explicitly so the `org_members_isolation` RLS policy
          // accepts the INSERT.
          try {
            await provisionOrgForUser(user.id, user.email, user.name);
            logger.info({ userId: user.id }, 'organization provisioned for new user');
          } catch (error) {
            logger.error({ err: error, userId: user.id }, 'failed to provision organization for new user');
            throw error;
          }
        },
      },
    },
  },

  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID ?? '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      scope: [
        'openid',
        'email',
        'profile',
        'https://www.googleapis.com/auth/spreadsheets.readonly',
      ],
    },
  },

  plugins: [
    magicLink({
      sendMagicLink: async ({ email, url }) => {
        try {
          const template = MagicLinkEmail(url, 'tu organización');
          await sendEmail({
            to: email,
            subject: template.subject,
            html: template.html,
            text: template.text,
          });
        } catch (error) {
          console.error('sendMagicLink failed:', error);
          // NO throw — signup flow no debe depender de email provider
        }
      },
      expiresIn: 600,  // 10 minutos
    }),
  ],

  session: {
    expiresIn: 60 * 60 * 24 * 30,  // 30 días
    updateAge: 60 * 60 * 24,        // refresh cada 24h
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5,                // 5 minutos
    },
  },

  rateLimit: {
    enabled: true,
    window: 60,  // 1 minuto
    max: 30,     // 30 requests por ventana (global)
    customRules: {
      '/sign-in/email': { window: 60, max: 5 },
      '/sign-up/email': { window: 60, max: 3 },
      '/magic-link/send': { window: 60, max: 3 },
      '/forgot-password': { window: 60, max: 3 },
      '/reset-password': { window: 60, max: 5 },
      '/verify-email': { window: 60, max: 10 },
    },
  },

  // Email verification URL pattern
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      try {
        const { VerifyEmailEmail } = await import('./messages');
        const template = VerifyEmailEmail(url);
        await sendEmail({
          to: user.email,
          subject: template.subject,
          html: template.html,
          text: template.text,
        });
      } catch (error) {
        console.error('sendVerificationEmail failed:', error);
      }
    },
  },
});

export type Auth = typeof auth;