/**
 * Onboarding analytics events. Mirrors `specs/onboarding.md §10`.
 *
 * Discriminated union — TypeScript catches typos in event names AND
 * missing/wrong payloads at the call site.
 */

export const ONBOARDING_STEPS = [
  'welcome',
  'choose_source',
  'prompt',
  'generating',
  'success',
] as const;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export type OnboardingEvent =
  | {
      type: 'step_completed';
      step: OnboardingStep;
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
      fromStep: OnboardingStep;
    }
  | {
      type: 'generation_failed';
      error: string;
      attempt: number;
    };

/**
 * Client-side onboarding analytics. Fire-and-forget fetch to the
 * server endpoint which logs via Pino (see
 * `app/src/app/api/onboarding/track/route.ts`).
 *
 * Contract:
 * - NEVER throws (analytics must never break UX).
 * - NO await (sync return; the network call is detached).
 * - SSR-safe: no-op when `window` is undefined.
 * - Uses `keepalive: true` so the request survives navigation,
 *   important for "step_completed on unmount" patterns.
 */
export function trackOnboardingEvent(event: OnboardingEvent): void {
  if (typeof window === 'undefined') return;
  try {
    void fetch('/api/onboarding/track', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(event),
      keepalive: true,
    });
  } catch {
    // Swallow — analytics must never break UX.
  }
}