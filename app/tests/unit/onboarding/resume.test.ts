import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockFindFirst } = vi.hoisted(() => ({
  mockFindFirst: vi.fn(),
}));

vi.mock('@/db/client', () => ({
  db: { query: { users: { findFirst: mockFindFirst } } },
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { getOnboardingResumePath } from '@/lib/onboarding/resume';

describe('getOnboardingResumePath', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when the user has not been found', async () => {
    mockFindFirst.mockResolvedValueOnce(null);
    const result = await getOnboardingResumePath('user-uuid');
    expect(result).toBeNull();
  });

  it('returns null when onboarding is fully completed', async () => {
    mockFindFirst.mockResolvedValueOnce({
      onboardingCompletedAt: new Date('2026-07-01'),
      currentOnboardingStep: 'completed',
    });
    const result = await getOnboardingResumePath('user-uuid');
    expect(result).toBeNull();
  });

  it('returns /onboarding when onboarding was never started (only signup)', async () => {
    mockFindFirst.mockResolvedValueOnce({
      onboardingCompletedAt: null,
      currentOnboardingStep: null,
    });
    const result = await getOnboardingResumePath('user-uuid');
    expect(result).toBe('/onboarding');
  });

  it('returns /onboarding when the user dropped at choose_source', async () => {
    mockFindFirst.mockResolvedValueOnce({
      onboardingCompletedAt: null,
      currentOnboardingStep: 'choose_source',
    });
    const result = await getOnboardingResumePath('user-uuid');
    expect(result).toBe('/onboarding?resume=choose_source');
  });

  it('returns /onboarding when the user dropped at prompt', async () => {
    mockFindFirst.mockResolvedValueOnce({
      onboardingCompletedAt: null,
      currentOnboardingStep: 'prompt',
    });
    const result = await getOnboardingResumePath('user-uuid');
    expect(result).toBe('/onboarding?resume=prompt');
  });

  it('returns null on DB error (fail open — do not block access)', async () => {
    mockFindFirst.mockRejectedValueOnce(new Error('db down'));
    const result = await getOnboardingResumePath('user-uuid');
    expect(result).toBeNull();
  });
});