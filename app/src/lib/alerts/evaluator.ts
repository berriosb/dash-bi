import type { Job } from 'bullmq';
import { eq } from 'drizzle-orm';
import { withOrgContext, withSystemContext, withOrgContextReadOnly } from '@/db/client';
import { alertRules, alertEvents, dashboards } from '@/db/schema';
import { audit } from '@/lib/audit/log';
import { evaluateCondition } from './condition';
import { deliverToChannel } from './channels';
import type { AlertCondition, AlertChannelConfig, AlertDeliveryResult } from './types';
import { decryptApiKey } from '@/lib/security/encryption';
import { validateQuery } from '@/lib/security/validate-query';

interface EvaluateJobData {
  alertRuleId: string;
  correlationId: string;
}

interface EvaluateResult {
  breached: boolean;
  fired: boolean;
  value: number | string | null;
  threshold: number | string;
}

interface LoadedRule {
  id: string;
  orgId: string;
  name: string;
  querySql: string;
  queryColumns: { value: string; timestamp?: string };
  condition: AlertCondition;
  consecutiveBreaches: number;
  consecutiveBreachesToFire: number;
  cooldownMinutes: number;
  channels: AlertChannelConfig[];
  enabled: boolean;
  lastFiredAt: Date | null;
  dashboardTitle: string;
}

/**
 * Per-rule evaluator: load the rule, run its query against the
 * read-only DB role, evaluate the condition, fire if the breach
 * threshold is met AND the cooldown has expired, deliver to channels,
 * persist alert_event.
 *
 * BullMQ: 3 attempts with exponential backoff (set in queue.ts).
 * After 3 failures the job is marked failed; the rule's
 * `lastEvaluationStatus` is set to 'error' and audit `alert.evaluation_failed`
 * is recorded.
 */
export async function runAlertEvaluator(
  job: Job<EvaluateJobData>,
): Promise<EvaluateResult> {
  const { alertRuleId, correlationId } = job.data;

  // 1. Load rule (system context — worker has no user auth)
  const loaded = await loadRuleAcrossOrgs(alertRuleId);
  if (!loaded) {
    throw new Error(`Alert rule ${alertRuleId} not found`);
  }
  const r = loaded;

  // 2. Skip disabled rules (they shouldn't have been enqueued, but defense)
  if (!r.enabled) {
    return { breached: false, fired: false, value: null, threshold: '' };
  }

  // 3. Re-validate SQL at evaluate time (defense in depth)
  try {
    validateQuery({ kind: 'sql', sql: r.querySql }, 'postgres');
  } catch (err) {
    await markEvaluationFailed(r, correlationId, err);
    throw err;
  }

  // 4. Execute query against read-only DB role
  let value: number | string | null;
  try {
    const rows = await withOrgContextReadOnly(r.orgId, '', async (tx) => {
      return tx.execute(r.querySql as never);
    });
    value = extractValue(rows, r.queryColumns.value);
  } catch (err) {
    await markEvaluationFailed(r, correlationId, err);
    throw err;
  }

  // 5. Evaluate condition
  const condResult = evaluateCondition(r.condition, value);
  const breached = condResult.breached;
  const newCounter = breached ? r.consecutiveBreaches + 1 : 0;
  const shouldFire = breached && newCounter >= r.consecutiveBreachesToFire;
  const cooldownExpired = isCooldownExpired(r);

  // 6. Always update rule state
  await withOrgContext(r.orgId, null, async (tx) => {
    return tx
      .update(alertRules)
      .set({
        lastEvaluatedAt: new Date(),
        lastEvaluationStatus: 'ok',
        lastEvaluationError: null,
        consecutiveBreaches: newCounter,
      })
      .where(eq(alertRules.id, alertRuleId));
  });

  if (!shouldFire || !cooldownExpired) {
    if (breached && !cooldownExpired) {
      await audit(r.orgId, null, 'alert.evaluation_suppressed', `alert_rule:${r.id}`, {
        metadata: { correlationId, reason: 'cooldown' },
      });
    }
    return {
      breached,
      fired: false,
      value: condResult.value,
      threshold: condResult.threshold,
    };
  }

  // 7. Deliver to channels
  const deliveryResults: AlertDeliveryResult[] = [];
  for (const channel of r.channels) {
    const decrypted = decryptChannel(channel);
    const result = await deliverToChannel({
      channel: decrypted,
      ruleName: r.name,
      dashboardTitle: r.dashboardTitle,
      condition: r.condition,
      breachedValue: condResult.value,
      correlationId,
      firedAt: new Date(),
    });
    deliveryResults.push(result);
  }

  // 8. Persist alert_event + reset counter
  const event = await withOrgContext(r.orgId, null, async (tx) => {
    const [e] = await tx
      .insert(alertEvents)
      .values({
        orgId: r.orgId,
        alertRuleId: r.id,
        breachedValue: { value: condResult.value, threshold: condResult.threshold },
        deliveryStatus: deliveryResults,
        correlationId,
        title: r.name,
        dashboardTitle: r.dashboardTitle,
      })
      .returning();
    return e;
  });

  await withOrgContext(r.orgId, null, async (tx) => {
    return tx
      .update(alertRules)
      .set({ lastFiredAt: new Date(), consecutiveBreaches: 0 })
      .where(eq(alertRules.id, alertRuleId));
  });

  await audit(r.orgId, null, 'alert.fired', `alert_rule:${r.id}`, {
    metadata: {
      correlationId,
      eventId: event?.id,
      breachedValue: condResult.value,
      channelsDelivered: deliveryResults.filter((d) => d.status === 'success').length,
    },
  });

  return {
    breached: true,
    fired: true,
    value: condResult.value,
    threshold: condResult.threshold,
  };
}

async function markEvaluationFailed(
  r: LoadedRule,
  correlationId: string,
  err: unknown,
): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  await withOrgContext(r.orgId, null, async (tx) => {
    return tx
      .update(alertRules)
      .set({
        lastEvaluatedAt: new Date(),
        lastEvaluationStatus: 'error',
        lastEvaluationError: message,
      })
      .where(eq(alertRules.id, r.id));
  });
  await audit(r.orgId, null, 'alert.evaluation_failed', `alert_rule:${r.id}`, {
    metadata: { correlationId, errorMessage: message },
  });
}

async function loadRuleAcrossOrgs(alertRuleId: string): Promise<LoadedRule | null> {
  const result = await withSystemContext(async (tx) => {
    const rows = await tx
      .select({
        rule: alertRules,
        dashboardTitle: dashboards.title,
      })
      .from(alertRules)
      .innerJoin(dashboards, eq(alertRules.dashboardId, dashboards.id))
      .where(eq(alertRules.id, alertRuleId))
      .limit(1);
    return rows[0];
  });

  if (!result) return null;
  return {
    id: result.rule.id,
    orgId: result.rule.orgId,
    name: result.rule.name,
    querySql: result.rule.querySql,
    queryColumns: result.rule.queryColumns as { value: string; timestamp?: string },
    condition: result.rule.condition as AlertCondition,
    consecutiveBreaches: result.rule.consecutiveBreaches,
    consecutiveBreachesToFire: result.rule.consecutiveBreachesToFire,
    cooldownMinutes: result.rule.cooldownMinutes,
    channels: result.rule.channels as AlertChannelConfig[],
    enabled: result.rule.enabled,
    lastFiredAt: result.rule.lastFiredAt,
    dashboardTitle: result.dashboardTitle,
  };
}

function isCooldownExpired(r: { lastFiredAt: Date | null; cooldownMinutes: number }): boolean {
  if (!r.lastFiredAt) return true;
  return new Date(r.lastFiredAt.getTime() + r.cooldownMinutes * 60_000) <= new Date();
}

function decryptChannel(channel: AlertChannelConfig): AlertChannelConfig {
  try {
    if (channel.type === 'slack') {
      return { ...channel, webhookUrl: decryptApiKey(channel.webhookUrl) };
    }
    if (channel.type === 'webhook') {
      return { ...channel, url: decryptApiKey(channel.url) };
    }
    return channel;
  } catch {
    return channel;
  }
}

function extractValue(rows: unknown, columnName: string): number | string | null {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const first = rows[0] as Record<string, unknown>;
  const raw = first[columnName];
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number' || typeof raw === 'string') return raw;
  if (typeof raw === 'bigint') return Number(raw);
  return null;
}
