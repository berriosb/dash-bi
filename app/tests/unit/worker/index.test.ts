import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The PDF renderer is the process that loads tenant-controlled content in
 * Chrome. The job workers (alerts, scheduled reports) live in another
 * module and are loaded dynamically, so the renderer container never
 * imports the database client or the encryption module.
 */
const {
  mockRenderPdf,
  mockWorkerInstance,
  mockCreateJobWorkers,
  mockEnsureJobSchedules,
} = vi.hoisted(() => {
  const instance = {
    on: vi.fn().mockReturnThis(),
    close: vi.fn().mockResolvedValue(undefined),
  };
  return {
    mockRenderPdf: vi.fn(),
    mockWorkerInstance: instance,
    mockCreateJobWorkers: vi.fn(() => []),
    mockEnsureJobSchedules: vi.fn(),
  };
});

vi.mock('bullmq', () => ({
  // Vitest 4 validates that a mocked implementation is constructible before
  // applying `new`, so a plain `function` replaces what used to be an arrow.
  Worker: vi.fn(function () {
    return mockWorkerInstance;
  }),
}));

vi.mock('@/worker/render-pdf', () => ({
  renderPdf: mockRenderPdf,
}));

vi.mock('@/worker/job-workers', () => ({
  createJobWorkers: mockCreateJobWorkers,
  ensureJobSchedules: mockEnsureJobSchedules,
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('ioredis', () => ({
  default: vi.fn(),
  Redis: vi.fn(),
}));

import { createPdfWorker, startWorkers } from '@/worker/index';

const fakeConnection = {} as never;

describe('Worker System', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWorkerInstance.on.mockClear();
    mockWorkerInstance.close.mockClear();
    mockRenderPdf.mockReset();
    mockRenderPdf.mockResolvedValue({ buffer: Buffer.from('PDF') });
    mockCreateJobWorkers.mockReset();
    mockCreateJobWorkers.mockReturnValue([]);
    mockEnsureJobSchedules.mockReset();
    mockEnsureJobSchedules.mockResolvedValue(undefined);
  });

  describe('createPdfWorker', () => {
    it('creates a BullMQ Worker subscribed to the pdf-export queue', async () => {
      createPdfWorker(fakeConnection);
      const { Worker } = vi.mocked(await import('bullmq'));

      expect(Worker).toHaveBeenCalledWith(
        'pdf-export',
        expect.any(Function),
        expect.objectContaining({
          concurrency: 3,
          limiter: { max: 10, duration: 60_000 },
        })
      );
    });

    it('processes a render job by calling renderPdf with job data', async () => {
      const { Worker } = vi.mocked(await import('bullmq'));
      createPdfWorker(fakeConnection);
      const firstCall = (Worker as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
      const processor = firstCall![1] as (job: { data: unknown }) => Promise<unknown>;

      await processor({ data: { url: 'http://test' } });
      expect(mockRenderPdf).toHaveBeenCalledWith({ url: 'http://test' });
    });
  });

  describe('startWorkers', () => {
    it('with role "all" starts the pdf worker and the job workers', async () => {
      const result = await startWorkers(fakeConnection, 'all');

      expect(mockEnsureJobSchedules).toHaveBeenCalledTimes(1);
      expect(mockCreateJobWorkers).toHaveBeenCalledTimes(1);
      expect(result.workers.length).toBeGreaterThanOrEqual(1);

      await result.closeAll();
    });
  });
});
