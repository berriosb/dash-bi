import { describe, it, expect, vi, beforeEach } from 'vitest';

// Define mocks inside vi.hoisted so that vi.mock factories (also hoisted)
// can reference them without hitting a TDZ.
const { mockRenderPdf, mockWorkerInstance } = vi.hoisted(() => {
  const instance = {
    on: vi.fn().mockReturnThis(),
    close: vi.fn().mockResolvedValue(undefined),
  };
  return {
    mockRenderPdf: vi.fn(),
    mockWorkerInstance: instance,
  };
});

vi.mock('bullmq', () => ({
  Worker: vi.fn(() => mockWorkerInstance),
}));

vi.mock('@/worker/render-pdf', () => ({
  renderPdf: mockRenderPdf,
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('ioredis', () => ({
  default: vi.fn(),
  Redis: vi.fn(),
}));

import { createPdfWorker } from '@/worker/index';

const fakeConnection = {} as never;

describe('createPdfWorker', () => {
  beforeEach(() => {
    mockWorkerInstance.on.mockClear();
    mockWorkerInstance.close.mockClear();
    mockRenderPdf.mockReset();
    mockRenderPdf.mockResolvedValue({ buffer: Buffer.from('PDF') });
  });

  it('creates a BullMQ Worker subscribed to the pdf-export queue', async () => {
    createPdfWorker(fakeConnection);
    const { Worker } = vi.mocked(await import('bullmq'));

    expect(Worker).toHaveBeenCalledTimes(1);
    expect(Worker).toHaveBeenCalledWith(
      'pdf-export',
      expect.any(Function),
      expect.objectContaining({
        concurrency: 3,
        limiter: { max: 10, duration: 60_000 },
      })
    );
  });

  it('registers handlers for completed, failed, and error events', async () => {
    createPdfWorker(fakeConnection);

    expect(mockWorkerInstance.on).toHaveBeenCalledWith('completed', expect.any(Function));
    expect(mockWorkerInstance.on).toHaveBeenCalledWith('failed', expect.any(Function));
    expect(mockWorkerInstance.on).toHaveBeenCalledWith('error', expect.any(Function));
  });

  it('processes a render job by calling renderPdf with job data', async () => {
    const { Worker } = vi.mocked(await import('bullmq'));
    createPdfWorker(fakeConnection);
    const firstCall = (Worker as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    const processor = firstCall![1] as (
      job: { data: { url: string; options: unknown; branding: unknown } }
    ) => Promise<unknown>;

    const result = await processor({
      data: {
        url: 'http://localhost/dashboard/d1/print?token=t',
        options: { pageSize: 'A4' },
        branding: { logoUrl: 'https://cdn/logo.png' },
      },
    });

    expect(mockRenderPdf).toHaveBeenCalledWith({
      url: 'http://localhost/dashboard/d1/print?token=t',
      options: { pageSize: 'A4' },
      branding: { logoUrl: 'https://cdn/logo.png' },
    });
    expect(result).toEqual({ buffer: expect.any(Buffer) });
  });

  it('propagates renderPdf errors so BullMQ marks the job as failed', async () => {
    const { Worker } = vi.mocked(await import('bullmq'));
    createPdfWorker(fakeConnection);
    const firstCall = (Worker as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    const processor = firstCall![1] as (
      job: { data: unknown }
    ) => Promise<unknown>;

    mockRenderPdf.mockRejectedValueOnce(new Error('puppeteer crashed'));
    await expect(processor({ data: {} })).rejects.toThrow('puppeteer crashed');
  });
});