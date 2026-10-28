import { Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import { runAlertDispatcher } from '@/lib/alerts/dispatcher';
import { runAlertEvaluator } from '@/lib/alerts/evaluator';
import {
  ALERT_DISPATCHER_QUEUE,
  ALERT_EVALUATE_QUEUE,
  ensureDispatcherScheduled,
} from '@/lib/alerts/queue';
import { processDueScheduledReports } from '@/lib/reports/runner';
import {
  SCHEDULED_REPORTS_QUEUE,
  ensureScheduledReportsScheduled,
} from '@/lib/reports/queue';
import { attachWorkerLogging } from './worker-logging';

/**
 * The workers that need the DATABASE and the master key.
 *
 * They live in their own module, and the entrypoint loads it DYNAMICALLY,
 * so a container that only renders PDFs never even imports the database
 * client: the connection string, the Drizzle schema and the encryption
 * key are not in that process at all.
 *
 * This is the half of the worker that legitimately needs credentials:
 * - the alert evaluator runs the tenant's SQL against the read-only role;
 * - the alert dispatcher decrypts the alert channel URLs with the master
 *   key before POSTing them;
 * - the scheduled report runner writes the run state and enqueues PDFs.
 */
export function createJobWorkers(connection: Redis): Worker[] {
  const alertDispatcher = new Worker(
    ALERT_DISPATCHER_QUEUE,
    async (job) => {
      return await runAlertDispatcher(job);
    },
    {
      connection,
      concurrency: 1,
    }
  );

  const alertEvaluator = new Worker(
    ALERT_EVALUATE_QUEUE,
    async (job) => {
      return await runAlertEvaluator(job);
    },
    {
      connection,
      concurrency: 5,
    }
  );

  const scheduledReports = new Worker(
    SCHEDULED_REPORTS_QUEUE,
    async (_job) => {
      return await processDueScheduledReports();
    },
    {
      connection,
      concurrency: 1,
    }
  );

  return [
    attachWorkerLogging(alertDispatcher, 'alert-dispatcher'),
    attachWorkerLogging(alertEvaluator, 'alert-evaluator'),
    attachWorkerLogging(scheduledReports, 'scheduled-reports'),
  ];
}

/**
 * Register the repeatable schedules (Redis only). Called by the jobs
 * container, never by the renderer.
 */
export async function ensureJobSchedules(connection: Redis): Promise<void> {
  await ensureDispatcherScheduled();
  await ensureScheduledReportsScheduled(connection);
}
