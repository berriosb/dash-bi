import { test, expect } from '@playwright/test';

test.describe('dashboard demo surface', () => {
  test('renders dashboard context and widgets on desktop', async ({ page }) => {
    await page.goto('/demo/dashboard');

    await expect(page.getByRole('heading', { name: 'Ingresos y rendimiento' })).toBeVisible();
    await expect(page.getByText('Panel de decisión')).toBeVisible();
    await expect(page.locator('[data-dashboard-ready="true"]')).toBeVisible();
    await expect(page.locator('[data-widget-id]')).toHaveCount(5);

    const state = await page.locator('[data-dashboard-ready="true"]').evaluate((element) => ({
      archetype: element.getAttribute('data-archetype'),
      width: element.getBoundingClientRect().width,
      overflow: document.documentElement.scrollWidth > window.innerWidth,
    }));

    expect(state.archetype).toBe('kpi-grid');
    expect(state.width).toBeGreaterThan(900);
    expect(state.overflow).toBe(false);
  });

  test('collapses the grid to one column on mobile without horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/demo/dashboard');

    await expect(page.getByRole('heading', { name: 'Ingresos y rendimiento' })).toBeVisible();
    const state = await page.locator('[data-dashboard-ready="true"]').evaluate((element) => ({
      columns: getComputedStyle(element).gridTemplateColumns,
      overflow: document.documentElement.scrollWidth > window.innerWidth,
    }));

    expect(state.columns).toContain('358px');
    expect(state.overflow).toBe(false);
  });
});
