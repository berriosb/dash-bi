import type { Page, Locator } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * Page Object for the 4-step onboarding wizard
 * (app/src/app/(auth)/onboarding/page.tsx).
 *
 * Steps: welcome → choose-source → prompt → generating.
 */
export class OnboardingPage {
  readonly welcomeHeading: Locator;
  readonly startButton: Locator;
  readonly chooseSourceHeading: Locator;
  readonly continueButton: Locator;
  readonly promptHeading: Locator;
  readonly promptInput: Locator;
  readonly generateButton: Locator;
  readonly generatingHeading: Locator;

  constructor(private readonly page: Page) {
    this.welcomeHeading = page.getByRole('heading', { name: /¡Bienvenido a dash-bi!/i });
    this.startButton = page.getByRole('button', { name: /Empezar/i });
    this.chooseSourceHeading = page.getByRole('heading', { name: '¿Qué querés conectar?' });
    this.continueButton = page.getByRole('button', { name: /Continuar/i });
    this.promptHeading = page.getByRole('heading', {
      name: /¡Listo! Tu fuente está conectada/i,
    });
    this.promptInput = page.locator('#onboarding-prompt');
    this.generateButton = page.getByRole('button', {
      name: /Generar mi primer dashboard/i,
    });
    this.generatingHeading = page.getByRole('heading', {
      name: /Generando tu primer dashboard|No pudimos generar/i,
    });
  }

  async gotoResume(): Promise<void> {
    await this.page.goto('/onboarding?resume=welcome');
  }

  /**
   * Pick a data-source card by its `data-testid` attribute (e.g.
   * `source-postgres`, `source-mysql`).
   */
  async pickSource(sourceTestId: string): Promise<void> {
    const card = this.page.getByTestId(sourceTestId);
    await expect(card).toBeVisible();
    await card.click();
  }

  /**
   * Click the first suggestion card and assert the prompt input is
   * populated with its copy.
   */
  async pickFirstSuggestion(): Promise<void> {
    const suggestion = this.page.locator('[data-testid^="suggestion-"]').first();
    await expect(suggestion).toBeVisible();
    await suggestion.click();
    await expect(this.promptInput).not.toHaveValue('');
  }
}
