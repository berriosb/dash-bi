/**
 * Alert domain types — discriminated unions for condition + channel config.
 *
 * Per spec/alerts.md §2.4.
 */

export type AlertCondition =
  | { kind: 'threshold_above'; threshold: number }
  | { kind: 'threshold_below'; threshold: number }
  | {
      kind: 'threshold_outside_range';
      min: number;
      max: number;
    }
  | { kind: 'equals'; value: number }
  | { kind: 'missing_data'; windowMinutes: number };

export type AlertConditionKind = AlertCondition['kind'];

/**
 * Channel configuration. `webhookUrl` (Slack) and `url` (custom webhook)
 * are stored encrypted in the DB via `encryptApiKey`/`decryptApiKey`
 * (lib/security/encryption.ts).
 */
export type AlertChannelConfig =
  | {
      type: 'slack';
      webhookUrl: string;
      channelLabel: string;
    }
  | {
      type: 'email';
      recipients: string[];
      subject: string;
    }
  | {
      type: 'webhook';
      url: string;
      headers?: Record<string, string>;
    };

export type AlertChannelType = AlertChannelConfig['type'];

export interface AlertDeliveryResult {
  channelType: AlertChannelType;
  status: 'success' | 'failed' | 'skipped';
  error?: string;
  providerMessageId?: string;
}

/**
 * Per-org plan quotas. Mirrors spec/alerts.md §8.
 * `minIntervalMinutes` is enforced at rule creation.
 */
export const ALERT_LIMITS = {
  free: { maxRules: 3, maxChannelsPerRule: 2, minIntervalMinutes: 15 },
  pro: { maxRules: 30, maxChannelsPerRule: 5, minIntervalMinutes: 5 },
  enterprise: { maxRules: -1, maxChannelsPerRule: -1, minIntervalMinutes: 1 },
} as const satisfies Record<
  string,
  { maxRules: number; maxChannelsPerRule: number; minIntervalMinutes: number }
>;

export type AlertPlan = keyof typeof ALERT_LIMITS;
