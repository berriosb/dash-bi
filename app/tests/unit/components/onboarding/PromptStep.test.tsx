// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { PromptStep } from '@/components/onboarding/PromptStep';
import { useOnboardingStore } from '@/stores/onboardingStore';

describe('PromptStep', () => {
  beforeEach(() => {
    useOnboardingStore.getState().reset();
  });

  it('renders a textarea and a Generate button', () => {
    useOnboardingStore.getState().setSelectedSourceType('stripe');
    render(<PromptStep />);
    expect(screen.getByRole('textbox')).toBeDefined();
    expect(screen.getByRole('button', { name: /generar.*primer.*dashboard/i })).toBeDefined();
  });

  it('shows source-specific suggestions when a source type is selected', () => {
    useOnboardingStore.getState().setSelectedSourceType('stripe');
    render(<PromptStep />);
    expect(screen.getByText(/revenue mensual/i)).toBeDefined();
  });

  it('falls back to generic suggestions when no source type is selected', () => {
    render(<PromptStep />);
    expect(screen.getByText(/top.*productos/i)).toBeDefined();
  });

  it('fills the textarea when a suggestion chip is clicked', () => {
    useOnboardingStore.getState().setSelectedSourceType('postgres');
    render(<PromptStep />);
    const chip = screen.getByText(/usuarios activos por d/i);
    fireEvent.click(chip);
    expect(useOnboardingStore.getState().prompt).toMatch(/usuarios activos/i);
  });

  it('moves to generating step and sets prompt in store when Generate is clicked', () => {
    useOnboardingStore.getState().setSelectedSourceType('stripe');
    useOnboardingStore.getState().setPrompt('Mostrame MRR por cohorte');
    render(<PromptStep />);
    fireEvent.click(screen.getByRole('button', { name: /generar.*primer.*dashboard/i }));
    expect(useOnboardingStore.getState().step).toBe('generating');
  });

  it('disables the Generate button when prompt is empty', () => {
    useOnboardingStore.getState().setSelectedSourceType('stripe');
    render(<PromptStep />);
    const btn = screen.getByRole('button', { name: /generar.*primer.*dashboard/i });
    expect(btn.hasAttribute('disabled')).toBe(true);
  });
});