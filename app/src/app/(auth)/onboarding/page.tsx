import { headers } from 'next/headers';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { users } from '@/db/schema';
import { OnboardingFlow } from '@/components/onboarding/OnboardingFlow';
import type { OnboardingStep } from '@/stores/onboardingStore';

export const dynamic = 'force-dynamic';

const VALID_STEPS: ReadonlyArray<OnboardingStep> = [
  'welcome',
  'choose_source',
  'prompt',
  'generating',
  'success',
];

export default async function OnboardingPage() {
  const hdrs = await headers();
  const userId = hdrs.get('x-user-id');

  let initialStep: OnboardingStep = 'welcome';

  if (userId) {
    try {
      const user = await db.query.users.findFirst({
        where: eq(users.id, userId),
        columns: { currentOnboardingStep: true },
      });
      const persisted = user?.currentOnboardingStep as OnboardingStep | null | undefined;
      if (persisted && VALID_STEPS.includes(persisted)) {
        initialStep = persisted;
      }
    } catch {
      // ignore — fall back to 'welcome'
    }
  }

  return <OnboardingFlow initialStep={initialStep} />;
}