import { test, expect } from '@playwright/test';
import { signUpAndVerify, signInViaUI } from './helpers/auth';

test.describe.serial('Onboarding Flow E2E', () => {
  test('navigates through the step-by-step onboarding wizard', async ({ page, request }) => {
    test.setTimeout(120_000);

    // 1. Sign up user (API + DB-level email verification).
    const { email, password } = await signUpAndVerify(
      request,
      'Onboarding Tester',
    );

    // 2. Sign in via UI.
    await signInViaUI(page, email, password);

    // 3. Visit onboarding page with resume=welcome
    await page.goto('/onboarding?resume=welcome');

    // 4. Step 1: Welcome Step
    await expect(page.getByRole('heading', { name: /¡Bienvenido a dash-bi!/i })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('1️⃣ Conectar fuente de datos')).toBeVisible();

    const startButton = page.getByRole('button', { name: /Empezar/i });
    await expect(startButton).toBeVisible();
    await startButton.click();

    // 5. Step 2: Choose Source Step
    await expect(page.getByRole('heading', { name: '¿Qué querés conectar?' })).toBeVisible();
    const postgresCard = page.getByTestId('source-postgres');
    await expect(postgresCard).toBeVisible();
    await postgresCard.click();

    const nextSourceBtn = page.getByRole('button', { name: /Continuar/i });
    await expect(nextSourceBtn).toBeEnabled();
    await nextSourceBtn.click();

    // 6. Step 3: Prompt Step
    await expect(page.getByRole('heading', { name: /¡Listo! Tu fuente está conectada/i })).toBeVisible();
    const promptInput = page.locator('#onboarding-prompt');
    await expect(promptInput).toBeVisible();

    // Click a suggestion card
    const suggestionCard = page.locator('[data-testid^="suggestion-"]').first();
    await expect(suggestionCard).toBeVisible();
    await suggestionCard.click();

    await expect(promptInput).not.toHaveValue('');

    // 7. Submit generation
    const generateBtn = page.getByRole('button', { name: /Generar mi primer dashboard/i });
    await expect(generateBtn).toBeEnabled();
    await generateBtn.click();

    // 8. Step 4: Generating Step
    await expect(
      page.getByRole('heading', { name: /Generando tu primer dashboard|No pudimos generar/i })
    ).toBeVisible({ timeout: 15_000 });
  });
});
