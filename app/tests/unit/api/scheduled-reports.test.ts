import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET, POST } from '@/app/api/scheduled-reports/route';
import { GET as GET_ONE, PATCH, DELETE } from '@/app/api/scheduled-reports/[id]/route';
import { db } from '@/db/client';

vi.mock('@/lib/auth/request', () => ({
  requireAuth: vi.fn().mockResolvedValue({
    session: { user: { id: 'user-123', email: 'admin@dash-bi.local' } },
    orgId: '00000000-0000-4000-a000-000000000001',
    userId: 'user-123',
    role: 'owner',
  }),
}));

vi.mock('@/db/client', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  withOrgContext: vi.fn((orgId, userId, fn) => fn(db)),
}));

describe('Scheduled Reports API Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/scheduled-reports', () => {
    it('returns array of scheduled reports for org', async () => {
      const mockReports = [
        {
          id: 'report-1',
          orgId: '00000000-0000-4000-a000-000000000001',
          dashboardId: 'dash-1',
          cron: '0 9 * * 1',
          enabled: true,
        },
      ];

      (db.select as any).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue(mockReports),
          }),
        }),
      });

      const res = await GET(new Request('http://localhost:3000/api/scheduled-reports'));
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.reports).toHaveLength(1);
      expect(json.reports[0].id).toBe('report-1');
    });
  });

  describe('POST /api/scheduled-reports', () => {
    it('validates request payload and creates scheduled report', async () => {
      const createdReport = {
        id: 'report-new',
        orgId: '00000000-0000-4000-a000-000000000001',
        dashboardId: '00000000-0000-4000-a000-000000000002',
        cron: '0 9 * * 1',
        recipients: [{ email: 'exec@empresa.com' }],
        format: 'pdf',
        enabled: true,
      };

      (db.insert as any).mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([createdReport]),
        }),
      });

      const body = {
        dashboardId: '00000000-0000-4000-a000-000000000002',
        cron: '0 9 * * 1',
        recipients: [{ email: 'exec@empresa.com' }],
        format: 'pdf',
        title: 'Reporte Semanal',
      };

      const req = new Request('http://localhost:3000/api/scheduled-reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const res = await POST(req);
      expect(res.status).toBe(201);

      const json = await res.json();
      expect(json.report.id).toBe('report-new');
    });

    it('rejects invalid cron expression', async () => {
      const body = {
        dashboardId: '00000000-0000-4000-a000-000000000002',
        cron: 'invalid-cron',
        recipients: [{ email: 'exec@empresa.com' }],
      };

      const req = new Request('http://localhost:3000/api/scheduled-reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const res = await POST(req);
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/scheduled-reports/[id]', () => {
    it('returns report and run history for valid id', async () => {
      const mockReport = {
        id: 'report-1',
        orgId: '00000000-0000-4000-a000-000000000001',
        cron: '0 9 * * 1',
      };

      (db.select as any)
        .mockImplementationOnce(() => ({
          from: () => ({
            where: () => Promise.resolve([mockReport]),
          }),
        }))
        .mockImplementationOnce(() => ({
          from: () => ({
            where: () => ({
              orderBy: () => ({
                limit: () => Promise.resolve([]),
              }),
            }),
          }),
        }));

      const res = await GET_ONE(new Request('http://localhost:3000/api/scheduled-reports/report-1'), {
        params: Promise.resolve({ id: 'report-1' }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.report.id).toBe('report-1');
      expect(json.runs).toBeDefined();
    });
  });

  describe('PATCH /api/scheduled-reports/[id]', () => {
    it('updates report enabled state and cron', async () => {
      const updatedReport = {
        id: 'report-1',
        orgId: '00000000-0000-4000-a000-000000000001',
        enabled: false,
      };

      (db.update as any).mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([updatedReport]),
          }),
        }),
      });

      const req = new Request('http://localhost:3000/api/scheduled-reports/report-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      });

      const res = await PATCH(req, { params: Promise.resolve({ id: 'report-1' }) });
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.report.enabled).toBe(false);
    });
  });

  describe('DELETE /api/scheduled-reports/[id]', () => {
    it('deletes report by id', async () => {
      (db.delete as any).mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 'report-1' }]),
        }),
      });

      const res = await DELETE(new Request('http://localhost:3000/api/scheduled-reports/report-1'), {
        params: Promise.resolve({ id: 'report-1' }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
    });
  });
});
