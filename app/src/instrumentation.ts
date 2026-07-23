// Server-only Sentry instrumentation (Next.js 16 hook)
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('../sentry.server.config');
  }
}