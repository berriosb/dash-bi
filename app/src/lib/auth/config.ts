import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { magicLink } from 'better-auth/plugins';
import { db } from '@/db/client';
import * as schema from '@/db/schema';
import { sendEmail } from '@/lib/email';
import { MagicLinkEmail } from './messages';

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
      // account + verification usan tablas de better-auth, no necesitamos custom
    },
  }),

  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL || 'http://localhost:3000',

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

  advanced: {
    cookiePrefix: 'dashbi',
    useSecureCookies: process.env.NODE_ENV === 'production',
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