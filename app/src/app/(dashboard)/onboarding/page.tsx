'use client';

import { OnboardingWizard } from '@/components/onboarding/OnboardingWizard';
import { useRouter } from 'next/navigation';

export default function OnboardingPage() {
  const router = useRouter();
  return (
    <OnboardingWizard
      onComplete={() => {
        router.push('/dashboards?create=ai');
      }}
    />
  );
}