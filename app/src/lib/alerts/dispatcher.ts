import type { Job } from 'bullmq';
import { eq, and, count, sql } from 'drizzle-orm';
import { withSystemContext } from '@/db/client';
import { alertRules } from '@/db/schema';
import { logger } from '@/lib/logger';
import { enqueueAlertEvaluation } from './queue';

/**
 * Dispatcher: every minute, find alert_rules that are due and enqueue
 * a per-rule evaluation job.
 *
 * "Due" = enabled AND (lastEvaluatedAt IS NULL OR lastEvaluatedAt + interval <= now).
 *
 * Uses withSystemContext because the dispatcher doesn't need org
 * isolation — it processes all enabled rules in batch.
 */
export async function runAlertDispatcher(_job: Job): Promise<{ enqueued: number }> {
  const now = new Date();

  const dueRules = await withSystemContext(async (tx) => {
    // Find rules where the next-eval boundary has passed.
    // Use the smaller of (lastEvaluatedAt + interval, now) so a stale
    // dispatcher delay doesn't skip evaluations.
    return tx
      .select({
        id: alertRules.id,
        evaluationIntervalMinutes: alertRules.evaluationIntervalMinutes,
        lastEvaluatedAt: alertRules.lastEvaluatedAt,
      })
      .from(alertRules)
      .where(
        and(
          eq(alertRules.enabled, true),
          sql`(${alertRules.lastEvaluatedAt} IS NULL OR ${alertRules.lastEvaluatedAt} + (${alertRules.evaluationIntervalMinutes} || ' minutes')::interval <= NOW())`,
        ),
      );
  });

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
  const result = await withSystemContext(async (tx) => {
    return tx.select({ value: count() }).from(alertRules).where(eq(alertRules.enabled, true));
  });
  return result[0]?.value ?? 0;
}
