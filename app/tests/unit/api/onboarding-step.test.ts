import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UnauthorizedError } from '@/lib/auth/context';

const { mockTxUpdate, mockWithOrgContext, mockRequireAuth } = vi.hoisted(() => ({
  mockTxUpdate: vi.fn(),
  mockWithOrgContext: vi.fn(),
  mockRequireAuth: vi.fn(),
}));

vi.mock('@/db/client', () => ({
  withOrgContext: mockWithOrgContext,
}));


vi.mock('@/lib/auth/request', () => ({
  requireAuth: mockRequireAuth,
}));


vi.mock('@/lib/audit/log', () => ({
  audit: vi.fn().mockResolvedValue(undefined),
}));


vi.mock('drizzle-orm', () => ({
  eq: vi.fn((a: unknown, b: unknown) => ({ op: 'eq', a, b })),
}));


vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));


import { POST } from '@/app/api/onboarding/step/route';
import { users } from '@/db/schema';

function makeReq(body: unknown): Request {
  return new Request('http://localhost/api/onboarding/step', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/onboarding/step', () => {
  // Kept in scope so the tests can assert what reached the users table.
  let where: ReturnType<typeof vi.fn>;
  let set: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockTxUpdate.mockReset();
    mockWithOrgContext.mockReset();
    mockRequireAuth.mockReset();
    mockRequireAuth.mockResolvedValue({
      userId: 'user-test',
      email: 'a@b.com',
      orgId: 'org-test',
      role: 'admin',
    });
    (mockWithOrgContext as unknown as { mockImplementation: (impl: (...args: unknown[]) => Promise<unknown>) => void }).mockImplementation((...args: unknown[]) => {
      // withOrgContext(orgId, userId, [role,] fn) — the last arg is the callback.
      const fn = args[args.length - 1] as (tx: unknown) => Promise<unknown>;
      return fn({ update: mockTxUpdate });
    });
    where = vi.fn().mockResolvedValue(undefined);
    set = vi.fn().mockReturnValue({ where });
    mockTxUpdate.mockReturnValue({ set });
  });

  it('updates currentOnboardingStep on the users table under the caller org', async () => {
    const res = await POST(makeReq({ step: 'choose_source' }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true });
    expect(mockWithOrgContext).toHaveBeenCalledTimes(1);
    expect(mockWithOrgContext).toHaveBeenCalledWith(
      'org-test',
      'user-test',
      'admin',
      expect.any(Function),
    );
    expect(mockTxUpdate).toHaveBeenCalledTimes(1);
    expect(mockTxUpdate).toHaveBeenCalledWith(users);
    const setCall = set.mock.calls[0]?.[0] as {
      currentOnboardingStep: string;
    };
    expect(setCall.currentOnboardingStep).toBe('choose_source');
    expect(where).toHaveBeenCalledTimes(1);
    // eq(users.id, ctx.userId) — the UPDATE is scoped to the caller only.
    expect(where).toHaveBeenCalledWith({
      op: 'eq',
      a: users.id,
      b: 'user-test',
    });
  });

  it('records onboardingDataSourceId when provided', async () => {
    const validUuid = '550e8400-e29b-41d4-a716-446655440000';
    const res = await POST(
      makeReq({ step: 'prompt', dataSourceId: validUuid })
    );
    expect(res.status).toBe(200);
    const setCall = set.mock.calls[0]?.[0] as {
      currentOnboardingStep: string;
      onboardingDataSourceId: string;
    };
    expect(setCall.currentOnboardingStep).toBe('prompt');
    expect(setCall.onboardingDataSourceId).toBe(validUuid);
  });

  it('omits onboardingDataSourceId when not provided', async () => {
    const res = await POST(makeReq({ step: 'welcome' }));
    expect(res.status).toBe(200);
    const setCall = set.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(setCall).toEqual({ currentOnboardingStep: 'welcome' });
  });

  it('rejects invalid step values', async () => {
    const res = await POST(makeReq({ step: 'invalid' }));
    expect(res.status).toBe(400);
    expect(mockTxUpdate).not.toHaveBeenCalled();
  });

  it('returns 401 when session is invalid', async () => {
    mockRequireAuth.mockRejectedValueOnce(
      new UnauthorizedError()
    );
    const res = await POST(makeReq({ step: 'choose_source' }));
    expect(res.status).toBe(401);
    expect(mockTxUpdate).not.toHaveBeenCalled();
  });
});
