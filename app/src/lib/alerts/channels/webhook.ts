/**
 * Custom webhook channel — POSTs the alert payload as JSON to a
 * user-configured URL with optional custom headers.
 *
 * Use cases: PagerDuty Events API, Datadog webhooks, custom internal
 * services. No opinion on payload shape — caller decides via the
 * headers (e.g., `Authorization: Bearer <token>`).
 *
 * Spec: spec/alerts.md §3.2.3 (channels/webhook.ts).
 */
import type { AlertDeliveryResult } from '../types';
import { validateOutboundUrl, OutboundUrlError } from '@/lib/security/validate-connection';

export interface SendWebhookAlertParams {
  url: string;
  headers?: Record<string, string>;
  payload: WebhookPayload;
}

export interface WebhookPayload {
  alertName: string;
  dashboardTitle: string;
  breachedValue: number | string | null;
  threshold: number | string;
  correlationId: string;
  firedAt: string;
}

export async function sendWebhookAlert(
  params: SendWebhookAlertParams,
): Promise<AlertDeliveryResult> {
  // T3/T6 — SSRF guard. The target is user-supplied and this runs a
  // server-side request, so validate here and not only in the API schema:
  // rules persisted before validation existed would otherwise still fire.
  // A blocked target returns a delivery failure rather than throwing, so a
  // bad rule cannot break the whole alert pipeline.
  let target: string;
  try {
    target = validateOutboundUrl(params.url).toString();
  } catch (error) {
    const reason = error instanceof OutboundUrlError ? error.message : 'invalid webhook URL';
    return { channelType: 'webhook', status: 'failed', error: reason };
  }

  try {
    const res = await fetch(target, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(params.headers ?? {}),
      },
      body: JSON.stringify(params.payload),
      // Do not chase a 302 into the private range: a public URL that
      // redirects to 169.254.169.254 is the same attack with an extra hop.
      redirect: 'manual',
    });
    if (!res.ok) {
      return {
        channelType: 'webhook',
        status: 'failed',
        error: `Webhook ${res.status}: ${await safeText(res)}`,
      };
    }
    return { channelType: 'webhook', status: 'success' };
  } catch (err) {
    return {
      channelType: 'webhook',
      status: 'failed',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '<unreadable response body>';
  }
}
