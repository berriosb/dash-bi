import type { Config } from 'drizzle-kit';
import { getEnv } from '@/lib/env';

const env = getEnv();

export default {
  schema: './src/db/schema.ts',
  out: './drizzle/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: env.DATABASE_URL,
  },
  strict: true,
  verbose: true,
} satisfies Config;