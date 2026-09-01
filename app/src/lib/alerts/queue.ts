import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

export const ALERT_DISPATCHER_QUEUE = 'alert-dispatcher';
export const ALERT_EVALUATE_QUEUE = 'alert-evaluate';

let redis: Redis | null = null;
let dispatcherQueue: Queue | null = null;
let evaluateQueue: Queue | null = null;

function getRedis(): Redis {
  if (!redis) {
    const url = process.env.REDIS_URL ?? 'redis://localhost:6379';
    redis = new Redis(url, { maxRetriesPerRequest: 3 });
  }
  return redis;
}

function getDispatcherQueue(): Queue {
  if (!dispatcherQueue) {
    dispatcherQueue = new Queue(ALERT_DISPATCHER_QUEUE, {
      connection: getRedis(),
    });
  }
  return dispatcherQueue;
}

function getEvaluateQueue(): Queue {
  if (!evaluateQueue) {
    evaluateQueue = new Queue(ALERT_EVALUATE_QUEUE, {
      connection: getRedis(),
    });
  }
  return evaluateQueue;
}

/**
 * Ensure the dispatcher repeatable job is registered. Idempotent — safe
 * to call multiple times (BullMQ dedupes by `repeat.key`).
 *
 * Schedule: every 60 seconds. The dispatcher queries `alert_rules`
 * WHERE enabled AND due, and enqueues one `alert-evaluate` job per due rule.
 */
export async function ensureDispatcherScheduled(): Promise<void> {
  const q = getDispatcherQueue();
  await q.add(
    'dispatch',
    {},
    {
      repeat: { pattern: '* * * * *', tz: 'UTC', key: 'alert-dispatcher' },
      removeOnComplete: 100,
      removeOnFail: 100,
      jobId: 'alert-dispatcher-repeat', // dedupe
    },
  );
  logger.info({}, 'alert-dispatcher: scheduled (every 60s)');
}

export async function enqueueAlertEvaluation(
  alertRuleId: string,
  correlationId: string,
): Promise<void> {
  await getEvaluateQueue().add(
    'evaluate',
    { alertRuleId, correlationId },
    {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: 100,
      removeOnFail: 100,
    },
  );
}
