import { test, expect } from '@playwright/test';
import postgres from 'postgres';

const TEST_PASSWORD = 'E2EOnboardingPassword123!';

async function markEmailVerified(email: string): Promise<void> {
  const dbUrl = process.env.DATABASE_URL || 'postgresql://dashbi:changeme@localhost:5432/dashbi';
  const client = postgres(dbUrl, { max: 1 });
  try {
    await client`
      UPDATE users SET email_verified = true WHERE email = ${email}
    `;
  } finally {
    await client.end({ timeout: 5 });
  }
}

test.describe.serial('Onboarding Flow E2E', () => {
  test('navigates through the step-by-step onboarding wizard', async ({ page, request }) => {
    test.setTimeout(120_000);

    // 1. Sign up user
    const email = `onboarding-${Date.now()}@dash-bi.test`;
    const signup = await request.post('/api/auth/sign-up/email', {
      headers: { 'content-type': 'application/json' },
      data: { email, password: TEST_PASSWORD, name: 'Onboarding Tester' },
    });
    expect(signup.ok()).toBeTruthy();

    await markEmailVerified(email);

    // 2. Sign in via UI
    await page.goto('/login');
    const emailInput = page.getByLabel(/Correo Electrónico/i);
    await emailInput.fill(email);
    const passwordInput = page.getByLabel(/Contraseña/i);
    await passwordInput.fill(TEST_PASSWORD);
    await expect(emailInput).toHaveValue(email);
    await expect(passwordInput).toHaveValue(TEST_PASSWORD);
    await page.getByRole('button', { name: /Iniciar Sesión/i }).click();
    await expect(page).toHaveURL(/\/(dashboards|onboarding)/, { timeout: 45_000 });

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
