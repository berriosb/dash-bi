export type EmailMessage = {
  to: string | string[];
  from?: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  tags?: Record<string, string>;
  metadata?: Record<string, unknown>;
};

export type EmailProviderType = 'resend' | 'postmark' | 'ses' | 'nodemailer';

export type EmailResult = {
  id: string;
  provider: EmailProviderType;
};

export interface EmailProvider {
  type: EmailProviderType;
  send(message: EmailMessage): Promise<EmailResult>;
}
