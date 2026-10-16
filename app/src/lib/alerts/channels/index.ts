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
import { decryptAlertChannels } from '../schemas';
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

  // Channel secrets are stored encrypted (see `encryptAlertChannels`).
  // Decrypt here — at the single funnel every channel passes through —
  // so the HTTP clients never have to know about the at-rest format.
  const [channel] = decryptAlertChannels([params.channel]);
  if (!channel) {
    throw new Error('Alert channel could not be decrypted');
  }

  switch (channel.type) {
    case 'slack':
      return sendSlackAlert({
        webhookUrl: channel.webhookUrl,
        channelLabel: channel.channelLabel,
        ruleName: params.ruleName,
        dashboardTitle: params.dashboardTitle,
        breachedValue: params.breachedValue,
        threshold,
        correlationId: params.correlationId,
      });
    case 'email':
      return sendEmailAlert({
        recipients: channel.recipients,
        subject: channel.subject,
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
        url: channel.url,
        headers: channel.headers,
        payload,
      });
    }
  }
}
