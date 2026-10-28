import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The job workers (alerts + scheduled reports) live in their own module
 * so the PDF renderer container never imports the database client or the
 * encryption module. See `src/worker/job-workers.ts`.
 */
const {
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
    mockWorkerInstance: instance,
    mockRunAlertDispatcher: vi.fn(),
    mockRunAlertEvaluator: vi.fn(),
    mockProcessDueReports: vi.fn(),
    mockEnsureDispatcherScheduled: vi.fn(),
    mockEnsureReportsScheduled: vi.fn(),
  };
});

vi.mock('bullmq', () => ({
  // Vitest 4 validates that a mocked implementation is constructible before
  // applying `new`, so a plain `function` replaces what used to be an arrow.
  Worker: vi.fn(function () {
    return mockWorkerInstance;
  }),
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

import { createJobWorkers, ensureJobSchedules } from '@/worker/job-workers';

const fakeConnection = {} as never;

/** The processor of the worker subscribed to a given queue. */
async function processorFor(queue: string): Promise<(job?: unknown) => Promise<unknown>> {
  createJobWorkers(fakeConnection);
  const { Worker } = vi.mocked(await import('bullmq'));
  const calls = (Worker as unknown as { mock: { calls: unknown[][] } }).mock.calls;
  const call = calls.find((c) => c[0] === queue);
  if (!call) throw new Error(`no worker subscribed to ${queue}`);
  return call[1] as (job?: unknown) => Promise<unknown>;
}

describe('Job workers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWorkerInstance.on.mockClear();
    mockWorkerInstance.close.mockClear();
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

  it('creates a BullMQ Worker subscribed to alert-dispatcher queue', async () => {
    createJobWorkers(fakeConnection);
    const { Worker } = vi.mocked(await import('bullmq'));

    expect(Worker).toHaveBeenCalledWith(
      'alert-dispatcher',
      expect.any(Function),
      expect.objectContaining({ concurrency: 1 })
    );
  });

  it('calls runAlertDispatcher when job runs', async () => {
    const processor = await processorFor('alert-dispatcher');

    const fakeJob = { id: 'job-disp-1' };
    await processor(fakeJob);
    expect(mockRunAlertDispatcher).toHaveBeenCalledWith(fakeJob);
  });

  it('creates a BullMQ Worker subscribed to alert-evaluate queue', async () => {
    createJobWorkers(fakeConnection);
    const { Worker } = vi.mocked(await import('bullmq'));

    expect(Worker).toHaveBeenCalledWith(
      'alert-evaluate',
      expect.any(Function),
      expect.objectContaining({ concurrency: 5 })
    );
  });

  it('calls runAlertEvaluator when job runs', async () => {
    const processor = await processorFor('alert-evaluate');

    const fakeJob = { id: 'job-eval-1', data: { alertRuleId: 'r1', correlationId: 'c1' } };
    await processor(fakeJob);
    expect(mockRunAlertEvaluator).toHaveBeenCalledWith(fakeJob);
  });

  it('creates a BullMQ Worker subscribed to scheduled-reports-due queue', async () => {
    createJobWorkers(fakeConnection);
    const { Worker } = vi.mocked(await import('bullmq'));

    expect(Worker).toHaveBeenCalledWith(
      'scheduled-reports-due',
      expect.any(Function),
      expect.objectContaining({ concurrency: 1 })
    );
  });

  it('calls processDueScheduledReports when job runs', async () => {
    const processor = await processorFor('scheduled-reports-due');

    await processor();
    expect(mockProcessDueReports).toHaveBeenCalledTimes(1);
  });

  it('registers the repeatable schedules', async () => {
    await ensureJobSchedules(fakeConnection);

    expect(mockEnsureDispatcherScheduled).toHaveBeenCalledTimes(1);
    expect(mockEnsureReportsScheduled).toHaveBeenCalledTimes(1);
  });
});
