// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { WelcomeStep } from '@/components/onboarding/WelcomeStep';
import { useOnboardingStore } from '@/stores/onboardingStore';

describe('WelcomeStep', () => {
  beforeEach(() => {
    useOnboardingStore.getState().reset();
  });

  it('renders welcome heading and the three step teasers', () => {
    render(<WelcomeStep />);
    expect(screen.getByText(/bienvenido a dash-bi/i)).toBeDefined();
    expect(screen.getByText(/conectar fuente de datos/i)).toBeDefined();
    expect(screen.getByText(/lenguaje natural/i)).toBeDefined();
    expect(screen.getByText(/dashboard generado con ia/i)).toBeDefined();
  });

  it('advances to choose_source step when "Empezar" is clicked', () => {
    render(<WelcomeStep />);
    fireEvent.click(screen.getByRole('button', { name: /empezar/i }));
    expect(useOnboardingStore.getState().step).toBe('choose_source');
  });

  it('renders a "Skip onboarding" link for power users', () => {
    render(<WelcomeStep />);
    expect(screen.getByRole('link', { name: /skip onboarding/i })).toBeDefined();
  });
});