/**
 * Zod schemas for alert rule + channel API input validation.
 *
 * Spec: spec/alerts.md §2.4 + §4.
 *
 * The discriminated unions in types.ts are the runtime types;
 * these Zod schemas mirror them for API request parsing and
 * keep `kind` / `type` as the discriminator field at runtime.
 */
import { z } from 'zod';
import type { AlertCondition, AlertPlan } from './types';
import { ALERT_LIMITS } from './types';

// ─────────────────────────────────────────────────────────────────
// AlertCondition discriminated union
// ─────────────────────────────────────────────────────────────────

export const AlertConditionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('threshold_above'),
    threshold: z.number().finite(),
  }),
  z.object({
    kind: z.literal('threshold_below'),
    threshold: z.number().finite(),
  }),
  z.object({
    kind: z.literal('threshold_outside_range'),
    min: z.number().finite(),
    max: z.number().finite(),
  }),
  z.object({
    kind: z.literal('equals'),
    value: z.number().finite(),
  }),
  z.object({
    kind: z.literal('missing_data'),
    windowMinutes: z.number().int().positive(),
  }),
]);

// ─────────────────────────────────────────────────────────────────
// AlertChannelConfig discriminated union
// ─────────────────────────────────────────────────────────────────

export const SlackChannelSchema = z.object({
  type: z.literal('slack'),
  webhookUrl: z.string().url().refine(
    (url) => url.startsWith('https://hooks.slack.com/'),
    { message: 'Slack webhook URL debe ser https://hooks.slack.com/...' },
  ),
  channelLabel: z.string().min(1).max(100),
});

export const EmailChannelSchema = z.object({
  type: z.literal('email'),
  recipients: z.array(z.string().email()).min(1).max(10),
  subject: z.string().min(1).max(200),
});

export const WebhookChannelSchema = z.object({
  type: z.literal('webhook'),
  url: z.string().url(),
  headers: z.record(z.string(), z.string()).optional(),
});

export const AlertChannelConfigSchema = z.discriminatedUnion('type', [
  SlackChannelSchema,
  EmailChannelSchema,
  WebhookChannelSchema,
]);

// ─────────────────────────────────────────────────────────────────
// Create / update payloads
// ─────────────────────────────────────────────────────────────────

export const CreateAlertRuleSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  querySql: z.string().min(10).max(5000),
  queryColumns: z.object({
    value: z.string().min(1),
    timestamp: z.string().optional(),
  }),
  condition: AlertConditionSchema,
  evaluationIntervalMinutes: z.number().int().min(1).max(1440),
  evaluationWindowMinutes: z.number().int().min(1).max(1440).optional(),
  consecutiveBreachesToFire: z.number().int().min(1).max(10),
  channels: z.array(AlertChannelConfigSchema).min(1),
  cooldownMinutes: z.number().int().min(1).max(10080), // max 7 days
});

export const UpdateAlertRuleSchema = CreateAlertRuleSchema.partial();

// ─────────────────────────────────────────────────────────────────
// Coercion + injection helpers
// ─────────────────────────────────────────────────────────────────

/**
 * Inject LIMIT 1 into a SQL query if it doesn't have one. Used so
 * alert rules don't accidentally scan the whole table when the user
 * forgets a LIMIT clause.
 */
export function ensureLimit(sql: string, limit = 1): string {
  const upper = sql.toUpperCase();
  if (upper.includes('LIMIT ')) return sql;
  // Trim trailing semicolon, append LIMIT
  return `${sql.replace(/;\s*$/, '').trimEnd()} LIMIT ${limit}`;
}

// ─────────────────────────────────────────────────────────────────
// Quota enforcement
// ─────────────────────────────────────────────────────────────────

export interface AlertQuotaContext {
  plan: AlertPlan;
  currentRuleCount: number;
}

/**
 * Throws a QuotaExceededError-shape Error if the org would exceed
 * its plan limits. Used at API entry points.
 */
export function assertWithinQuota(ctx: AlertQuotaContext): void {
  const limits = ALERT_LIMITS[ctx.plan];
  if (limits.maxRules !== -1 && ctx.currentRuleCount >= limits.maxRules) {
    const err = new Error(
      `Máximo ${limits.maxRules} alertas activas en plan ${ctx.plan}`,
    );
    (err as Error & { code: string }).code = 'alert.quota_exceeded';
    throw err;
  }
}

/**
 * Cross-condition invariants that Zod discriminatedUnion can't express
 * directly (since `.refine()` strips discriminator metadata). Called
 * by the API layer after parsing.
 */
export function assertConditionInvariants(
  condition: AlertCondition,
): void {
  if (condition.kind === 'threshold_outside_range' && condition.min >= condition.max) {
    throw new Error('Para "fuera de rango", min debe ser menor que max');
  }
}
