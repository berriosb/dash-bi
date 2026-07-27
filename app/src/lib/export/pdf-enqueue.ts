import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { generatePrintToken } from './print-token';
import { getOrgBranding } from './branding';
import { logger } from '@/lib/logger';

export const PDF_QUEUE_NAME = 'pdf-export';
const PDF_JOB_REMOVE_ON_COMPLETE = 100;
const PDF_JOB_REMOVE_ON_FAIL = 100;

let redis: Redis | null = null;
let pdfQueue: Queue | null = null;

function getRedis(): Redis {
  if (!redis) {
    const url = process.env.REDIS_URL ?? 'redis://localhost:6379';
    redis = new Redis(url, { maxRetriesPerRequest: 3 });
  }
  return redis;
}

function getQueue(): Queue {
  if (!pdfQueue) {
    pdfQueue = new Queue(PDF_QUEUE_NAME, { connection: getRedis() });
  }
  return pdfQueue;
}

export type PdfEnqueueOptions = {
  dashboardId: string;
  orgId: string;
  userId: string;
  pageSize?: 'A4' | 'Letter';
};

/**
 * Enqueue a PDF render job. Returns the BullMQ job id.
 *
 * The job payload includes:
 * - url: the print route URL with a one-time token (worker uses this to fetch)
 * - options: pageSize (Letter or A4)
 * - branding: { logoUrl } for org-specific branding in the PDF header
 */
export async function enqueuePdfExport(opts: PdfEnqueueOptions): Promise<string> {
  const pageSize = opts.pageSize ?? 'Letter';
  const token = await generatePrintToken(opts.dashboardId, opts.orgId);
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? '';
  const url = `${baseUrl}/dashboard/${opts.dashboardId}/print?token=${token}`;
  const branding = await getOrgBranding(opts.orgId);

  const job = await getQueue().add(
    'render',
    {
      url,
      options: { pageSize },
      branding,
    },
    {
      removeOnComplete: PDF_JOB_REMOVE_ON_COMPLETE,
      removeOnFail: PDF_JOB_REMOVE_ON_FAIL,
    }
  );
  logger.info({ jobId: job.id, dashboardId: opts.dashboardId }, 'pdf-export: enqueued');
  return job.id!;
}

export type PdfJobStatus =
  | { status: 'not_found' }
  | { status: 'queued' | 'active' | 'waiting' | 'delayed' }
  | { status: 'completed'; buffer: Buffer }
  | { status: 'failed'; reason?: string };

/**
 * Get the status of a previously enqueued PDF job.
 *
 * Returns a discriminated union. Callers (the API route) translate to
 * HTTP responses / file downloads accordingly.
 */
export async function getPdfJobStatus(jobId: string): Promise<PdfJobStatus> {
  const job = await getQueue().getJob(jobId);
  if (!job) return { status: 'not_found' };

  if (await job.isCompleted()) {
    const returnvalue = job.returnvalue as { buffer: Buffer } | undefined;
    if (!returnvalue?.buffer) {
      return { status: 'failed', reason: 'job completed without buffer payload' };
    }
    return { status: 'completed', buffer: returnvalue.buffer };
  }

  if (await job.isFailed()) {
    return { status: 'failed', reason: job.failedReason };
  }

  const state = await job.getState();
  if (state === 'completed') {
    return { status: 'completed', buffer: (job.returnvalue as { buffer: Buffer }).buffer };
  }
  if (state === 'failed') {
    return { status: 'failed', reason: job.failedReason };
  }
  return { status: state as 'queued' | 'active' | 'waiting' | 'delayed' };
}