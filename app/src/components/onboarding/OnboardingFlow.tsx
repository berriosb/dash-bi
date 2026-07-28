'use client';

import { useEffect, useRef } from 'react';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { WelcomeStep } from './WelcomeStep';
import { ChooseSourceStep } from './ChooseSourceStep';
import { PromptStep } from './PromptStep';
import { GeneratingStep } from './GeneratingStep';
import { SuccessStep } from './SuccessStep';
import { trackOnboardingEvent } from '@/lib/onboarding/track';

const STEP_COMPONENTS = {
  welcome: WelcomeStep,
  choose_source: ChooseSourceStep,
  prompt: PromptStep,
  generating: GeneratingStep,
  success: SuccessStep,
} as const;

const STEP_START_TIMES: Partial<Record<keyof typeof STEP_COMPONENTS, number>> = {};

interface OnboardingFlowProps {
  /** Optional initial step from server (e.g., drop-off recovery). */
  initialStep?: 'welcome' | 'choose_source' | 'prompt' | 'generating' | 'success';
}

export function OnboardingFlow({ initialStep }: OnboardingFlowProps) {
  const step = useOnboardingStore((s) => s.step);
  const selectedSourceType = useOnboardingStore((s) => s.selectedSourceType);
  const dashboardId = useOnboardingStore((s) => s.dashboardId);
  const goToStep = useOnboardingStore((s) => s.goToStep);
  const initialApplied = useRef(false);

  useEffect(() => {
    if (!initialApplied.current && initialStep && initialStep !== step) {
      goToStep(initialStep);
    }
    initialApplied.current = true;
  }, [initialStep, step, goToStep]);

  // Track step transitions for analytics (per onboarding.md §10)
  const startedAtRef = useRef<number>(Date.now());
  useEffect(() => {
    if (step === 'success') {
      trackOnboardingEvent({
        type: 'completed',
        totalDurationMs: Date.now() - startedAtRef.current,
        dashboardGenerated: Boolean(dashboardId),
      });
      return;
    }
    const enteredAt = Date.now();
    STEP_START_TIMES[step] = enteredAt;

    // On transition AWAY from a previous step, fire step_completed
    return () => {
      const previousStep = step;
      const durationMs = Date.now() - enteredAt;
      if (previousStep === 'welcome' || previousStep === 'choose_source' || previousStep === 'prompt') {
        trackOnboardingEvent({
          type: 'step_completed',
          step: previousStep,
          ...(selectedSourceType ? { sourceType: selectedSourceType } : {}),
          durationMs,
        });
      }
    };
  }, [step, selectedSourceType, dashboardId]);

  const StepComponent = STEP_COMPONENTS[step];

  return (
    <main className="min-h-screen bg-background">
      <StepComponent />
    </main>
  );
}