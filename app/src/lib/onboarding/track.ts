import { logger } from '@/lib/logger';

/**
 * Onboarding analytics events. Mirrors `specs/onboarding.md §10`.
 *
 * Discriminated union — TypeScript catches typos in event names AND
 * missing/wrong payloads.
 */
export type OnboardingEvent =
  | {
      type: 'step_completed';
      step: 'welcome' | 'choose_source' | 'prompt' | 'success';
      sourceType?: 'postgres' | 'stripe' | 'sheets';
      durationMs: number;
    }
  | {
      type: 'completed';
      totalDurationMs: number;
      dashboardGenerated: boolean;
    }
  | {
      type: 'skipped';
      fromStep: 'welcome' | 'choose_source' | 'prompt';
    };

/**
 * Fire-and-forget tracking helper for onboarding events.
 *
 * In MVP this just logs via Pino with structured fields. Hook up to
 * Segment / PostHog / Mixpanel in Phase 2 — the function signature
 * stays stable so callers don't need to change.
 */
export function trackOnboardingEvent(type: OnboardingEvent['type'], payload: unknown): void {
  logger.info({ event: `onboarding:${type}`, ...(payload as Record<string, unknown>) });
}