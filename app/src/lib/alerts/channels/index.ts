/**
 * Channel dispatcher — routes an AlertChannelConfig to the
 * appropriate channel implementation. Used by the alert worker
 * to deliver notifications.
 */
import type {
  AlertChannelConfig,
  AlertDeliveryResult,
  AlertCondition,
} from '../types';
import { conditionThreshold } from '../condition';
import { sendSlackAlert } from './slack';
import { sendEmailAlert } from './email';
import { sendWebhookAlert, type WebhookPayload } from './webhook';

export interface DeliverChannelParams {
  channel: AlertChannelConfig;
  ruleName: string;
  dashboardTitle: string;
  condition: AlertCondition;
  breachedValue: number | string | null;
  correlationId: string;
  firedAt: Date;
}

export async function deliverToChannel(
  params: DeliverChannelParams,
): Promise<AlertDeliveryResult> {
  const threshold = conditionThreshold(params.condition);
  const firedAtIso = params.firedAt.toISOString();

  switch (params.channel.type) {
    case 'slack':
      return sendSlackAlert({
        webhookUrl: params.channel.webhookUrl,
        channelLabel: params.channel.channelLabel,
        ruleName: params.ruleName,
        dashboardTitle: params.dashboardTitle,
        breachedValue: params.breachedValue,
        threshold,
        correlationId: params.correlationId,
      });
    case 'email':
      return sendEmailAlert({
        recipients: params.channel.recipients,
        subject: params.channel.subject,
        ruleName: params.ruleName,
        dashboardTitle: params.dashboardTitle,
        breachedValue: params.breachedValue,
        threshold,
        correlationId: params.correlationId,
      });
    case 'webhook': {
      const payload: WebhookPayload = {
        alertName: params.ruleName,
        dashboardTitle: params.dashboardTitle,
        breachedValue: params.breachedValue,
        threshold,
        correlationId: params.correlationId,
        firedAt: firedAtIso,
      };
      return sendWebhookAlert({
        url: params.channel.url,
        headers: params.channel.headers,
        payload,
      });
    }
  }
}
