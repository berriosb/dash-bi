import { test, expect } from '@playwright/test';
import { signUpAndVerify, signInViaUI } from './helpers/auth';
import { OnboardingPage } from './pages/onboarding.page';

test.describe.serial('Onboarding Flow E2E', { tag: '@slow' }, () => {
  test('navigates through the step-by-step onboarding wizard', async ({ page, request }) => {
    test.setTimeout(120_000);

    // 1. Sign up user (API + DB-level email verification).
    const { email, password } = await signUpAndVerify(
      request,
      'Onboarding Tester',
    );

    // 2. Sign in via UI.
    await signInViaUI(page, email, password);

    // 3. Visit onboarding page with resume=welcome.
    const onboarding = new OnboardingPage(page);
    await onboarding.gotoResume();

    // 4. Step 1: Welcome Step
    await expect(onboarding.welcomeHeading).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('1️⃣ Conectar fuente de datos')).toBeVisible();
    await expect(onboarding.startButton).toBeVisible();
    await onboarding.startButton.click();

    // 5. Step 2: Choose Source Step
    await expect(onboarding.chooseSourceHeading).toBeVisible();
    await onboarding.pickSource('source-postgres');
    await expect(onboarding.continueButton).toBeEnabled();
    await onboarding.continueButton.click();

    // 6. Step 3: Prompt Step
    await expect(onboarding.promptHeading).toBeVisible();
    await expect(onboarding.promptInput).toBeVisible();
    await onboarding.pickFirstSuggestion();

    // 7. Submit generation
    await expect(onboarding.generateButton).toBeEnabled();
    await onboarding.generateButton.click();

    // 8. Step 4: Generating Step
    await expect(onboarding.generatingHeading).toBeVisible({ timeout: 15_000 });
  });
});
