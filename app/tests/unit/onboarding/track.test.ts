import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { trackOnboardingEvent, type OnboardingEvent } from '@/lib/onboarding/track';
import { logger } from '@/lib/logger';

describe('trackOnboardingEvent', () => {
  beforeEach(() => {
    vi.mocked(logger.info).mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('logs step_completed events with step + sourceType + durationMs', () => {
    const start = Date.now() - 65000;
    trackOnboardingEvent('step_completed', {
      step: 'choose_source',
      sourceType: 'stripe',
      durationMs: Date.now() - start,
    });

    expect(logger.info).toHaveBeenCalledTimes(1);
    const calls = vi.mocked(logger.info).mock.calls;
    const payload = calls[0]?.[0] as Record<string, unknown>;
    expect(payload).toMatchObject({
      event: 'onboarding:step_completed',
      step: 'choose_source',
      sourceType: 'stripe',
      durationMs: expect.any(Number),
    });
  });

  it('logs onboarding.completed with totalDurationMs + dashboardGenerated flag', () => {
    trackOnboardingEvent('completed', {
      totalDurationMs: 175000,
      dashboardGenerated: true,
    });

    expect(logger.info).toHaveBeenCalledTimes(1);
    const calls = vi.mocked(logger.info).mock.calls;
    const payload = calls[0]?.[0] as Record<string, unknown>;
    expect(payload).toMatchObject({
      event: 'onboarding:completed',
      totalDurationMs: 175000,
      dashboardGenerated: true,
    });
  });

  it('accepts the full event union without type errors', () => {
    const events: OnboardingEvent[] = [
      { type: 'step_completed', step: 'welcome', durationMs: 1000 },
      { type: 'step_completed', step: 'choose_source', sourceType: 'postgres', durationMs: 60000 },
      { type: 'completed', totalDurationMs: 175000, dashboardGenerated: true },
      { type: 'skipped', fromStep: 'choose_source' },
    ];
    for (const e of events) {
      expect(() => trackOnboardingEvent(e.type, e)).not.toThrow();
    }
    expect(logger.info).toHaveBeenCalledTimes(events.length);
  });
});