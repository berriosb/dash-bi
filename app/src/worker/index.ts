import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { renderPdf } from './render-pdf';
import { logger } from '@/lib/logger';

const QUEUE_NAME = 'pdf-export';
const CONCURRENCY = 3;
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_DURATION_MS = 60_000;

/**
 * Create and start a BullMQ Worker subscribed to the pdf-export queue.
 *
 * Concurrency: 3 simultaneous jobs (per docker-compose memory limit).
 * Rate limit: 10 jobs / minute globally (defense in depth).
 */
export function createPdfWorker(connection: Redis): Worker {
  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      logger.info({ jobId: job.id, name: job.name }, 'pdf-worker: processing job');
      return await renderPdf(job.data);
    },
    {
      connection,
      concurrency: CONCURRENCY,
      limiter: { max: RATE_LIMIT_MAX, duration: RATE_LIMIT_DURATION_MS },
    }
  );

  worker.on('completed', (job) => {
    logger.info({ jobId: job.id }, 'pdf-worker: job completed');
  });

  worker.on('failed', (job, err) => {
    logger.error(
      { jobId: job?.id, err: err?.message, attemptsMade: job?.attemptsMade },
      'pdf-worker: job failed'
    );
  });

  worker.on('error', (err) => {
    logger.error({ err: err.message }, 'pdf-worker: worker error');
  });

  return worker;
}

// Auto-start when run directly (not when imported for tests).
const isEntryPoint = import.meta.url === `file://${process.argv[1]}`;

if (isEntryPoint) {
  const connection = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
  const worker = createPdfWorker(connection);
  logger.info(
    { queue: QUEUE_NAME, concurrency: CONCURRENCY },
    'pdf-worker: started, waiting for jobs'
  );

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'pdf-worker: shutdown signal received');
    await worker.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}