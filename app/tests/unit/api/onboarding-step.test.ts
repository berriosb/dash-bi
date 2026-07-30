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


import { POST } from '@/app/api/onboarding/step/route';

function makeReq(body: unknown): Request {
  return new Request('http://localhost/api/onboarding/step', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/onboarding/step', () => {
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

  it('updates currentOnboardingStep inside withSystemContext', async () => {
    const res = await POST(makeReq({ step: 'choose_source' }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true });
    expect(mockWithSystemContext).toHaveBeenCalledTimes(1);
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

  it('returns 401 when session is invalid', async () => {
    mockRequireAuth.mockRejectedValueOnce(
      new UnauthorizedError()
    );
    const res = await POST(makeReq({ step: 'choose_source' }));
    expect(res.status).toBe(401);
    expect(mockDbUpdate).not.toHaveBeenCalled();
  });
});
