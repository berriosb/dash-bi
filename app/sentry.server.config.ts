import * as Sentry from '@sentry/nextjs';

const SENTRY_DSN = process.env.SENTRY_DSN;
const SENTRY_ENVIRONMENT = process.env.SENTRY_ENVIRONMENT || 'development';

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: SENTRY_ENVIRONMENT,

    tracesSampleRate: SENTRY_ENVIRONMENT === 'production' ? 0.1 : 1.0,
    profilesSampleRate: SENTRY_ENVIRONMENT === 'production' ? 0.1 : 1.0,

    beforeSendTransaction(event) {
      if (event.transaction === '/api/health') return null;
      return event;
    },

    enabled: SENTRY_ENVIRONMENT !== 'development',

    ignoreErrors: ['NEXT_NOT_FOUND', 'NEXT_REDIRECT', 'ECONNRESET'],
  });
}