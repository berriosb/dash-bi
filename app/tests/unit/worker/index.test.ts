import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockRenderPdf,
  mockWorkerInstance,
  mockRunAlertDispatcher,
  mockRunAlertEvaluator,
  mockProcessDueReports,
  mockEnsureDispatcherScheduled,
  mockEnsureReportsScheduled,
} = vi.hoisted(() => {
  const instance = {
    on: vi.fn().mockReturnThis(),
    close: vi.fn().mockResolvedValue(undefined),
  };
  return {
    mockRenderPdf: vi.fn(),
    mockWorkerInstance: instance,
    mockRunAlertDispatcher: vi.fn(),
    mockRunAlertEvaluator: vi.fn(),
    mockProcessDueReports: vi.fn(),
    mockEnsureDispatcherScheduled: vi.fn(),
    mockEnsureReportsScheduled: vi.fn(),
  };
});

vi.mock('bullmq', () => ({
  Worker: vi.fn(() => mockWorkerInstance),
}));

vi.mock('@/worker/render-pdf', () => ({
  renderPdf: mockRenderPdf,
}));

vi.mock('@/lib/alerts/dispatcher', () => ({
  runAlertDispatcher: mockRunAlertDispatcher,
}));

vi.mock('@/lib/alerts/evaluator', () => ({
  runAlertEvaluator: mockRunAlertEvaluator,
}));

vi.mock('@/lib/alerts/queue', () => ({
  ALERT_DISPATCHER_QUEUE: 'alert-dispatcher',
  ALERT_EVALUATE_QUEUE: 'alert-evaluate',
  ensureDispatcherScheduled: mockEnsureDispatcherScheduled,
}));

vi.mock('@/lib/reports/runner', () => ({
  processDueScheduledReports: mockProcessDueReports,
}));

vi.mock('@/lib/reports/queue', () => ({
  SCHEDULED_REPORTS_QUEUE: 'scheduled-reports-due',
  ensureScheduledReportsScheduled: mockEnsureReportsScheduled,
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('ioredis', () => ({
  default: vi.fn(),
  Redis: vi.fn(),
}));

import {
  createPdfWorker,
  createAlertDispatcherWorker,
  createAlertEvaluatorWorker,
  createScheduledReportsWorker,
  startAllWorkers,
} from '@/worker/index';

const fakeConnection = {} as never;

describe('Worker System', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWorkerInstance.on.mockClear();
    mockWorkerInstance.close.mockClear();
    mockRenderPdf.mockReset();
    mockRenderPdf.mockResolvedValue({ buffer: Buffer.from('PDF') });
    mockRunAlertDispatcher.mockReset();
    mockRunAlertDispatcher.mockResolvedValue({ enqueued: 2 });
    mockRunAlertEvaluator.mockReset();
    mockRunAlertEvaluator.mockResolvedValue({ breached: false, fired: false });
    mockProcessDueReports.mockReset();
    mockProcessDueReports.mockResolvedValue({ processed: 1 });
    mockEnsureDispatcherScheduled.mockReset();
    mockEnsureDispatcherScheduled.mockResolvedValue(undefined);
    mockEnsureReportsScheduled.mockReset();
    mockEnsureReportsScheduled.mockResolvedValue(undefined);
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

  describe('createAlertDispatcherWorker', () => {
    it('creates a BullMQ Worker subscribed to alert-dispatcher queue', async () => {
      createAlertDispatcherWorker(fakeConnection);
      const { Worker } = vi.mocked(await import('bullmq'));

      expect(Worker).toHaveBeenCalledWith(
        'alert-dispatcher',
        expect.any(Function),
        expect.objectContaining({ concurrency: 1 })
      );
    });

    it('calls runAlertDispatcher when job runs', async () => {
      const { Worker } = vi.mocked(await import('bullmq'));
      createAlertDispatcherWorker(fakeConnection);
      const firstCall = (Worker as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
      const processor = firstCall![1] as (job: unknown) => Promise<unknown>;

      const fakeJob = { id: 'job-disp-1' };
      await processor(fakeJob);
      expect(mockRunAlertDispatcher).toHaveBeenCalledWith(fakeJob);
    });
  });

  describe('createAlertEvaluatorWorker', () => {
    it('creates a BullMQ Worker subscribed to alert-evaluate queue', async () => {
      createAlertEvaluatorWorker(fakeConnection);
      const { Worker } = vi.mocked(await import('bullmq'));

      expect(Worker).toHaveBeenCalledWith(
        'alert-evaluate',
        expect.any(Function),
        expect.objectContaining({ concurrency: 5 })
      );
    });

    it('calls runAlertEvaluator when job runs', async () => {
      const { Worker } = vi.mocked(await import('bullmq'));
      createAlertEvaluatorWorker(fakeConnection);
      const firstCall = (Worker as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
      const processor = firstCall![1] as (job: unknown) => Promise<unknown>;

      const fakeJob = { id: 'job-eval-1', data: { alertRuleId: 'r1', correlationId: 'c1' } };
      await processor(fakeJob);
      expect(mockRunAlertEvaluator).toHaveBeenCalledWith(fakeJob);
    });
  });

  describe('createScheduledReportsWorker', () => {
    it('creates a BullMQ Worker subscribed to scheduled-reports-due queue', async () => {
      createScheduledReportsWorker(fakeConnection);
      const { Worker } = vi.mocked(await import('bullmq'));

      expect(Worker).toHaveBeenCalledWith(
        'scheduled-reports-due',
        expect.any(Function),
        expect.objectContaining({ concurrency: 1 })
      );
    });

    it('calls processDueScheduledReports when job runs', async () => {
      const { Worker } = vi.mocked(await import('bullmq'));
      createScheduledReportsWorker(fakeConnection);
      const firstCall = (Worker as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
      const processor = firstCall![1] as () => Promise<unknown>;

      await processor();
      expect(mockProcessDueReports).toHaveBeenCalledTimes(1);
    });
  });

  describe('startAllWorkers', () => {
    it('ensures schedules and instantiates all 4 workers', async () => {
      const result = await startAllWorkers(fakeConnection);

      expect(mockEnsureDispatcherScheduled).toHaveBeenCalledTimes(1);
      expect(mockEnsureReportsScheduled).toHaveBeenCalledTimes(1);
      expect(result.workers).toHaveLength(4);

      await result.closeAll();
      expect(mockWorkerInstance.close).toHaveBeenCalledTimes(4);
    });
  });
});