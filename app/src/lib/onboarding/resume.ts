import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { users } from '@/db/schema';
import { logger } from '@/lib/logger';

const RESUMABLE_STEPS = new Set(['choose_source', 'prompt', 'generating']);

/**
 * Returns the path the user should be redirected to on login/signup
 * when onboarding is incomplete.
 *
 * - `null` when the user has no record, has completed onboarding, or the
 *   DB lookup fails (fail-open: never block legitimate access).
 * - `/onboarding` when the user is brand new (never started).
 * - `/onboarding?resume=<step>` when the user has progressed past `welcome`.
 *
 * Per `specs/onboarding.md §8 (Drop-off recovery)`.
 */
export async function getOnboardingResumePath(userId: string): Promise<string | null> {
  try {
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: {
        onboardingCompletedAt: true,
        currentOnboardingStep: true,
      },
    });
    if (!user) return null;
    if (user.onboardingCompletedAt) return null;
    const step = user.currentOnboardingStep;
    if (step && RESUMABLE_STEPS.has(step)) {
      return `/onboarding?resume=${step}`;
    }
    return '/onboarding';
  } catch (error) {
    logger.error({ err: error, userId }, 'onboarding: failed to compute resume path');
    return null;
  }
}