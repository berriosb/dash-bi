// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { ChooseSourceStep } from '@/components/onboarding/ChooseSourceStep';
import { useOnboardingStore } from '@/stores/onboardingStore';

describe('ChooseSourceStep', () => {
  beforeEach(() => {
    useOnboardingStore.getState().reset();
  });

  it('renders the three available source types as selectable cards', () => {
    render(<ChooseSourceStep />);
    expect(screen.getByText(/postgresql/i)).toBeDefined();
    expect(screen.getByText(/stripe/i)).toBeDefined();
    expect(screen.getByText(/google sheets/i)).toBeDefined();
  });

  it('disables the Continue button until a source is selected', () => {
    render(<ChooseSourceStep />);
    const continueBtn = screen.getByRole('button', { name: /continuar/i });
    expect(continueBtn.hasAttribute('disabled')).toBe(true);
  });

  it('records the selected source type in the store', () => {
    render(<ChooseSourceStep />);
    fireEvent.click(screen.getByText(/stripe/i));
    expect(useOnboardingStore.getState().selectedSourceType).toBe('stripe');
  });

  it('enables Continue after a selection and advances to prompt step on click', () => {
    render(<ChooseSourceStep />);
    fireEvent.click(screen.getByText(/stripe/i));
    const continueBtn = screen.getByRole('button', { name: /continuar/i });
    expect(continueBtn.hasAttribute('disabled')).toBe(false);

    fireEvent.click(continueBtn);
    expect(useOnboardingStore.getState().step).toBe('prompt');
  });

  it('offers a back button to return to welcome', () => {
    render(<ChooseSourceStep />);
    expect(screen.getByRole('button', { name: /volver|atrás|back/i })).toBeDefined();
  });
});