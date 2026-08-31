import { test, expect } from '@playwright/test';

test.describe('Export & Share Dialog E2E', { tag: '@smoke' }, () => {
  test('opens export dialog and switches tabs on demo dashboard', async ({ page }) => {
    await page.goto('/demo/dashboard');
    await expect(page.locator('[data-dashboard-ready="true"]')).toBeVisible({ timeout: 20_000 });

    // 1. Locate and click Export & Share trigger button
    const exportBtn = page.getByRole('button', { name: /exportar & compartir/i });
    await expect(exportBtn).toBeVisible();
    await exportBtn.click();

    // 2. Assert modal appears with all 4 functional tabs
    await expect(page.getByRole('heading', { name: 'Exportar & Compartir' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('tab', { name: /pdf presentable/i })).toBeVisible();
    await expect(page.getByRole('tab', { name: /imagen png/i })).toBeVisible();
    await expect(page.getByRole('tab', { name: /enlace público/i })).toBeVisible();
    await expect(page.getByRole('tab', { name: /embeber/i })).toBeVisible();

    // 3. Switch to PNG tab
    await page.getByRole('tab', { name: /imagen png/i }).click();
    await expect(page.getByText(/captura instantánea/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /exportar imagen png/i })).toBeVisible();

    // 4. Switch to Embed tab
    await page.getByRole('tab', { name: /embeber/i }).click();
    await expect(page.getByText(/integración en plataformas/i)).toBeVisible();
    await expect(page.getByText(/dominios autorizados/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /generar código iframe/i })).toBeVisible();

    // 5. Close dialog
    await page.getByRole('button', { name: /cerrar ventana/i }).click();
    await expect(page.getByRole('heading', { name: 'Exportar & Compartir' })).not.toBeVisible();
  });
});
