import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The worker process runs two very different things:
 *
 * - the PDF RENDERER, which loads tenant-controlled content in Chrome;
 * - the job runner (alerts, scheduled reports), which needs the database
 *   and the master key that decrypts every BYOK.
 *
 * Running both in one container means the container that renders tenant
 * content also holds the DB owner credentials and the master key. The
 * split is what makes the isolation real: the renderer container gets
 * neither.
 */
const { mockWorkerCtor, mockCreateJobWorkers, mockEnsureJobSchedules } = vi.hoisted(() => ({
  mockWorkerCtor: vi.fn(),
  mockCreateJobWorkers: vi.fn(() => []),
  mockEnsureJobSchedules: vi.fn(),
}));

vi.mock('bullmq', () => ({
  Worker: mockWorkerCtor,
  Queue: vi.fn(),
  Job: vi.fn(),
}));

vi.mock('@/worker/job-workers', () => ({
  createJobWorkers: mockCreateJobWorkers,
  ensureJobSchedules: mockEnsureJobSchedules,
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { resolveWorkerRole, startWorkers } from '@/worker/index';

describe('worker role', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWorkerCtor.mockImplementation(function () {
      return { close: vi.fn(), on: vi.fn() };
    });
    mockCreateJobWorkers.mockReturnValue([]);
  });

  describe('resolveWorkerRole', () => {
    it('defaults to all when the variable is absent', () => {
      expect(resolveWorkerRole(undefined)).toBe('all');
      expect(resolveWorkerRole('')).toBe('all');
    });

    it('accepts the three roles', () => {
      expect(resolveWorkerRole('pdf')).toBe('pdf');
      expect(resolveWorkerRole('jobs')).toBe('jobs');
      expect(resolveWorkerRole('all')).toBe('all');
    });

    it('is case insensitive', () => {
      expect(resolveWorkerRole('PDF')).toBe('pdf');
    });

    it('fails fast on an unknown role instead of running everything', () => {
      expect(() => resolveWorkerRole('pdf-and-everything')).toThrow(/WORKER_ROLE/);
    });
  });

  it('with role=pdf does not load the job workers at all', async () => {
    await startWorkers({} as never, 'pdf');

    expect(mockCreateJobWorkers).not.toHaveBeenCalled();
    expect(mockEnsureJobSchedules).not.toHaveBeenCalled();
    // Only the pdf queue is subscribed.
    const queues = mockWorkerCtor.mock.calls.map((call) => (call[0] as string));
    expect(queues).toEqual(['pdf-export']);
  });

  it('with role=jobs does not subscribe the pdf queue', async () => {
    await startWorkers({} as never, 'jobs');

    expect(mockCreateJobWorkers).toHaveBeenCalledTimes(1);
    const queues = mockWorkerCtor.mock.calls.map((call) => (call[0] as string));
    expect(queues).not.toContain('pdf-export');
  });

  it('with role=all starts both', async () => {
    await startWorkers({} as never, 'all');

    expect(mockCreateJobWorkers).toHaveBeenCalledTimes(1);
    const queues = mockWorkerCtor.mock.calls.map((call) => (call[0] as string));
    expect(queues).toContain('pdf-export');
  });
});
