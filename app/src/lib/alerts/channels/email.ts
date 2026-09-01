/**
 * Email channel — delegates to the existing EmailProvider abstraction
 * (lib/email/index.ts). No new email infrastructure is introduced.
 *
 * Spec: spec/alerts.md §3.2.3 (channels/email.ts).
 */
import type { AlertDeliveryResult } from '../types';
import { getEmailProvider } from '@/lib/email';

export interface SendEmailAlertParams {
  recipients: string[];
  subject: string;
  ruleName: string;
  dashboardTitle: string;
  breachedValue: number | string | null;
  threshold: number | string;
  correlationId: string;
}

export async function sendEmailAlert(
  params: SendEmailAlertParams,
): Promise<AlertDeliveryResult> {
  try {
    const provider = getEmailProvider();
    const result = await provider.send({
      to: params.recipients.join(', '),
      subject: params.subject,
      html: buildHtml(params),
      text: buildText(params),
    });
    return {
      channelType: 'email',
      status: 'success',
      providerMessageId: result.id,
    };
  } catch (err) {
    return {
      channelType: 'email',
      status: 'failed',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function buildHtml(p: SendEmailAlertParams): string {
  return `
    <!DOCTYPE html>
    <body style="font-family: -apple-system, system-ui, sans-serif; padding: 40px;">
      <div style="max-width: 600px; margin: 0 auto; background: white; padding: 32px; border-radius: 8px; border: 1px solid #e5e7eb;">
        <h1 style="color: #dc2626; margin: 0 0 16px;">🚨 ${escapeHtml(p.ruleName)}</h1>
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 8px 0; color: #6b7280;">Dashboard:</td>
            <td style="padding: 8px 0;"><strong>${escapeHtml(p.dashboardTitle)}</strong></td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #6b7280;">Valor actual:</td>
            <td style="padding: 8px 0;"><code>${escapeHtml(String(p.breachedValue))}</code></td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #6b7280;">Umbral:</td>
            <td style="padding: 8px 0;"><code>${escapeHtml(String(p.threshold))}</code></td>
          </tr>
        </table>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
        <p style="font-size: 12px; color: #6b7280;">
          correlation: <code>${escapeHtml(p.correlationId)}</code>
        </p>
      </div>
    </body>
  `;
}

function buildText(p: SendEmailAlertParams): string {
  return [
    `🚨 ${p.ruleName}`,
    ``,
    `Dashboard: ${p.dashboardTitle}`,
    `Valor actual: ${p.breachedValue}`,
    `Umbral: ${p.threshold}`,
    ``,
    `correlation: ${p.correlationId}`,
  ].join('\n');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
