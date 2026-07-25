import type { EmailProvider, EmailMessage, EmailResult, EmailProviderType } from './types';
import { logger } from '@/lib/logger';

/**
 * Noop / mock email provider used when no real provider is configured
 * (development without API keys, tests, CI dry-runs).
 *
 * Logs every outgoing email at info level and returns a synthetic id.
 * Never throws — the rest of the auth/signup flow must not depend on email.
 */
export class MockEmailProvider implements EmailProvider {
  type: EmailProviderType = 'mock';

  async send(message: EmailMessage): Promise<EmailResult> {
    const recipients = Array.isArray(message.to) ? message.to.join(', ') : message.to;
    logger.info(
      {
        provider: 'mock',
        to: recipients,
        subject: message.subject,
        htmlLength: message.html.length,
        tags: message.tags,
      },
      '[email:mock] would send email',
    );
    return {
      id: `mock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      provider: 'mock',
    };
  }
}