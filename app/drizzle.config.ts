import type { Config } from 'drizzle-kit';
import { getEnv } from '@/lib/env';

const env = getEnv();

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
    url: env.DATABASE_MIGRATION_URL ?? env.DATABASE_URL,
  },
  strict: true,
  verbose: true,
} satisfies Config;