// Server-only Sentry instrumentation (Next.js 16 hook)
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    if (process.env.NODE_ENV === 'production' && process.env.DATABASE_URL) {
      const { getEnv } = await import('@/lib/env');
      getEnv();
    }
    await import('../sentry.server.config');
  }
}