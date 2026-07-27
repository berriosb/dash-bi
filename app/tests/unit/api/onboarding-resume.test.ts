import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetOnboardingResumePath } = vi.hoisted(() => ({
  mockGetOnboardingResumePath: vi.fn(),
}));

vi.mock('@/lib/onboarding/resume', () => ({
  getOnboardingResumePath: mockGetOnboardingResumePath,
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { GET } from '@/app/api/onboarding/resume/route';

function makeReq(): Request {
  return new Request('http://localhost/api/onboarding/resume', {
    method: 'GET',
    headers: { 'x-user-id': 'user-uuid' },
  });
}

describe('GET /api/onboarding/resume', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when x-user-id header is missing', async () => {
    const res = await GET(new Request('http://localhost/api/onboarding/resume'));
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