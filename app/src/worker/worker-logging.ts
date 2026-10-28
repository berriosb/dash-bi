import type { Worker } from 'bullmq';
import { logger } from '@/lib/logger';

/**
 * Shared worker logging.
 *
 * Lives in its own module so both the PDF worker and the job workers can
 * use it without importing each other.
 */
export function attachWorkerLogging(worker: Worker, name: string): Worker {
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
