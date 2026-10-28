import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { renderPdf } from './render-pdf';
import { attachWorkerLogging } from './worker-logging';
import { logger } from '@/lib/logger';

const PDF_QUEUE_NAME = 'pdf-export';
const PDF_CONCURRENCY = 3;
const PDF_RATE_LIMIT_MAX = 10;
const PDF_RATE_LIMIT_DURATION_MS = 60_000;

/**
 * Which half of the worker this process runs.
 *
 * - `pdf`  — ONLY the PDF renderer. This is the process that loads
 *   tenant-controlled content in Chrome, so it must run in a container
 *   with no database credentials and no master key.
 * - `jobs` — the alert and scheduled-report workers. They need the
 *   database and the master key, and they never open a browser.
 * - `all`  — both, in one process. Kept for local development; the
 *   deployment splits them (see `docker-compose.yml`).
 */
export type WorkerRole = 'pdf' | 'jobs' | 'all';

/**
 * Read the role from the environment.
 *
 * An unset variable keeps the historical behaviour (everything in one
 * process). An UNKNOWN value is a configuration mistake that would
 * silently run more than intended, so it fails at boot instead.
 */
export function resolveWorkerRole(raw: string | undefined): WorkerRole {
  const value = (raw ?? '').trim().toLowerCase();
  if (value === '') return 'all';
  if (value === 'pdf' || value === 'jobs' || value === 'all') return value;
  throw new Error(
    `Invalid WORKER_ROLE '${raw}'. Use 'pdf' (renderer only), 'jobs' (alerts and reports) or 'all'.`,
  );
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

export interface WorkerCoordinator {
  workers: Worker[];
  closeAll: () => Promise<void>;
}

/**
 * Start the workers this process is responsible for.
 *
 * The job workers are imported DYNAMICALLY on purpose: a renderer-only
 * container must not load the database client, the Drizzle schema or the
 * encryption module. With a static import, the renderer container would
 * still hold the DB credentials in its process memory, and a Chrome
 * renderer compromise would inherit them.
 */
export async function startWorkers(
  connection: Redis,
  role: WorkerRole,
): Promise<WorkerCoordinator> {
  const workers: Worker[] = [];

  if (role === 'pdf' || role === 'all') {
    workers.push(createPdfWorker(connection));
  }

  if (role === 'jobs' || role === 'all') {
    const jobs = await import('./job-workers');
    await jobs.ensureJobSchedules(connection);
    workers.push(...jobs.createJobWorkers(connection));
  }

  const closeAll = async () => {
    logger.info({ count: workers.length }, 'workers: shutting down all workers');
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

  let role: WorkerRole;
  try {
    role = resolveWorkerRole(process.env.WORKER_ROLE);
  } catch (error) {
    logger.error(
      { err: error instanceof Error ? error.message : String(error) },
      'workers: invalid WORKER_ROLE',
    );
    process.exit(1);
  }

  startWorkers(connection, role)
    .then(({ workers, closeAll }) => {
      logger.info(
        { count: workers.length, role },
        'workers: background workers running',
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
