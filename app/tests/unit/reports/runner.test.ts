import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processDueScheduledReports } from '@/lib/reports/runner';
import { db } from '@/db/client';
import { enqueuePdfExport } from '@/lib/export/pdf-enqueue';
import { sendEmail } from '@/lib/email';

vi.mock('@/db/client', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
  },
  withOrgContext: vi.fn((orgId, userId, fn) => fn(db)),
}));

vi.mock('@/lib/export/pdf-enqueue', () => ({
  enqueuePdfExport: vi.fn().mockResolvedValue('pdf-job-123'),
}));

vi.mock('@/lib/email', () => ({
  sendEmail: vi.fn().mockResolvedValue({ id: 'email-123' }),
}));

describe('Scheduled Reports Runner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('processes due reports and updates run records and nextRunAt', async () => {
    const dueReport = {
      id: 'rep-1',
      orgId: '00000000-0000-4000-a000-000000000001',
      dashboardId: 'dash-1',
      createdBy: 'user-1',
      cron: '0 9 * * 1',
      enabled: true,
      includeBranding: true,
      recipients: [{ email: 'board@company.com' }],
      nextRunAt: new Date('2026-07-27T08:00:00Z'),
    };

    (db.select as any).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([dueReport]),
      }),
    });

    (db.insert as any).mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: 'run-1' }]),
      }),
    });

    (db.update as any).mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    });

    const res = await processDueScheduledReports({ now: new Date('2026-07-27T09:00:00Z') });

    expect(res.processed).toBe(1);
    expect(res.results[0]?.status).toBe('success');
    expect(enqueuePdfExport).toHaveBeenCalledWith({
      dashboardId: 'dash-1',
      orgId: '00000000-0000-4000-a000-000000000001',
      userId: 'user-1',
    });
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ['board@company.com'],
      })
    );
  });
});
