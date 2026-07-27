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

import { POST } from '@/app/api/onboarding/step/route';

function makeReq(body: unknown): Request {
  return new Request('http://localhost/api/onboarding/step', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-org-id': 'org-test',
      'x-user-id': 'user-test',
    },
    body: JSON.stringify(body),
  });
}

describe('POST /api/onboarding/step', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequirePermission.mockResolvedValue(undefined);
    const where = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn().mockReturnValue({ where });
    mockDbUpdate.mockReturnValue({ set });
  });

  it('updates currentOnboardingStep inside withOrgContext', async () => {
    const res = await POST(makeReq({ step: 'choose_source' }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true });
    expect(mockWithOrgContext).toHaveBeenCalledWith('org-test', 'user-test', expect.any(Function));
    expect(mockDbUpdate).toHaveBeenCalledTimes(1);
    const setCall = (mockDbUpdate.mock.results[0]?.value as { set: ReturnType<typeof vi.fn> }).set.mock.calls[0]?.[0] as {
      currentOnboardingStep: string;
    };
    expect(setCall.currentOnboardingStep).toBe('choose_source');
  });

  it('records onboardingDataSourceId when provided', async () => {
    const validUuid = '550e8400-e29b-41d4-a716-446655440000';
    const res = await POST(
      makeReq({ step: 'prompt', dataSourceId: validUuid })
    );
    expect(res.status).toBe(200);
    const setCall = (mockDbUpdate.mock.results[0]?.value as { set: ReturnType<typeof vi.fn> }).set.mock.calls[0]?.[0] as {
      currentOnboardingStep: string;
      onboardingDataSourceId: string;
    };
    expect(setCall.currentOnboardingStep).toBe('prompt');
    expect(setCall.onboardingDataSourceId).toBe(validUuid);
  });

  it('rejects invalid step values', async () => {
    const res = await POST(makeReq({ step: 'invalid' }));
    expect(res.status).toBe(400);
    expect(mockDbUpdate).not.toHaveBeenCalled();
  });

  it('rejects when x-org-id header is missing', async () => {
    const req = new Request('http://localhost/api/onboarding/step', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-user-id': 'user-test' },
      body: JSON.stringify({ step: 'choose_source' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(mockDbUpdate).not.toHaveBeenCalled();
  });
});