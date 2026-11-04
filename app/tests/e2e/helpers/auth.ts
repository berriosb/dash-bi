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
 * Espera a que el limitador de auth libere la ventana.
 *
 * better-auth limita por IP, y en CI los tres proyectos de Playwright
 * salen desde 127.0.0.1. Cuando la suite dispara más sign-ups de los que
 * caben en la ventana, el endpoint responde 429 y el test falla por una
 * salvaguarda de producción que no tiene nada que ver con lo que está
 * probando.
 *
 * El CI sube el techo con AUTH_RATE_LIMIT_SIGN_UP_MAX para que la suite
 * no lo alcance, pero este reintento es la red de seguridad: si alguien
 * corre la suite con el tope por defecto, espera a que la ventana se
 * libere en vez de fallar con un error que no explica nada.
 */
async function waitForRateLimitWindow(response: { status(): number }): Promise<boolean> {
  if (response.status() !== 429) return false;
  // La ventana del limitador es de 60s. Se espera un poco más para no
  // volver a caer en el borde.
  await new Promise((resolve) => setTimeout(resolve, 61_000));
  return true;
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

  let signup = await request.post('/api/auth/sign-up/email', {
    headers: { 'content-type': 'application/json' },
    data: { email, password, name },
  });

  // Un 429 no es un fallo del signup: es el limitador. Se espera a que
  // se libere la ventana y se reintenta una vez.
  if (await waitForRateLimitWindow(signup)) {
    signup = await request.post('/api/auth/sign-up/email', {
      headers: { 'content-type': 'application/json' },
      data: { email, password, name },
    });
  }

  expect(
    signup.ok(),
    `sign-up failed with ${signup.status()}: ${await signup.text().catch(() => '')}`,
  ).toBeTruthy();

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
  retriedAfterRateLimit = false,
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

  // La respuesta del endpoint de sign-in se observa para distinguir un
  // 429 del limitador de un login que simplemente no navegó. Sin esto, el
  // 429 se manifestaba como un timeout de 45s esperando la URL, que no
  // dice nada sobre la causa real.
  const signInResponse = page.waitForResponse(
    (response) =>
      response.url().includes('/api/auth/sign-in/email') &&
      response.request().method() === 'POST',
    { timeout: 45_000 },
  );

  await page.getByRole('button', { name: /Iniciar Sesión/i }).click();

  const response = await signInResponse;
  if (response.status() === 429 && !retriedAfterRateLimit) {
    await new Promise((resolve) => setTimeout(resolve, 61_000));
    return signInViaUI(page, email, password, true);
  }

  await expect(page).toHaveURL(/\/(dashboards|onboarding|reports)/, {
    timeout: 45_000,
  });
}
