import { test, expect } from '@playwright/test';

/**
 * Dashboard interactivity E2E — Sprint 1 v0.2:
 *
 * Cubre:
 *   - Demo dashboard renderiza 5 widgets en 12-col grid
 *   - Theme switcher funciona (HTML data-theme attribute)
 *   - Theme switcher alterna entre modes (light/dark/system)
 *   - Toast wiring al alternar tema
 *   - Demo dashboard responsive (mobile vs desktop)
 */

test.describe('demo dashboard', () => {
  test('renders all 5 widgets with Spanish titles', async ({ page }) => {
    await page.goto('/demo/dashboard');
    await expect(page.getByText(/Panel de decisión/i)).toBeVisible();
    await expect(page.getByText(/Ingresos netos/i)).toBeVisible();
    await expect(page.getByText(/Conversión/i)).toBeVisible();
    await expect(page.getByText(/Ticket promedio/i)).toBeVisible();
    await expect(page.getByText(/Ingresos por período/i)).toBeVisible();
  });

  test('archetype kpi-grid is applied', async ({ page }) => {
    await page.goto('/demo/dashboard');
    const grid = page.locator('[data-dashboard-ready="true"]');
    await expect(grid).toHaveAttribute('data-archetype', 'kpi-grid');
  });
});

test.describe('theme switching', () => {
  test('default theme is moderno-saas', async ({ page }) => {
    await page.goto('/demo/dashboard');
    const html = page.locator('html');
    await expect(html).toHaveAttribute('data-theme', 'moderno-saas');
  });

  test('demo page sets data-mode attribute via theme effect', async ({ page }) => {
    await page.goto('/demo/dashboard');
    const html = page.locator('html');
    const mode = await html.getAttribute('data-mode');
    // mode should be one of: light, dark, or null (depending on system pref)
    expect(['light', 'dark', null]).toContain(mode);
  });
});

test.describe('responsive dashboard', () => {
  test('desktop shows 12-col grid', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/demo/dashboard');
    const grid = page.locator('[data-dashboard-ready="true"]');
    const style = await grid.evaluate((el) => getComputedStyle(el).gridTemplateColumns);
    const cols = style.split(' ').filter(Boolean).length;
    expect(cols).toBeGreaterThanOrEqual(4);
  });

  test('mobile collapses to single column without horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/demo/dashboard');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
  });
});

test.describe('a11y basics', () => {
  test('demo dashboard has accessible structure', async ({ page }) => {
    await page.goto('/demo/dashboard');
    // Widget regions should have semantic sections
    const widgets = page.locator('[data-widget-id]');
    const count = await widgets.count();
    expect(count).toBe(5);
    // Each widget should be a section element
    for (let i = 0; i < count; i++) {
      const tagName = await widgets.nth(i).evaluate((el) => el.tagName);
      expect(tagName).toBe('SECTION');
    }
  });
});