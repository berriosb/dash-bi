import { test, expect } from '@playwright/test';
import postgres from 'postgres';

const TEST_PASSWORD = 'E2EReportsPassword123!';

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

test.describe.serial('Scheduled Reports UI E2E', () => {
  test('unauthenticated access redirects to login', async ({ page }) => {
    await page.goto('/reports');
    await expect(page).toHaveURL(/\/login/, { timeout: 20_000 });
  });

  test('authenticated user can open and view scheduled reports creation form', async ({ page, request }) => {
    test.setTimeout(120_000);

    // 1. Sign up user
    const email = `reports-${Date.now()}@dash-bi.test`;
    const signup = await request.post('/api/auth/sign-up/email', {
      headers: { 'content-type': 'application/json' },
      data: { email, password: TEST_PASSWORD, name: 'Reports Tester' },
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
    await expect(page).toHaveURL(/\/(dashboards|onboarding|reports)/, { timeout: 45_000 });

    // 3. Navigate to /reports
    await page.goto('/reports');
    await expect(page.getByRole('heading', { name: /Reportes programados/i })).toBeVisible({ timeout: 20_000 });

    // 4. Open create report form
    const newReportBtn = page.getByTestId('new-report-button');
    await expect(newReportBtn).toBeVisible({ timeout: 10_000 });
    await newReportBtn.click();

    // 5. Assert form elements are rendered
    const formCard = page.getByTestId('create-report-card');
    await expect(formCard).toBeVisible({ timeout: 10_000 });
    await expect(formCard.getByText('Programar un envío')).toBeVisible();
    await expect(formCard.getByLabel('Dashboard')).toBeVisible();
    await expect(formCard.getByLabel('Frecuencia')).toBeVisible();
    await expect(formCard.getByLabel('Formato')).toBeVisible();
    await expect(formCard.getByLabel('Destinatarios')).toBeVisible();
  });
});
