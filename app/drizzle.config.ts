import type { Config } from 'drizzle-kit';

/**
 * Reads the owner connection straight from `process.env` instead of the app's
 * `getEnv()`.
 *
 * This config is executed by drizzle-kit in its own Node process, not inside
 * the Next.js runtime, so importing `@/lib/env` bought nothing and cost a
 * dependency on the whole `src/` tree being present: the migration container
 * ships only the SQL, and `drizzle-kit` died with
 * `Cannot find module '@/lib/env'` because the alias had nothing to resolve to.
 *
 * The app's Zod schema validates the *server runtime* environment (secrets,
 * URLs, feature flags). The only variable a migration needs is the owner URL,
 * and failing loudly on its absence below is the whole check.
 */
const migrationUrl = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL;

if (!migrationUrl) {
  throw new Error(
    'DATABASE_MIGRATION_URL (or DATABASE_URL) is required to run migrations',
  );
}

export default {
  schema: './src/db/schema.ts',
  out: './drizzle/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    // Migrations must run as the OWNER role, not as the app role.
    //
    // HIGH-5: the app role is NOSUPERUSER NOBYPASSRLS so RLS actually applies.
    // That means it is not the table owner, so every table needs explicit
    // GRANTs — which the owner role issues through ALTER DEFAULT PRIVILEGES.
    // Migrating with DATABASE_URL would create tables owned by the app role and
    // quietly hand the RLS policies back to a role that can bypass them.
    url: migrationUrl,
  },
  strict: true,
  verbose: true,
} satisfies Config;