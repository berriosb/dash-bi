import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { UnauthorizedError, ForbiddenError } from '@/lib/auth/context';

const mocks = vi.hoisted(() => ({
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
  mockRequireAuth: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: mocks.loggerInfo,
    warn: mocks.loggerWarn,
    error: mocks.loggerError,
    debug: vi.fn(),
  },
}));


vi.mock('@/lib/auth/request', () => ({
  requireAuth: mocks.mockRequireAuth,
}));


import { POST } from '@/app/api/onboarding/track/route';

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/onboarding/track', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('POST /api/onboarding/track', () => {
  beforeEach(() => {
    mocks.loggerInfo.mockReset();
    mocks.loggerWarn.mockReset();
    mocks.loggerError.mockReset();
    mocks.mockRequireAuth.mockReset();
    mocks.mockRequireAuth.mockResolvedValue({
      userId: 'user-1',
      email: 'a@b.com',
      orgId: 'org-1',
      role: 'admin',
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when there is no valid session', async () => {
    mocks.mockRequireAuth.mockRejectedValueOnce(
      new UnauthorizedError()
    );
    const res = await POST(makeRequest({ type: 'step_completed', step: 'welcome', durationMs: 100 }));
    expect(res.status).toBe(401);
    expect(mocks.loggerInfo).not.toHaveBeenCalled();
  });

  it('returns 400 on invalid JSON', async () => {
    const res = await POST(makeRequest('not json'));
    expect(res.status).toBe(400);
  });

  it('returns 400 on unknown event type', async () => {
    const res = await POST(makeRequest({ type: 'unknown_event' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when step_completed is missing required durationMs', async () => {
    const res = await POST(makeRequest({ type: 'step_completed', step: 'welcome' }));
    expect(res.status).toBe(400);
  });

  it('logs step_completed events with structured fields and returns 200', async () => {
    const res = await POST(
      makeRequest({
        type: 'step_completed',
        step: 'choose_source',
        sourceType: 'stripe',
        durationMs: 1234,
      })
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mocks.loggerInfo).toHaveBeenCalledTimes(1);
    const [payload, message] = mocks.loggerInfo.mock.calls[0] as [Record<string, unknown>, string];
    expect(message).toBe('onboarding step_completed');
    expect(payload).toMatchObject({
      event: 'onboarding:step_completed',
      userId: 'user-1',
      type: 'step_completed',
      step: 'choose_source',
      sourceType: 'stripe',
      durationMs: 1234,
    });
  });

  it('logs completed events with totalDurationMs + dashboardGenerated', async () => {
    const res = await POST(
      makeRequest({
        type: 'completed',
        totalDurationMs: 175000,
        dashboardGenerated: true,
      })
    );

    expect(res.status).toBe(200);
    const [payload] = mocks.loggerInfo.mock.calls[0] as [Record<string, unknown>];
    expect(payload).toMatchObject({
      event: 'onboarding:completed',
      type: 'completed',
      totalDurationMs: 175000,
      dashboardGenerated: true,
    });
  });

  it('logs skipped events with fromStep', async () => {
    const res = await POST(
      makeRequest({ type: 'skipped', fromStep: 'prompt' })
    );

    expect(res.status).toBe(200);
    const [payload] = mocks.loggerInfo.mock.calls[0] as [Record<string, unknown>];
    expect(payload).toMatchObject({
      event: 'onboarding:skipped',
      type: 'skipped',
      fromStep: 'prompt',
    });
  });

  it('logs generation_failed events with error + attempt', async () => {
    const res = await POST(
      makeRequest({ type: 'generation_failed', error: 'timeout', attempt: 3 })
    );

    expect(res.status).toBe(200);
    const [payload] = mocks.loggerInfo.mock.calls[0] as [Record<string, unknown>];
    expect(payload).toMatchObject({
      event: 'onboarding:generation_failed',
      type: 'generation_failed',
      error: 'timeout',
      attempt: 3,
    });
  });

  it('accepts every OnboardingStep enum value for step_completed', async () => {
    for (const step of ['welcome', 'choose_source', 'prompt', 'generating', 'success']) {
      const res = await POST(makeRequest({ type: 'step_completed', step, durationMs: 1 }));
      expect(res.status).toBe(200);
    }
  });
});
