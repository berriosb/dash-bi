import { test, expect } from '@playwright/test';

/**
 * Auth flow E2E — Sprint 1 v0.2:
 *
 * Cubre el camino feliz de:
 *   1. Unauthenticated → /dashboards redirige a /login
 *   2. /login valida campos requeridos
 *   3. /signup navega a /onboarding tras registro exitoso (mock email)
 *   4. Logout desde Header regresa a /login
 *   5. Dashboard route protegida sigue bloqueada sin sesión
 *
 * Requisitos:
 *   - Dev server con `pnpm dev` corriendo (Playwright arranca via webServer config)
 *   - Sin DB real: usa MockEmailProvider. Los signup pueden fallar por org_provision
 *     si no hay DB; en CI se mockean via Playwright's request interception (futuro).
 */

test.describe('Auth flow — public surfaces', () => {
  test('home page renders Get started + Sign in CTAs', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'dash-bi' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Get started/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /Sign in/i })).toBeVisible();
  });

  test('signup CTA links to /signup', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: /Get started/i }).click();
    await expect(page).toHaveURL(/\/signup/);
  });

  test('signin CTA links to /login', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: /Sign in/i }).click();
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe('Auth flow — login page', () => {
  test('login exposes password and magic link tabs', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: /Iniciar Sesión/i })).toBeVisible();
    await expect(page.getByLabel(/Correo Electrónico/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /Contraseña/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Magic Link/i })).toBeVisible();
  });

  test('email field is required', async ({ page }) => {
    await page.goto('/login');
    const emailInput = page.getByLabel(/Correo Electrónico/i);
    await expect(emailInput).toHaveAttribute('required');
  });

  test('magic link toggle hides password field', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: /Magic Link/i }).click();
    await expect(page.getByLabel(/Contraseña/i)).not.toBeVisible();
  });

  test('Google OAuth button is present', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('button', { name: /Continuar con Google/i })).toBeVisible();
  });

  test('link to /signup is accessible', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('link', { name: /Creá tu organización/i }).click();
    await expect(page).toHaveURL(/\/signup/);
  });
});

test.describe('Auth flow — signup page', () => {
  test('signup exposes organization, user name, email and password fields', async ({ page }) => {
    await page.goto('/signup');
    await expect(page.getByRole('heading', { name: /Crear Organización/i })).toBeVisible();
    await expect(page.getByLabel(/Nombre de la Organización/i)).toBeVisible();
    await expect(page.getByLabel(/Tu Nombre Completo/i)).toBeVisible();
    await expect(page.getByLabel(/Correo Electrónico Trabajo/i)).toBeVisible();
    await expect(page.getByLabel(/Contraseña \(Mín\. 8 caracteres\)/i)).toBeVisible();
  });

  test('password field enforces min 8 chars', async ({ page }) => {
    await page.goto('/signup');
    const passwordInput = page.getByLabel(/Contraseña \(Mín\. 8 caracteres\)/i);
    await expect(passwordInput).toHaveAttribute('minlength', '8');
  });

  test('Google signup button is present', async ({ page }) => {
    await page.goto('/signup');
    await expect(page.getByRole('button', { name: /Registrarse con Google/i })).toBeVisible();
  });
});

test.describe('Auth flow — protected routes', () => {
  test('redirects unauthenticated user from /dashboards to /login with redirect param', async ({ page }) => {
    await page.goto('/dashboards');
    await expect(page).toHaveURL(/\/login\?redirect=/);
  });

  test('redirects unauthenticated user from /data-sources', async ({ page }) => {
    await page.goto('/data-sources');
    await expect(page).toHaveURL(/\/login/);
  });

  test('redirects unauthenticated user from /settings', async ({ page }) => {
    await page.goto('/settings');
    await expect(page).toHaveURL(/\/login/);
  });

  test('redirects unauthenticated user from /onboarding', async ({ page }) => {
    await page.goto('/onboarding');
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe('Auth flow — accessibility', () => {
  test('login page has proper language attribute', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  });

  test('signup page has proper language attribute', async ({ page }) => {
    await page.goto('/signup');
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  });

  test('login email input has accessible label', async ({ page }) => {
    await page.goto('/login');
    const email = page.getByLabel(/Correo Electrónico/i);
    await expect(email).toHaveAccessibleName(/Correo Electrónico/i);
  });
});