import { test, expect } from '@playwright/test';
import { signUpAndVerify, signInViaUI } from './helpers/auth';

test.describe.serial('Scheduled Reports UI E2E', () => {
  test('unauthenticated access redirects to login', async ({ page }) => {
    await page.goto('/reports');
    await expect(page).toHaveURL(/\/login/, { timeout: 20_000 });
  });

  test('authenticated user can open and view scheduled reports creation form', async ({ page, request, viewport }) => {
    test.setTimeout(120_000);
    test.skip(
      viewport !== null && viewport.width < 1024,
      'desktop-only flow; mobile-safari sidebar overlays the new-report button. Tracked separately for a responsive-layout fix.',
    );

    // 1. Sign up user (API + DB-level email verification).
    const { email, password } = await signUpAndVerify(
      request,
      'Reports Tester',
    );

    // 2. Sign in via UI.
    await signInViaUI(page, email, password);

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
