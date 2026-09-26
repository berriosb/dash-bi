import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockQueueAdd } = vi.hoisted(() => ({
  mockQueueAdd: vi.fn(),
}));

const mockQueueInstance = {
  add: mockQueueAdd,
};

vi.mock('bullmq', () => ({
  Queue: vi.fn(() => mockQueueInstance),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import {
  SCHEDULED_REPORTS_QUEUE,
  ensureScheduledReportsScheduled,
  getScheduledReportsQueue,
} from '@/lib/reports/queue';

describe('Scheduled Reports Queue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueueAdd.mockResolvedValue({ id: 'rep-job-1' });
  });

  it('exports the correct queue name', () => {
    expect(SCHEDULED_REPORTS_QUEUE).toBe('scheduled-reports-due');
  });

  it('creates a Queue instance with the queue name', () => {
    const fakeConn = {} as never;
    const q = getScheduledReportsQueue(fakeConn);
    expect(q).toBeDefined();
  });

  it('schedules a repeatable dispatch job every minute', async () => {
    const fakeConn = {} as never;
    await ensureScheduledReportsScheduled(fakeConn);

    expect(mockQueueAdd).toHaveBeenCalledWith(
      'dispatch',
      {},
      expect.objectContaining({
        repeat: expect.objectContaining({
          pattern: '* * * * *',
        }),
        jobId: 'scheduled-reports-repeat',
      })
    );
  });
});
