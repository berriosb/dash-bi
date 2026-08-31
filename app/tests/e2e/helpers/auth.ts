import type { Page, APIRequestContext } from '@playwright/test';
import { expect } from '@playwright/test';
import { markEmailVerified } from './db';

const DEFAULT_PASSWORD = 'E2EPassword123!';

export interface SignedUpUser {
  email: string;
  password: string;
  userId: string;
}

/**
 * Sign a user up via the better-auth API and mark their email as
 * verified in the database (MockEmailProvider doesn't actually
 * deliver). Returns the credentials and user id so callers can use
 * them for follow-up assertions (e.g. `session.user.id` round-trips).
 *
 * Each call uses a unique email keyed off `Date.now()` so spec runs
 * don't collide when executed against a shared database.
 */
export async function signUpAndVerify(
  request: APIRequestContext,
  name = 'E2E Tester',
  password = DEFAULT_PASSWORD,
): Promise<SignedUpUser> {
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@dash-bi.test`;

  const signup = await request.post('/api/auth/sign-up/email', {
    headers: { 'content-type': 'application/json' },
    data: { email, password, name },
  });
  expect(signup.ok()).toBeTruthy();

  const body = await signup.json();
  await markEmailVerified(email);

  return { email, password, userId: body.user.id };
}

/**
 * Sign in via the /login form using the Spanish-language labels that
 * the auth UI exposes today (Correo Electrónico, Contraseña, Iniciar
 * Sesión). Polls the URL until it lands on a post-login destination
 * (dashboards / onboarding / reports) because the form does a
 * client-side `router.push(redirect)` that may not fire a load event.
 *
 * Uses `pressSequentially` instead of `fill` because WebKit (mobile-safari)
 * is racy with `fill` on freshly-hydrated React inputs — the value gets
 * reset by the hydration commit before `toHaveValue` polls succeed.
 */
export async function signInViaUI(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  await page.goto('/login');

  const emailInput = page.getByLabel(/Correo Electrónico/i);
  await emailInput.click();
  await emailInput.pressSequentially(email, { delay: 10 });
  await expect(emailInput).toHaveValue(email, { timeout: 15_000 });

  const passwordInput = page.getByLabel(/Contraseña/i);
  await passwordInput.click();
  await passwordInput.pressSequentially(password, { delay: 10 });
  await expect(passwordInput).toHaveValue(password, { timeout: 15_000 });

  await page.getByRole('button', { name: /Iniciar Sesión/i }).click();
  await expect(page).toHaveURL(/\/(dashboards|onboarding|reports)/, {
    timeout: 45_000,
  });
}
