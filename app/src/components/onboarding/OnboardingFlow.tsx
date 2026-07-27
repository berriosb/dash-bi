'use client';

import { useEffect } from 'react';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { WelcomeStep } from './WelcomeStep';
import { ChooseSourceStep } from './ChooseSourceStep';
import { PromptStep } from './PromptStep';
import { SuccessStep } from './SuccessStep';

const STEP_COMPONENTS = {
  welcome: WelcomeStep,
  choose_source: ChooseSourceStep,
  prompt: PromptStep,
  generating: PromptStep, // Same UI while AI generates — SuccessStep replaces on completion
  success: SuccessStep,
} as const;

interface OnboardingFlowProps {
  /** Optional initial step from server (e.g., drop-off recovery). */
  initialStep?: 'welcome' | 'choose_source' | 'prompt' | 'generating' | 'success';
}

export function OnboardingFlow({ initialStep }: OnboardingFlowProps) {
  const step = useOnboardingStore((s) => s.step);
  const goToStep = useOnboardingStore((s) => s.goToStep);

  useEffect(() => {
    if (initialStep && initialStep !== step) {
      goToStep(initialStep);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const StepComponent = STEP_COMPONENTS[step];

  return (
    <main className="min-h-screen bg-background">
      <StepComponent />
    </main>
  );
}