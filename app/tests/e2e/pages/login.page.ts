import type { Page, Locator } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * Page Object for the /login surface (app/src/app/(auth)/login/page.tsx).
 *
 * Centralizes the Spanish-locale labels so a future i18n change is a
 * single-file edit instead of a multi-spec grep.
 */
export class LoginPage {
  readonly heading: Locator;
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly passwordTab: Locator;
  readonly magicLinkTab: Locator;
  readonly submitButton: Locator;
  readonly googleButton: Locator;
  readonly signupLink: Locator;

  constructor(private readonly page: Page) {
    this.heading = page.getByRole('heading', { name: /Iniciar Sesión/i });
    this.emailInput = page.getByLabel(/Correo Electrónico/i);
    this.passwordInput = page.getByLabel(/Contraseña/i);
    this.passwordTab = page.getByRole('button', { name: /Contraseña/i });
    this.magicLinkTab = page.getByRole('button', { name: /Magic Link/i });
    this.submitButton = page.getByRole('button', { name: /Iniciar Sesión/i });
    this.googleButton = page.getByRole('button', { name: /Continuar con Google/i });
    this.signupLink = page.getByRole('link', { name: /Creá tu organización/i });
  }

  async goto(): Promise<void> {
    await this.page.goto('/login');
  }

  /**
   * Switch the form to magic-link mode and assert the password field
   * disappears. Used by `auth-flow.spec.ts`.
   */
  async switchToMagicLink(): Promise<void> {
    await this.magicLinkTab.click();
    await expect(this.passwordInput).not.toBeVisible();
  }
}
