import * as Sentry from '@sentry/nextjs';

const SENTRY_DSN = process.env.SENTRY_DSN;
const SENTRY_ENVIRONMENT = process.env.SENTRY_ENVIRONMENT || 'development';

// Solo inicializar si hay DSN configurado
if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: SENTRY_ENVIRONMENT,

    // Performance monitoring
    tracesSampleRate: SENTRY_ENVIRONMENT === 'production' ? 0.1 : 1.0,

    // Profiling
    profilesSampleRate: SENTRY_ENVIRONMENT === 'production' ? 0.1 : 1.0,

    // Filtrar errores de salud y healthcheck
    beforeSendTransaction(event) {
      if (event.transaction === '/api/health') return null;
      return event;
    },

    // No loguear en dev (ruido)
    enabled: SENTRY_ENVIRONMENT !== 'development',

    // Errores que ignoramos (típico de bots/scanners)
    ignoreErrors: [
      'NEXT_NOT_FOUND',
      'NEXT_REDIRECT',
      'ECONNRESET',
    ],
  });
}