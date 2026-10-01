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


import { POST } from '@/app/api/onboarding/complete/route';
import { users } from '@/db/schema';

function makeReq(): Request {
  return new Request('http://localhost/api/onboarding/complete', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
  });
}

describe('POST /api/onboarding/complete', () => {
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

  it('marks onboarding complete by setting onboardingCompletedAt and step=completed', async () => {
    const res = await POST(makeReq());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true });
    const setCall = set.mock.calls[0]?.[0] as {
      currentOnboardingStep: string;
      onboardingCompletedAt: Date;
    };
    expect(setCall.currentOnboardingStep).toBe('completed');
    expect(setCall.onboardingCompletedAt).toBeInstanceOf(Date);
  });

  it('updates the caller row on the users table under the caller org', async () => {
    await POST(makeReq());

    expect(mockWithOrgContext).toHaveBeenCalledTimes(1);
    expect(mockWithOrgContext).toHaveBeenCalledWith(
      'org-test',
      'user-test',
      'admin',
      expect.any(Function),
    );
    expect(mockTxUpdate).toHaveBeenCalledTimes(1);
    expect(mockTxUpdate).toHaveBeenCalledWith(users);
    expect(where).toHaveBeenCalledTimes(1);
    // eq(users.id, ctx.userId) — the UPDATE is scoped to the caller only.
    expect(where).toHaveBeenCalledWith({
      op: 'eq',
      a: users.id,
      b: 'user-test',
    });
  });

  it('returns 401 when session is invalid', async () => {
    mockRequireAuth.mockRejectedValueOnce(
      new UnauthorizedError()
    );
    const res = await POST(makeReq());
    expect(res.status).toBe(401);
  });
});
