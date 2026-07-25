import { Resend } from 'resend';
import type { EmailProvider, EmailMessage, EmailResult, EmailProviderType } from './types';
import { MockEmailProvider } from './mock';

export class ResendProvider implements EmailProvider {
  type = 'resend' as const;
  private client: Resend;

  constructor(apiKey: string) {
    this.client = new Resend(apiKey);
  }

  async send(message: EmailMessage): Promise<EmailResult> {
    const result = await this.client.emails.send({
      from: message.from || 'dash-bi <noreply@dash-bi.com>',
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
      replyTo: message.replyTo,
    });

    if (result.error) {
      throw new Error(`Email send error: ${result.error.message}`);
    }

    return {
      id: result.data?.id || 'unknown',
      provider: 'resend',
    };
  }
}

let providerInstance: EmailProvider | null = null;

export function getEmailProvider(): EmailProvider {
  if (providerInstance) return providerInstance;

  const providerType = (process.env.EMAIL_PROVIDER as EmailProviderType) || 'resend';
  const apiKey = process.env.RESEND_API_KEY;

  if (providerType === 'resend' && apiKey && apiKey !== 're_mock_key') {
    providerInstance = new ResendProvider(apiKey);
  } else {
    providerInstance = new MockEmailProvider();
  }
  return providerInstance;
}

export async function sendEmail(message: EmailMessage): Promise<EmailResult> {
  const provider = getEmailProvider();
  return provider.send(message);
}

/** Reset singleton — used by tests to swap providers between cases. */
export function _resetEmailProvider(): void {
  providerInstance = null;
}

export { MockEmailProvider };
