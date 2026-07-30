import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UnauthorizedError, ForbiddenError } from '@/lib/auth/context';

const { mockGetOnboardingResumePath, mockRequireAuth } = vi.hoisted(() => ({
  mockGetOnboardingResumePath: vi.fn(),
  mockRequireAuth: vi.fn(),
}));

vi.mock('@/lib/onboarding/resume', () => ({
  getOnboardingResumePath: mockGetOnboardingResumePath,
}));


vi.mock('@/lib/auth/request', () => ({
  requireAuth: mockRequireAuth,
}));


vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));


import { GET } from '@/app/api/onboarding/resume/route';

function makeReq(): Request {
  return new Request('http://localhost/api/onboarding/resume');
}

describe('GET /api/onboarding/resume', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({
      userId: 'user-uuid',
      email: 'a@b.com',
      orgId: 'org-1',
      role: 'admin',
    });
  });

  it('returns 401 when there is no valid session', async () => {
    mockRequireAuth.mockRejectedValueOnce(
      new UnauthorizedError()
    );
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
  });

  it('returns { resumePath: null } when onboarding is complete', async () => {
    mockGetOnboardingResumePath.mockResolvedValueOnce(null);
    const res = await GET(makeReq());
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json).toEqual({ resumePath: null });
  });

  it('returns the resume path when onboarding is incomplete', async () => {
    mockGetOnboardingResumePath.mockResolvedValueOnce('/onboarding?resume=prompt');
    const res = await GET(makeReq());
    const json = await res.json();
    expect(json).toEqual({ resumePath: '/onboarding?resume=prompt' });
  });
});
