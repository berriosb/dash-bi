/**
 * Slack channel — POSTs a Block Kit message to a Slack incoming webhook URL.
 *
 * Spec: spec/alerts.md §3.2.3
 *
 * No SDK dependency: Slack incoming webhooks accept a plain JSON POST
 * with `text` + `blocks`. This avoids pulling in @slack/web-api (large)
 * and matches the contract of slackWebhookUrl URLs users configure in
 * the UI (Settings → Integrations → Slack).
 */
import type { AlertChannelConfig, AlertDeliveryResult } from '../types';

export interface SendSlackAlertParams {
  webhookUrl: string;
  channelLabel: string;
  ruleName: string;
  dashboardTitle: string;
  breachedValue: number | string | null;
  threshold: number | string;
  correlationId: string;
}

export async function sendSlackAlert(
  params: SendSlackAlertParams,
): Promise<AlertDeliveryResult> {
  const payload = {
    text: `🚨 ${params.ruleName}`,
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `🚨 *${params.ruleName}*` },
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*Dashboard:*\n${params.dashboardTitle}`,
          },
          {
            type: 'mrkdwn',
            text: `*Valor actual:*\n\`${String(params.breachedValue)}\``,
          },
          {
            type: 'mrkdwn',
            text: `*Umbral:*\n\`${String(params.threshold)}\``,
          },
          {
            type: 'mrkdwn',
            text: `*Channel:*\n${params.channelLabel}`,
          },
        ],
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `correlation: \`${params.correlationId}\``,
          },
        ],
      },
    ],
  };

  try {
    const res = await fetch(params.webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      return {
        channelType: 'slack',
        status: 'failed',
        error: `Slack ${res.status}: ${await safeText(res)}`,
      };
    }
    return { channelType: 'slack', status: 'success' };
  } catch (err) {
    return {
      channelType: 'slack',
      status: 'failed',
      error: errorMessage(err),
    };
  }
}

function isSlackChannel(channel: AlertChannelConfig): channel is Extract<AlertChannelConfig, { type: 'slack' }> {
  return channel.type === 'slack';
}

/**
 * Type guard for AlertChannelConfig — returns true if the channel is a
 * Slack channel. Used by the dispatch logic to route to this module.
 */
export { isSlackChannel };

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '<unreadable response body>';
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
