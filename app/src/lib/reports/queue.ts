import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { logger } from '@/lib/logger';

export const SCHEDULED_REPORTS_QUEUE = 'scheduled-reports-due';

let redis: Redis | null = null;
let reportsQueue: Queue | null = null;

function getRedis(): Redis {
  if (!redis) {
    const url = process.env.REDIS_URL ?? 'redis://localhost:6379';
    redis = new Redis(url, { maxRetriesPerRequest: 3 });
  }
  return redis;
}

export function getScheduledReportsQueue(connection?: Redis): Queue {
  if (connection) {
    return new Queue(SCHEDULED_REPORTS_QUEUE, { connection });
  }
  if (!reportsQueue) {
    reportsQueue = new Queue(SCHEDULED_REPORTS_QUEUE, {
      connection: getRedis(),
    });
  }
  return reportsQueue;
}

/**
 * Ensure the scheduled reports dispatcher repeatable job is registered.
 * Safe to call repeatedly; BullMQ dedupes by repeat key.
 *
 * Runs every 60s to scan `scheduled_reports` where enabled=true and nextRunAt <= NOW().
 */
export async function ensureScheduledReportsScheduled(connection?: Redis): Promise<void> {
  const q = getScheduledReportsQueue(connection);
  await q.add(
    'dispatch',
    {},
    {
      repeat: { pattern: '* * * * *', tz: 'UTC', key: 'scheduled-reports-due' },
      removeOnComplete: 100,
      removeOnFail: 100,
      jobId: 'scheduled-reports-repeat',
    },
  );
  logger.info({}, 'scheduled-reports: scheduled (every 60s)');
}
