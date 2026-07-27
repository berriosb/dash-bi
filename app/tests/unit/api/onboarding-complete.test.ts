import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockDbUpdate,
  mockWithOrgContext,
  mockRequirePermission,
  mockAudit,
} = vi.hoisted(() => ({
  mockDbUpdate: vi.fn(),
  mockWithOrgContext: vi.fn(
    async (_orgId: string, _userId: string | null, fn: () => Promise<unknown>) => fn()
  ),
  mockRequirePermission: vi.fn().mockResolvedValue(undefined),
  mockAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/db/client', () => ({
  db: { update: mockDbUpdate },
  withOrgContext: mockWithOrgContext,
}));

vi.mock('@/lib/auth/context', () => ({
  requirePermission: mockRequirePermission,
}));

vi.mock('@/lib/audit/log', () => ({
  audit: mockAudit,
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((a: unknown, b: unknown) => ({ op: 'eq', a, b })),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { POST } from '@/app/api/onboarding/complete/route';

function makeReq(): Request {
  return new Request('http://localhost/api/onboarding/complete', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-org-id': 'org-test',
      'x-user-id': 'user-test',
    },
  });
}

describe('POST /api/onboarding/complete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequirePermission.mockResolvedValue(undefined);
    const where = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn().mockReturnValue({ where });
    mockDbUpdate.mockReturnValue({ set });
  });

  it('marks onboarding complete by setting onboardingCompletedAt and step=completed', async () => {
    const res = await POST(makeReq());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true });
    const setCall = (mockDbUpdate.mock.results[0]?.value as { set: ReturnType<typeof vi.fn> }).set.mock.calls[0]?.[0] as {
      currentOnboardingStep: string;
      onboardingCompletedAt: Date;
    };
    expect(setCall.currentOnboardingStep).toBe('completed');
    expect(setCall.onboardingCompletedAt).toBeInstanceOf(Date);
  });

  it('persists inside withOrgContext for RLS isolation', async () => {
    await POST(makeReq());
    expect(mockWithOrgContext).toHaveBeenCalledWith('org-test', 'user-test', expect.any(Function));
  });

  it('rejects when x-org-id header is missing', async () => {
    const req = new Request('http://localhost/api/onboarding/complete', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-user-id': 'user-test' },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(mockDbUpdate).not.toHaveBeenCalled();
  });
});