import { z } from 'zod';

// Validación runtime de env vars con Zod
// Falla rápido en boot si falta algo crítico

const envSchema = z.object({
  // App
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  NEXT_PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  PORT: z.coerce.number().int().positive().default(3000),

  // Database
  DATABASE_URL: z.string().url(),
  DATABASE_READONLY_URL: z.string().url(),

  // Redis
  REDIS_URL: z.string().url(),

  // Auth
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().url(),

  // Google OAuth
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().url().optional(),

  // Email
  EMAIL_PROVIDER: z.enum(['resend', 'postmark', 'ses', 'nodemailer']).default('resend'),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default('dash-bi <noreply@dash-bi.com>'),

  // Encryption (32 bytes hex = 64 chars)
  LLM_KEY_ENCRYPTION_KEY: z.string().regex(/^[a-f0-9]{64}$/i, 'Must be 32 bytes hex'),

  // PDF Worker
  PDF_WORKER_URL: z.string().url().default('http://pdf-worker:3001'),
  PDF_WORKER_SECRET: z.string().min(16),
  PUPPETEER_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  PUPPETEER_MAX_CONCURRENT: z.coerce.number().int().positive().default(3),

  // Sentry
  SENTRY_DSN: z.string().url().optional(),
  SENTRY_ENVIRONMENT: z.string().default('development'),
});

function parseEnv() {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('❌ Invalid environment variables:');
    console.error(parsed.error.flatten().fieldErrors);
    throw new Error('Invalid environment variables. See logs above.');
  }
  return parsed.data;
}

// Singleton: valida una sola vez en boot
let cached: z.infer<typeof envSchema> | null = null;

export function getEnv() {
  if (!cached) {
    cached = parseEnv();
  }
  return cached;
}

export type Env = z.infer<typeof envSchema>;