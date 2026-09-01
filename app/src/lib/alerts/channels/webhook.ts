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
  try {
    const res = await fetch(params.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(params.headers ?? {}),
      },
      body: JSON.stringify(params.payload),
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
