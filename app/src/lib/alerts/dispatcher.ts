import type { Job } from 'bullmq';
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { logger } from '@/lib/logger';
import { enqueueAlertEvaluation } from './queue';

/** A row of `dashbi_due_alert_rules()`, as raw SQL returns it. */
interface DueAlertRule {
  id: string;
  evaluation_interval_minutes: number;
  last_evaluated_at: Date | null;
  [key: string]: unknown;
}

/**
 * Dispatcher: every minute, find alert_rules that are due and enqueue
 * a per-rule evaluation job.
 *
 * "Due" = enabled AND (lastEvaluatedAt IS NULL OR lastEvaluatedAt + interval <= now).
 *
 * The scan has to cross orgs: a platform worker belongs to no tenant and has
 * to see every rule that is due. It is not running inside a transaction with
 * a magically bypassed policy — it calls a named SECURITY DEFINER function
 * (migration 0014) whose signature, search_path and EXECUTE grant can be
 * audited. A rule's own data is then loaded per-org, under RLS.
 */
export async function runAlertDispatcher(_job: Job): Promise<{ enqueued: number }> {
  const now = new Date();

  // Find rules where the next-eval boundary has passed.
  // Use the smaller of (lastEvaluatedAt + interval, now) so a stale
  // dispatcher delay doesn't skip evaluations.
  const dueRules = await db.execute<DueAlertRule>(
    sql`SELECT * FROM dashbi_due_alert_rules()`,
  );

  let enqueued = 0;
  for (const rule of dueRules) {
    const correlationId = `alert_${rule.id.slice(0, 8)}_${now.getTime()}`;
    try {
      await enqueueAlertEvaluation(rule.id, correlationId);
      enqueued++;
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err), ruleId: rule.id },
        'alert-dispatcher: failed to enqueue evaluation',
      );
    }
  }

  if (enqueued > 0) {
    logger.info(
      { enqueued, scanned: dueRules.length },
      'alert-dispatcher: tick',
    );
  }

  return { enqueued };
}

/**
 * Helper for tests: returns the next due timestamp for a rule.
 */
export function nextDueAt(
  lastEvaluatedAt: Date | null,
  evaluationIntervalMinutes: number,
): Date {
  if (!lastEvaluatedAt) return new Date(0); // due now
  return new Date(lastEvaluatedAt.getTime() + evaluationIntervalMinutes * 60_000);
}

/**
 * Helper for tests: counts enabled rules.
 */
export async function countEnabledRules(): Promise<number> {
  const rows = await db.execute<{ value: string }>(
    sql`SELECT dashbi_count_enabled_alert_rules() AS value`,
  );
  return Number(rows[0]?.value ?? 0);
}
