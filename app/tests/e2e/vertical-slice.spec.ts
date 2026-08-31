import { test, expect } from '@playwright/test';
import { signUpAndVerify, signInViaUI } from './helpers/auth';

/**
 * Vertical-slice E2E for Sprint 1.5.
 *
 * Cubre el flujo crítico end-to-end:
 *   1. signup → marcar email verificado (MockEmailProvider) → sign in
 *   2. conectar un data source (Postgres) → aparece en la lista
 *   3. crear dashboard con archetype → aparece en el listado
 *   4. abrir el dashboard → verificar title
 *   5. crear share link → URL pública funciona
 *   6. PATCH archetype → GET lo refleja
 *
 * Requisitos:
 *   - `pnpm dev` con dev server y DB Postgres corriendo
 *   - Variables de entorno (DATABASE_URL, BETTER_AUTH_SECRET, etc.)
 */

const DASHBOARD_TITLE = 'E2E Smoke Dashboard';

test.describe.serial('vertical slice — signup → datasource → dashboard → share', () => {
  test('completes the happy path', async ({ page, context, request }) => {
    test.setTimeout(180_000);

    // 1. Sign up + verify + sign in via shared helper.
    const { email, password, userId } = await signUpAndVerify(request);

    await signInViaUI(page, email, password);

    // 2. Confirm the session is recognized.
    const sessionCheck = await context.request.get('/api/auth/get-session');
    expect(sessionCheck.ok()).toBeTruthy();
    const sessionData = await sessionCheck.json();
    expect(sessionData?.user?.id).toBe(userId);

    // 3. List data sources — should be empty for the new org.
    const initialList = await context.request.get('/api/data-sources');
    expect(initialList.ok()).toBeTruthy();
    expect((await initialList.json()).dataSources).toEqual([]);

    // 4. Create a Postgres data source via API.
    const dsRes = await context.request.post('/api/data-sources', {
      headers: { 'content-type': 'application/json' },
      data: {
        name: 'E2E Postgres',
        type: 'postgres',
        config: {
          host: 'db.example.test',
          port: 5432,
          database: 'production',
          username: 'reader',
          password: 'secret123',
        },
      },
    });
    expect(dsRes.ok()).toBeTruthy();
    const { dataSource } = await dsRes.json();
    expect(dataSource.id).toMatch(/[0-9a-f-]{36}/i);

    // 5. Open the data-sources page and confirm the row renders.
    await page.goto('/data-sources', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId(`datasource-card-${dataSource.id}`)).toBeVisible({ timeout: 20_000 });

    // 6. Create a dashboard with archetype directly via API.
    const dashRes = await context.request.post('/api/dashboards', {
      headers: { 'content-type': 'application/json' },
      data: {
        title: DASHBOARD_TITLE,
        description: 'Created by vertical-slice test',
        theme: 'moderno-saas',
        archetype: 'kpi-grid',
        archetypeVariant: {
          density: 'balanced',
          accent: 'default',
          timeWindow: 'last_30d',
          comparativo: 'previous_period',
        },
        widgets: [],
      },
    });
    expect(dashRes.ok()).toBeTruthy();
    const { dashboard } = await dashRes.json();
    expect(dashboard.id).toMatch(/[0-9a-f-]{36}/i);

    // 7. Open the dashboards page; the card should appear with the
    //    archetype badge ("✨ IA") because archetype != 'custom'.
    await page.goto('/dashboards', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText(DASHBOARD_TITLE).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId(`dashboard-card-${dashboard.id}`)).toContainText(/IA/, { timeout: 20_000 });

    // 8. Open the dashboard detail page.
    await page.goto(`/dashboards/${dashboard.id}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: DASHBOARD_TITLE }).first()).toBeVisible({ timeout: 45_000 });

    // 9. Create a public share link.
    const shareRes = await context.request.post(
      `/api/dashboards/${dashboard.id}/share`,
      {
        headers: { 'content-type': 'application/json' },
        data: { expiresInDays: 7 },
      },
    );
    expect(shareRes.ok()).toBeTruthy();
    const { url: shareUrl, token } = await shareRes.json();
    expect(shareUrl).toContain(`/share/${token}`);

    // 10. Visit the public URL (no session) and verify the page renders
    //     the dashboard title. /share/[token] is a public route.
    await page.goto(shareUrl, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: DASHBOARD_TITLE }).first()).toBeVisible({ timeout: 45_000 });

    // 11. PATCH archetype → GET it back. This locks down the Sprint
    //     1.5 fix for the round-trip of archetype columns.
    const patchRes = await context.request.patch(
      `/api/dashboards/${dashboard.id}`,
      {
        headers: { 'content-type': 'application/json' },
        data: { archetype: 'hero-focus' },
      },
    );
    if (!patchRes.ok()) {
      process.stderr.write(`PATCH status=${patchRes.status()}\n`);
      process.stderr.write(`PATCH body=${(await patchRes.text()).slice(0, 400)}\n`);
    }
    expect(patchRes.ok()).toBeTruthy();
    const detailRes = await context.request.get(`/api/dashboards/${dashboard.id}`);
    const { dashboard: refetched } = await detailRes.json();
    expect(refetched.archetype).toBe('hero-focus');
  });
});