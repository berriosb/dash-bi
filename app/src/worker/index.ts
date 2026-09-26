import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { renderPdf } from './render-pdf';
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
import { logger } from '@/lib/logger';

const PDF_QUEUE_NAME = 'pdf-export';
const PDF_CONCURRENCY = 3;
const PDF_RATE_LIMIT_MAX = 10;
const PDF_RATE_LIMIT_DURATION_MS = 60_000;

function attachWorkerLogging(worker: Worker, name: string): Worker {
  worker.on('completed', (job) => {
    logger.info({ worker: name, jobId: job.id }, `${name}: job completed`);
  });

  worker.on('failed', (job, err) => {
    logger.error(
      { worker: name, jobId: job?.id, err: err?.message, attemptsMade: job?.attemptsMade },
      `${name}: job failed`
    );
  });

  worker.on('error', (err) => {
    logger.error({ worker: name, err: err.message }, `${name}: worker error`);
  });

  return worker;
}

/**
 * Create and start a BullMQ Worker subscribed to the pdf-export queue.
 */
export function createPdfWorker(connection: Redis): Worker {
  const worker = new Worker(
    PDF_QUEUE_NAME,
    async (job) => {
      logger.info({ jobId: job.id, name: job.name }, 'pdf-worker: processing job');
      return await renderPdf(job.data);
    },
    {
      connection,
      concurrency: PDF_CONCURRENCY,
      limiter: { max: PDF_RATE_LIMIT_MAX, duration: PDF_RATE_LIMIT_DURATION_MS },
    }
  );

  return attachWorkerLogging(worker, 'pdf-worker');
}

/**
 * Create and start a BullMQ Worker subscribed to alert-dispatcher queue.
 * Scans due alert rules every minute and enqueues evaluation jobs.
 */
export function createAlertDispatcherWorker(connection: Redis): Worker {
  const worker = new Worker(
    ALERT_DISPATCHER_QUEUE,
    async (job) => {
      logger.info({ jobId: job.id }, 'alert-dispatcher: processing tick');
      return await runAlertDispatcher(job);
    },
    {
      connection,
      concurrency: 1,
    }
  );

  return attachWorkerLogging(worker, 'alert-dispatcher');
}

/**
 * Create and start a BullMQ Worker subscribed to alert-evaluate queue.
 * Runs SQL metrics against read-only user and evaluates thresholds.
 */
export function createAlertEvaluatorWorker(connection: Redis): Worker {
  const worker = new Worker(
    ALERT_EVALUATE_QUEUE,
    async (job) => {
      logger.info({ jobId: job.id, ruleId: job.data?.alertRuleId }, 'alert-evaluator: evaluating rule');
      return await runAlertEvaluator(job);
    },
    {
      connection,
      concurrency: 5,
    }
  );

  return attachWorkerLogging(worker, 'alert-evaluator');
}

/**
 * Create and start a BullMQ Worker subscribed to scheduled-reports-due queue.
 * Checks reports where nextRunAt <= NOW() and triggers generation/email delivery.
 */
export function createScheduledReportsWorker(connection: Redis): Worker {
  const worker = new Worker(
    SCHEDULED_REPORTS_QUEUE,
    async (job) => {
      logger.info({ jobId: job?.id }, 'scheduled-reports: processing due reports');
      return await processDueScheduledReports();
    },
    {
      connection,
      concurrency: 1,
    }
  );

  return attachWorkerLogging(worker, 'scheduled-reports');
}

export interface WorkerCoordinator {
  workers: Worker[];
  closeAll: () => Promise<void>;
}

/**
 * Start all background workers (PDF renderer, alert dispatcher & evaluator, scheduled reports).
 * Registers repeatable schedule jobs in Redis.
 */
export async function startAllWorkers(connection: Redis): Promise<WorkerCoordinator> {
  // Ensure repeatable schedules are active in Redis
  await ensureDispatcherScheduled();
  await ensureScheduledReportsScheduled(connection);

  const pdfWorker = createPdfWorker(connection);
  const alertDispatcherWorker = createAlertDispatcherWorker(connection);
  const alertEvaluatorWorker = createAlertEvaluatorWorker(connection);
  const scheduledReportsWorker = createScheduledReportsWorker(connection);

  const workers = [
    pdfWorker,
    alertDispatcherWorker,
    alertEvaluatorWorker,
    scheduledReportsWorker,
  ];

  const closeAll = async () => {
    logger.info({}, 'workers: shutting down all workers');
    await Promise.all(workers.map((w) => w.close()));
  };

  return { workers, closeAll };
}

// Auto-start when run directly as background worker process.
const isEntryPoint = import.meta.url === `file://${process.argv[1]}`;

if (isEntryPoint) {
  const connection = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
  });

  startAllWorkers(connection)
    .then(({ workers, closeAll }) => {
      logger.info(
        { count: workers.length },
        'workers: all background workers running (pdf, alerts, reports)'
      );

      const shutdown = async (signal: string) => {
        logger.info({ signal }, 'workers: shutdown signal received');
        await closeAll();
        await connection.quit();
        process.exit(0);
      };

      process.on('SIGTERM', () => void shutdown('SIGTERM'));
      process.on('SIGINT', () => void shutdown('SIGINT'));
    })
    .catch((err) => {
      logger.error({ err: err instanceof Error ? err.message : String(err) }, 'workers: fatal startup error');
      process.exit(1);
    });
}