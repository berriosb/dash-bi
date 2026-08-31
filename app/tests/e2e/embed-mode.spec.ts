import { test, expect } from '@playwright/test';
import { generateEmbedToken } from '../../src/lib/embed/token';

test.describe('Embed Mode E2E', { tag: '@critical' }, () => {
  // The test process and the playwright webServer (pnpm dev) inherit
  // LLM_KEY_ENCRYPTION_KEY from the same parent environment, so we
  // don't override it here. Overriding it in beforeAll would cause
  // the dev server to validate tokens signed with a different key
  // than the test process uses to generate them — every test would
  // fail with `invalid_signature` because the HMAC would not match.

  test('renders zero-chrome embedded dashboard directly in browser', async ({ page }) => {
    const { token } = await generateEmbedToken({
      dashboardId: 'demo',
      orgId: 'org_demo',
      allowedOrigins: ['*'],
      theme: 'moderno-saas',
      hideTitle: false,
      allowExport: false,
    });

    await page.goto(`/embed/${token}`, { waitUntil: 'domcontentloaded' });

    // 1. Assert zero-chrome UI: Header, sidebar, and nav links must NOT be rendered
    await expect(page.locator('header')).toHaveCount(0);
    await expect(page.getByRole('navigation')).toHaveCount(0);
    await expect(page.getByRole('link', { name: /data sources|configuración/i })).toHaveCount(0);

    // 2. Assert dashboard content and widgets are visible
    await expect(page.getByText(/Ingresos y rendimiento|Ingresos netos/i).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/Órdenes|Conversión/i).first()).toBeVisible();
  });

  test('displays invalid token error message when token format is wrong or signature is corrupt', async ({ page }) => {
    await page.goto('/embed/emb_invalid_signature_corrupt_payload', { waitUntil: 'domcontentloaded' });

    await expect(page.getByRole('heading', { name: 'Dashboard no disponible' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('El enlace de embebido no es válido o ha sido revocado.')).toBeVisible();
  });

  test('displays expired error message when token expiration has passed', async ({ page }) => {
    const pastDate = new Date(Date.now() - 3600 * 1000).toISOString();
    const { token } = await generateEmbedToken({
      dashboardId: 'demo',
      orgId: 'org_demo',
      allowedOrigins: ['*'],
      theme: 'moderno-saas',
      expiresAt: pastDate,
    });

    await page.goto(`/embed/${token}`, { waitUntil: 'domcontentloaded' });

    await expect(page.getByRole('heading', { name: 'Enlace de embebido expirado' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/ha expirado/i)).toBeVisible();
  });
});
