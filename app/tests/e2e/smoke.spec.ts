import { test, expect } from '@playwright/test';

/**
 * Smoke E2E: la app carga, login page es accesible.
 *
 * Ejecutar con `pnpm test:e2e` (requiere dev server corriendo o CI con webServer).
 * Sprint 1: smoke mínimo. Cobertura completa se expande en Semana 2+.
 */

test.describe('public pages', { tag: '@smoke' }, () => {
  test('home page loads with branded content', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'dash-bi' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Get started/i })).toBeVisible();
  });

  test('login page exposes email + magic link tabs', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: /Iniciar Sesión/i })).toBeVisible();
    await expect(page.getByLabel(/Correo Electrónico/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /Magic Link/i })).toBeVisible();
  });

  test('signup page exposes organization + user fields', async ({ page }) => {
    await page.goto('/signup');
    await expect(page.getByRole('heading', { name: /Crear Organización/i })).toBeVisible();
    await expect(page.getByLabel(/Nombre de la Organización/i)).toBeVisible();
    await expect(page.getByLabel(/Tu Nombre Completo/i)).toBeVisible();
  });

  test('unauthenticated dashboard route redirects to login', async ({ page }) => {
    await page.goto('/dashboards');
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe('theme + layout', { tag: '@smoke' }, () => {
  test('demo dashboard renders the Decision Desk surface', async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto('/demo/dashboard');
    await expect(page.locator('[data-dashboard-ready="true"]')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/Panel de decisión/i)).toBeVisible({ timeout: 10_000 });
    // The regex matches all 5 widget titles. Use .first() to satisfy
    // strict-mode (Playwright refuses ambiguous matches by default).
    await expect(page.getByText(/Ingresos netos|Ingresos por período|Conversión|Órdenes|Ticket promedio/).first()).toBeVisible({ timeout: 10_000 });
  });
});