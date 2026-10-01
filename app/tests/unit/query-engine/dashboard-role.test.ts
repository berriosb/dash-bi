import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  hydrateWidgetFromQuery,
  hydrateDashboard,
} from '@/lib/query-engine/dashboard';
import { resolveConnector } from '@/lib/query-engine/resolve';
import { generateCacheKey, cacheGet, cacheClearOrg } from '@/lib/query-engine/cache';
import type { Widget } from '@/lib/widgets/types';
import type { OrgRole } from '@/lib/auth/permissions';

/**
 * CRITICAL-3 — the role was available in every route and dropped twice
 * before reaching `validateQuery`:
 *
 *   route ctx.role -> hydrateDashboard (no role)
 *                   -> hydrateWidgetFromQuery (no role)
 *                   -> resolveConnector / executeWithTimeout (no role)
 *                   -> validateQuery(..., undefined) -> assertRolePermissions
 *                      never runs
 *
 * Asserting on `assertRolePermissions` directly is exactly the gap that let
 * this ship, so these tests drive `hydrateWidgetFromQuery` /
 * `hydrateDashboard` — the real production entry — and only mock the
 * connector boundary.
 */

const { executeQuery } = vi.hoisted(() => ({ executeQuery: vi.fn() }));

vi.mock('@/lib/query-engine/resolve', () => ({
  resolveConnector: vi.fn(async () => ({
    type: 'postgres' as const,
    testConnection: vi.fn(async () => ({ ok: true, latencyMs: 1 })),
    getSchema: vi.fn(async () => ({ tables: [] })),
    executeQuery,
  })),
  DataSourceNotFoundError: class extends Error {},
}));

const PII_ROWS = [{ id: 1, customer_ssn: '123-45-6789' }];
const SAFE_ROWS = [{ id: 1, name: 'Ada' }];

function widget(id: string, sql: string): Widget {
  return {
    type: 'bar-chart',
    id,
    position: { col: 1, row: 1, colSpan: 3, rowSpan: 2 },
    config: { title: id },
    data: null,
    source: {
      kind: 'query',
      dataSourceId: 'ds-1',
      query: { kind: 'sql', sql },
      // live skips the TTL cache so each assertion reads the real path
      refresh: { mode: 'live' },
    },
  };
}

/**
 * A widget WITHOUT `mode: 'live'`. `live` short-circuits the TTL cache, so
 * every test above that uses it never touches the cache path — which is
 * exactly where a result populated for one role used to be served to another.
 */
function cacheableWidget(id: string, sql: string): Widget {
  return {
    // bar-chart keeps `data` as the raw rows, same as the live widget() helper
    type: 'bar-chart',
    id,
    position: { col: 1, row: 1, colSpan: 3, rowSpan: 2 },
    config: { title: id },
    data: null,
    source: {
      kind: 'query',
      dataSourceId: 'ds-1',
      query: { kind: 'sql', sql },
      refresh: { mode: 'cached-ttl', ttlSeconds: 60 },
    },
  };
}

const PII_WIDGET = widget('w-pii', 'SELECT customer_ssn FROM customers');
const SAFE_WIDGET = widget('w-safe', 'SELECT id, name FROM users');
const WILDCARD_WIDGET = widget('w-wildcard', 'SELECT * FROM users');

beforeEach(() => {
  executeQuery.mockReset();
  executeQuery.mockResolvedValue({ rows: SAFE_ROWS, rowCount: 1, executionTimeMs: 1 });
  vi.mocked(resolveConnector).mockClear();
  cacheClearOrg('org-1');
});

describe('hydrateWidgetFromQuery — the role must reach the validator', () => {
  it('blocks a viewer from a PII column and never reaches the connector', async () => {
    executeQuery.mockResolvedValue({ rows: PII_ROWS, rowCount: 1, executionTimeMs: 1 });

    const result = await hydrateWidgetFromQuery('org-1', 'user-1', PII_WIDGET, 'viewer');

    expect(result.data).toBeNull();
    expect(result.error?.kind).toBe('execution_error');
    expect(result.error?.message).toMatch(/PII/);
    expect(executeQuery).not.toHaveBeenCalled();
  });

  it('blocks a viewer from a wildcard projection', async () => {
    const result = await hydrateWidgetFromQuery('org-1', 'user-1', WILDCARD_WIDGET, 'viewer');

    expect(result.data).toBeNull();
    expect(result.error?.message).toMatch(/wildcard projection/i);
    expect(executeQuery).not.toHaveBeenCalled();
  });

  it('lets an admin read the same PII column', async () => {
    executeQuery.mockResolvedValue({ rows: PII_ROWS, rowCount: 1, executionTimeMs: 1 });

    const result = await hydrateWidgetFromQuery('org-1', 'user-1', PII_WIDGET, 'admin');

    expect(result.error).toBeUndefined();
    expect(result.data).toEqual(PII_ROWS);
    expect(executeQuery).toHaveBeenCalledTimes(1);
  });

  it('lets an editor read the same PII column', async () => {
    executeQuery.mockResolvedValue({ rows: PII_ROWS, rowCount: 1, executionTimeMs: 1 });

    const result = await hydrateWidgetFromQuery('org-1', 'user-1', PII_WIDGET, 'editor');

    expect(result.error).toBeUndefined();
    expect(result.data).toEqual(PII_ROWS);
  });

  it('gives a viewer a clean widget without complaint', async () => {
    const result = await hydrateWidgetFromQuery('org-1', 'user-1', SAFE_WIDGET, 'viewer');

    expect(result.error).toBeUndefined();
    expect(result.data).toEqual(SAFE_ROWS);
  });

  it('passes the role down to resolveConnector', async () => {
    await hydrateWidgetFromQuery('org-1', 'user-1', SAFE_WIDGET, 'viewer');

    expect(resolveConnector).toHaveBeenCalledWith('org-1', 'user-1', 'ds-1', 'viewer');
  });
});

describe('hydrateDashboard — the role must survive the fan-out', () => {
  it('blocks only the PII widget for a viewer and hydrates the rest', async () => {
    executeQuery.mockImplementation(async (query: { sql?: string }) =>
      String(query?.sql ?? '').includes('ssn')
        ? { rows: PII_ROWS, rowCount: 1, executionTimeMs: 1 }
        : { rows: SAFE_ROWS, rowCount: 1, executionTimeMs: 1 },
    );

    const results = await hydrateDashboard(
      'org-1',
      'user-1',
      [PII_WIDGET, SAFE_WIDGET],
      'viewer',
    );

    const byId = new Map(results.map((r) => [r.id, r]));
    expect(byId.get('w-pii')?.data).toBeNull();
    expect(byId.get('w-pii')?.error?.message).toMatch(/PII/);
    expect(byId.get('w-safe')?.error).toBeUndefined();
    expect(byId.get('w-safe')?.data).toEqual(SAFE_ROWS);
  });

  it('hydrates the PII widget for an admin loading the same dashboard', async () => {
    executeQuery.mockImplementation(async (query: { sql?: string }) =>
      String(query?.sql ?? '').includes('ssn')
        ? { rows: PII_ROWS, rowCount: 1, executionTimeMs: 1 }
        : { rows: SAFE_ROWS, rowCount: 1, executionTimeMs: 1 },
    );

    const results = await hydrateDashboard('org-1', 'user-1', [PII_WIDGET, SAFE_WIDGET], 'admin');

    expect(results.every((r) => r.error === undefined)).toBe(true);
    expect(results.find((r) => r.id === 'w-pii')?.data).toEqual(PII_ROWS);
  });
});

describe('hydrateWidgetFromQuery — the TTL cache must not cross the role boundary', () => {
  it('blocks a viewer even when an admin already populated the cache', async () => {
    executeQuery.mockResolvedValue({ rows: PII_ROWS, rowCount: 1, executionTimeMs: 1 });

    // A FRESH widget per call, exactly like production: every request
    // deserializes its own widget. Reusing one object would not reproduce
    // anything, because `validateQuery` injects `LIMIT 10000` into
    // `query.sql` in place, so the second call would hash a different query
    // and miss the cache for the wrong reason.
    const asAdmin = await hydrateWidgetFromQuery(
      'org-1',
      'admin-1',
      cacheableWidget('w-cached-pii', 'SELECT customer_ssn FROM customers'),
      'admin',
    );
    expect(asAdmin.error).toBeUndefined();
    expect(asAdmin.data).toEqual(PII_ROWS);
    expect(executeQuery).toHaveBeenCalledTimes(1);

    executeQuery.mockClear();

    const asViewer = await hydrateWidgetFromQuery(
      'org-1',
      'viewer-1',
      cacheableWidget('w-cached-pii', 'SELECT customer_ssn FROM customers'),
      'viewer',
    );

    expect(asViewer.data).toBeNull();
    expect(asViewer.error?.message).toMatch(/PII/);
    expect(JSON.stringify(asViewer.data)).not.toMatch(/customer_ssn|123-45-6789/);
    expect(executeQuery).not.toHaveBeenCalled();
  });

  it('caches the admin result under the admin key and never writes it for another role', async () => {
    executeQuery.mockResolvedValue({ rows: PII_ROWS, rowCount: 1, executionTimeMs: 1 });
    const sql = 'SELECT customer_ssn FROM customers';

    await hydrateWidgetFromQuery('org-1', 'admin-1', cacheableWidget('w-cached-pii', sql), 'admin');

    const query = { kind: 'sql' as const, sql };
    const adminEntry = await cacheGet(generateCacheKey('org-1', 'ds-1', query, 'admin'));
    const viewerEntry = await cacheGet(generateCacheKey('org-1', 'ds-1', query, 'viewer'));
    const editorEntry = await cacheGet(generateCacheKey('org-1', 'ds-1', query, 'editor'));

    expect(adminEntry?.rows).toEqual(PII_ROWS);
    expect(viewerEntry).toBeNull();
    expect(editorEntry).toBeNull();
  });

  it('still serves the cache when the role is the same', async () => {
    executeQuery.mockResolvedValue({ rows: PII_ROWS, rowCount: 1, executionTimeMs: 1 });
    const sql = 'SELECT customer_ssn FROM customers';

    const first = await hydrateWidgetFromQuery(
      'org-1',
      'admin-1',
      cacheableWidget('w-cached-pii', sql),
      'admin',
    );
    const second = await hydrateWidgetFromQuery(
      'org-1',
      'admin-2',
      cacheableWidget('w-cached-pii', sql),
      'admin',
    );

    expect(first.data).toEqual(PII_ROWS);
    expect(second.data).toEqual(PII_ROWS);
    expect(second.error).toBeUndefined();
    // second read came from the TTL cache, not from a second execution
    expect(executeQuery).toHaveBeenCalledTimes(1);
  });
});

describe('generateCacheKey — the role is part of the key', () => {
  const query = { kind: 'sql' as const, sql: 'SELECT customer_ssn FROM customers' };
  const ROLES: OrgRole[] = ['admin', 'editor', 'viewer'];

  it('differs for every role on the same org, data source and query', () => {
    const keys = ROLES.map((role) => generateCacheKey('org-1', 'ds-1', query, role));

    expect(new Set(keys).size).toBe(ROLES.length);
    keys.forEach((key, i) => {
      expect(key).toContain(`:${ROLES[i]}:`);
      keys.forEach((other, j) => {
        if (i !== j) expect(key).not.toBe(other);
      });
    });
  });

  it('is deterministic per role and keeps orgs isolated', () => {
    expect(generateCacheKey('org-1', 'ds-1', query, 'viewer')).toBe(
      generateCacheKey('org-1', 'ds-1', query, 'viewer'),
    );
    expect(generateCacheKey('org-1', 'ds-1', query, 'viewer')).not.toBe(
      generateCacheKey('org-2', 'ds-1', query, 'viewer'),
    );
  });

  it('requires role — omitting it must not compile', () => {
    const callWithoutRole = () =>
      // @ts-expect-error — role is required, so omitting it must not compile
      generateCacheKey('org-1', 'ds-1', query);

    expect(typeof callWithoutRole).toBe('function');
  });
});

describe('hydrateWidgetFromQuery — the role parameter is required, not optional', () => {
  it('takes role as a required 4th argument', () => {
    // A 3-arg call must not compile. If `role` ever goes back to being
    // optional, tsc reports an unused '@ts-expect-error' here and the
    // test file stops typechecking — that is the lock, not this assertion.
    const callWithoutRole = () =>
      // @ts-expect-error — role is required, so omitting it must not compile
      hydrateWidgetFromQuery('org-1', 'user-1', PII_WIDGET);

    expect(typeof callWithoutRole).toBe('function');
  });
});
