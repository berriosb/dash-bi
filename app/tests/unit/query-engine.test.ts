import { describe, it, expect } from 'vitest';
import { generateCacheKey, cacheGet, cacheSet, cacheClearOrg } from '@/lib/query-engine/cache';
import { hydrateWidget } from '@/lib/query-engine/hydrate';
import type { Widget } from '@/lib/widgets/types';
import type { QueryResult } from '@/lib/connectors/types';

describe('Query Engine Cache & Hydration', () => {
  it('generates deterministic cache keys', () => {
    const key1 = generateCacheKey('org-1', 'ds-1', { kind: 'sql', sql: 'SELECT * FROM users' });
    const key2 = generateCacheKey('org-1', 'ds-1', { kind: 'sql', sql: 'SELECT * FROM users' });
    const key3 = generateCacheKey('org-2', 'ds-1', { kind: 'sql', sql: 'SELECT * FROM users' });

    expect(key1).toBe(key2);
    expect(key1).not.toBe(key3); // Tenant isolated
  });

  it('stores and retrieves cache entries within TTL', async () => {
    const key = generateCacheKey('org-1', 'ds-1', { test: true });
    const result: QueryResult = {
      rows: [{ id: 1, name: 'Test' }],
      rowCount: 1,
      executionTimeMs: 12,
    };

    await cacheSet(key, result, 10);
    const cached = await cacheGet(key);

    expect(cached).toEqual(result);

    cacheClearOrg('org-1');
    const cleared = await cacheGet(key);
    expect(cleared).toBeNull();
  });

  it('hydrates KPI widget correctly', () => {
    const widget: Widget = {
      id: 'w-kpi-1',
      type: 'kpi',
      position: { col: 1, row: 1, colSpan: 3, rowSpan: 2 },
      config: { title: 'Total Revenue', format: 'currency' },
      data: null,
      source: {
        kind: 'query',
        dataSourceId: 'ds-1',
        query: { kind: 'sql', sql: 'SELECT 150000 as value, 12 as delta' },
      },
    };

    const queryResult: QueryResult = {
      rows: [{ value: 150000, delta: 12 }],
      rowCount: 1,
      executionTimeMs: 5,
    };

    const hydrated = hydrateWidget(widget, queryResult);
    expect(hydrated.data).toEqual({ value: 150000, delta: 12, target: undefined });
  });

  it('hydrates Bar Chart widget correctly', () => {
    const widget: Widget = {
      id: 'w-bar-1',
      type: 'bar-chart',
      position: { col: 1, row: 3, colSpan: 6, rowSpan: 4 },
      config: { title: 'Monthly Sales' },
      data: null,
      source: {
        kind: 'query',
        dataSourceId: 'ds-1',
        query: { kind: 'sql', sql: 'SELECT month, sales FROM monthly_report' },
      },
    };

    const queryResult: QueryResult = {
      rows: [
        { month: 'Jan', sales: 100 },
        { month: 'Feb', sales: 150 },
      ],
      rowCount: 2,
      executionTimeMs: 8,
    };

    const hydrated = hydrateWidget(widget, queryResult);
    expect(hydrated.data).toEqual(queryResult.rows);
  });
});
