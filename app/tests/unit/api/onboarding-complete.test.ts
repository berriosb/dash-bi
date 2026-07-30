import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UnauthorizedError, ForbiddenError } from '@/lib/auth/context';

const {
  mockDbUpdate,
  mockWithSystemContext,
  mockRequireAuth,
} = vi.hoisted(() => ({
  mockDbUpdate: vi.fn(),
  mockWithSystemContext: vi.fn(
    async (..._args: unknown[]) => undefined
  ),
  mockRequireAuth: vi.fn(),
}));

vi.mock('@/db/client', () => ({
  db: { update: mockDbUpdate },
  withSystemContext: mockWithSystemContext,
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

function makeReq(): Request {
  return new Request('http://localhost/api/onboarding/complete', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
  });
}

describe('POST /api/onboarding/complete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbUpdate.mockReset();
    mockWithSystemContext.mockReset();
    mockRequireAuth.mockReset();
    mockRequireAuth.mockResolvedValue({
      userId: 'user-test',
      email: 'a@b.com',
      orgId: 'org-test',
      role: 'admin',
    });
    (mockWithSystemContext as unknown as { mockImplementation: (impl: (fn: unknown) => Promise<unknown>) => void }).mockImplementation((fn: unknown) => (fn as (tx: { update: typeof mockDbUpdate }) => Promise<unknown>)({ update: mockDbUpdate }) ?? Promise.resolve(undefined));
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

  it('persists inside withSystemContext', async () => {
    await POST(makeReq());
    expect(mockWithSystemContext).toHaveBeenCalledTimes(1);
  });

  it('returns 401 when session is invalid', async () => {
    mockRequireAuth.mockRejectedValueOnce(
      new UnauthorizedError()
    );
    const res = await POST(makeReq());
    expect(res.status).toBe(401);
  });
});
