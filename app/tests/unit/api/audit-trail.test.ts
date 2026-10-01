import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST as CREATE_REPORT } from '@/app/api/scheduled-reports/route';
import {
  PATCH as UPDATE_REPORT,
  DELETE as DELETE_REPORT,
} from '@/app/api/scheduled-reports/[id]/route';
import {
  PATCH as UPDATE_DASHBOARD,
  DELETE as DELETE_DASHBOARD,
} from '@/app/api/dashboards/[id]/route';
import { db } from '@/db/client';
import { audit } from '@/lib/audit/log';

const { ORG_ID, USER_ID, AUTH_CTX } = vi.hoisted(() => {
  const ORG_ID = '00000000-0000-4000-a000-000000000001';
  const USER_ID = 'user-123';
  return {
    ORG_ID,
    USER_ID,
    AUTH_CTX: {
      session: { user: { id: USER_ID, email: 'admin@dash-bi.local' } },
      orgId: ORG_ID,
      userId: USER_ID,
      role: 'admin',
    },
  };
});

vi.mock('@/lib/auth/request', () => ({
  requireAuth: vi.fn().mockResolvedValue(AUTH_CTX),
  getAuthContext: vi.fn().mockResolvedValue(AUTH_CTX),
}));

/** `withOrgContext` has 3-arg and 4-arg (role) overloads; the callback is last. */
function lastArgIsCallback(args: unknown[]) {
  return (args[args.length - 1] as (tx: unknown) => unknown)(db);
}

vi.mock('@/db/client', () => ({
  db: { select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn() },
  withOrgContext: vi.fn((...args: unknown[]) => lastArgIsCallback(args)),
  withOrgContextReadOnly: vi.fn((...args: unknown[]) => lastArgIsCallback(args)),
  withSystemContext: vi.fn((...args: unknown[]) => lastArgIsCallback(args)),
}));

vi.mock('@/lib/audit/log', () => ({ audit: vi.fn() }));

/** Thenable that answers every terminal Drizzle method these routes use. */
function chain(result: unknown) {
  const promise = Promise.resolve(result);
  const thenable: Record<string, unknown> = {
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    finally: promise.finally.bind(promise),
  };
  for (const method of ['returning', 'where', 'limit', 'orderBy', 'from']) {
    thenable[method] = vi.fn().mockReturnValue(thenable);
  }
  return thenable;
}

function mockDb(result: unknown) {
  (db.select as ReturnType<typeof vi.fn>).mockReturnValue(chain(result));
  (db.insert as ReturnType<typeof vi.fn>).mockReturnValue({
    values: vi.fn().mockReturnValue(chain(result)),
  });
  (db.update as ReturnType<typeof vi.fn>).mockReturnValue({
    set: vi.fn().mockReturnValue(chain(result)),
  });
  (db.delete as ReturnType<typeof vi.fn>).mockReturnValue({
    where: vi.fn().mockReturnValue(chain(result)),
  });
  // `dashboards/[id]` PATCH reads the previous version through Drizzle's
  // relational API to compute the next version number.
  (db as unknown as { query: unknown }).query = {
    dashboardVersions: { findFirst: vi.fn().mockResolvedValue({ version: 3 }) },
  };
}

const REPORT = { id: 'report-1', orgId: ORG_ID, dashboardId: 'dash-1' };
const DASHBOARD = { id: 'dash-1', orgId: ORG_ID, title: 'Renamed', widgets: [], theme: 'moderno-saas' };

describe('T10 — every state-mutating route leaves an audit trail', () => {
  beforeEach(() => vi.clearAllMocks());

  it('POST /api/scheduled-reports records scheduled_report.created', async () => {
    mockDb([REPORT]);

    const res = await CREATE_REPORT(
      new Request('http://localhost:3000/api/scheduled-reports', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          dashboardId: '11111111-1111-4111-a111-111111111111',
          title: 'Weekly revenue',
          cron: '0 9 * * 1',
          timezone: 'UTC',
          format: 'pdf',
          includeBranding: false,
          recipients: [{ email: 'cfo@corp.com' }],
        }),
      }),
    );

    expect(res.status).toBe(201);
    expect(audit).toHaveBeenCalledWith(
      ORG_ID,
      USER_ID,
      'scheduled_report.created',
      'scheduled_report:report-1',
      expect.objectContaining({
        metadata: expect.objectContaining({ recipients: ['cfo@corp.com'] }),
      }),
    );
  });

  it('PATCH /api/scheduled-reports/[id] records scheduled_report.updated', async () => {
    mockDb([REPORT]);

    const res = await UPDATE_REPORT(
      new Request('http://localhost:3000/api/scheduled-reports/report-1', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      }),
      { params: Promise.resolve({ id: 'report-1' }) },
    );

    expect(res.status).toBe(200);
    expect(audit).toHaveBeenCalledWith(
      ORG_ID,
      USER_ID,
      'scheduled_report.updated',
      'scheduled_report:report-1',
      expect.anything(),
    );
  });

  it('DELETE /api/scheduled-reports/[id] records scheduled_report.deleted', async () => {
    mockDb([REPORT]);

    const res = await DELETE_REPORT(
      new Request('http://localhost:3000/api/scheduled-reports/report-1', { method: 'DELETE' }),
      { params: Promise.resolve({ id: 'report-1' }) },
    );

    expect(res.status).toBe(200);
    expect(audit).toHaveBeenCalledWith(
      ORG_ID,
      USER_ID,
      'scheduled_report.deleted',
      'scheduled_report:report-1',
      expect.anything(),
    );
  });

  it('PATCH /api/dashboards/[id] records dashboard.updated', async () => {
    mockDb([DASHBOARD]);

    const res = await UPDATE_DASHBOARD(
      new Request('http://localhost:3000/api/dashboards/dash-1', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Renamed' }),
      }),
      { params: Promise.resolve({ id: 'dash-1' }) },
    );

    expect(res.status).toBe(200);
    expect(audit).toHaveBeenCalledWith(
      ORG_ID,
      USER_ID,
      'dashboard.updated',
      'dashboard:dash-1',
      expect.anything(),
    );
  });

  it('DELETE /api/dashboards/[id] records dashboard.deleted', async () => {
    mockDb([DASHBOARD]);

    const res = await DELETE_DASHBOARD(
      new Request('http://localhost:3000/api/dashboards/dash-1', { method: 'DELETE' }),
      { params: Promise.resolve({ id: 'dash-1' }) },
    );

    expect(res.status).toBe(200);
    expect(audit).toHaveBeenCalledWith(
      ORG_ID,
      USER_ID,
      'dashboard.deleted',
      'dashboard:dash-1',
      expect.anything(),
    );
  });
});
