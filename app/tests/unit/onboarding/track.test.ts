// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockFetch = vi.fn();

describe('trackOnboardingEvent (client-side fetcher)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fires POST to /api/onboarding/track with the full event in the body', async () => {
    const { trackOnboardingEvent } = await import('@/lib/onboarding/track');

    trackOnboardingEvent({
      type: 'step_completed',
      step: 'choose_source',
      sourceType: 'stripe',
      durationMs: 1234,
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/onboarding/track');
    expect(init.method).toBe('POST');
    expect(init.keepalive).toBe(true);
    expect(JSON.parse(init.body as string)).toEqual({
      type: 'step_completed',
      step: 'choose_source',
      sourceType: 'stripe',
      durationMs: 1234,
    });
  });

  it('serialises completed events with totalDurationMs + dashboardGenerated', async () => {
    const { trackOnboardingEvent } = await import('@/lib/onboarding/track');

    trackOnboardingEvent({
      type: 'completed',
      totalDurationMs: 175000,
      dashboardGenerated: true,
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const init = mockFetch.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({
      type: 'completed',
      totalDurationMs: 175000,
      dashboardGenerated: true,
    });
  });

  it('serialises skipped events with fromStep', async () => {
    const { trackOnboardingEvent } = await import('@/lib/onboarding/track');

    trackOnboardingEvent({ type: 'skipped', fromStep: 'choose_source' });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const init = mockFetch.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({
      type: 'skipped',
      fromStep: 'choose_source',
    });
  });

  it('serialises generation_failed events with error + attempt', async () => {
    const { trackOnboardingEvent } = await import('@/lib/onboarding/track');

    trackOnboardingEvent({
      type: 'generation_failed',
      error: 'Network timeout',
      attempt: 2,
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const init = mockFetch.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({
      type: 'generation_failed',
      error: 'Network timeout',
      attempt: 2,
    });
  });

  it('does not throw when fetch rejects (analytics must never break UX)', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network down'));
    const { trackOnboardingEvent } = await import('@/lib/onboarding/track');

    expect(() =>
      trackOnboardingEvent({
        type: 'step_completed',
        step: 'welcome',
        durationMs: 100,
      })
    ).not.toThrow();
  });

  it('returns synchronously without awaiting the fetch (fire-and-forget)', async () => {
    let resolved = false;
    mockFetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          setTimeout(() => {
            resolved = true;
            resolve({ ok: true });
          }, 100);
        })
    );

    const { trackOnboardingEvent } = await import('@/lib/onboarding/track');

    trackOnboardingEvent({
      type: 'step_completed',
      step: 'prompt',
      durationMs: 500,
    });

    expect(resolved).toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});