import { describe, it, expect } from 'vitest';
import { generateCacheKey, cacheGet, cacheSet, cacheClearOrg } from '@/lib/query-engine/cache';
import type { OrgRole } from '@/lib/auth/permissions';

/**
 * The cache key is the only thing standing between two DIFFERENT questions
 * and each other's rows.
 *
 * It used to be built with `JSON.stringify(query, Object.keys(query).sort())`.
 * A replacer ARRAY is applied at EVERY level of the value, not just the top
 * one, so any object nested below the top level was filtered by the TOP-LEVEL
 * key list and came out EMPTY. `params: { limit: 10 }` and
 * `params: { limit: 999 }` both serialized to `{"params":{}}` — same key,
 * same cached rows, wrong answer.
 *
 * The shapes below are the ones the app actually runs: the Stripe connector
 * passes `params` as an object, the SQL connector passes an array of values
 * that can itself contain objects, and the GA4 connector nests a
 * `dateRange` object. Each of them was a way to collide.
 */
const KEY = (query: unknown, role: OrgRole = 'admin') =>
  generateCacheKey('org-1', 'ds-1', query, role);

describe('query cache key — dos preguntas distintas NO pueden compartir key', () => {
  it('distinguen dos params de Stripe que solo cambian un valor', () => {
    const diez = KEY({
      kind: 'stripe',
      operation: { type: 'listCharges', params: { limit: 10 } },
      params: { limit: 10 },
    });
    const novecientosNoventaYNueve = KEY({
      kind: 'stripe',
      operation: { type: 'listCharges', params: { limit: 999 } },
      params: { limit: 999 },
    });

    expect(diez).not.toBe(novecientosNoventaYNueve);
  });

  it('distinguen dos params de SQL que solo cambian un valor anidado', () => {
    const uno = KEY({ kind: 'sql', sql: 'SELECT * FROM orders WHERE id = $1', params: [{ id: 1 }] });
    const dos = KEY({ kind: 'sql', sql: 'SELECT * FROM orders WHERE id = $1', params: [{ id: 2 }] });

    expect(uno).not.toBe(dos);
  });

  it('distinguen dos consultas GA4 con distinto rango de fechas', () => {
    // El caso más caro de la lista: el dashboard mostraba el período
    // equivocado, y no había forma de notarlo salvo mirando los números.
    const diciembre = KEY({
      kind: 'ga4',
      metrics: ['sessions'],
      dateRange: { startDate: '2025-12-01', endDate: '2025-12-31' },
    });
    const enero = KEY({
      kind: 'ga4',
      metrics: ['sessions'],
      dateRange: { startDate: '2026-01-01', endDate: '2026-01-31' },
    });

    expect(diciembre).not.toBe(enero);
  });

  it('distinguen el orden de un array de params', () => {
    // El orden de un array SÍ es semántico: son posiciones de binding.
    const a = KEY({ kind: 'sql', sql: 'SELECT $1, $2', params: [1, 2] });
    const b = KEY({ kind: 'sql', sql: 'SELECT $1, $2', params: [2, 1] });

    expect(a).not.toBe(b);
  });

  it('NO le sirve a una pregunta las filas cacheadas de otra', async () => {
    cacheClearOrg('org-1');

    const primera = KEY({ kind: 'sql', sql: 'SELECT * FROM orders WHERE id = $1', params: [{ id: 1 }] });
    const segunda = KEY({ kind: 'sql', sql: 'SELECT * FROM orders WHERE id = $1', params: [{ id: 2 }] });

    await cacheSet(primera, { rows: [{ id: 1 }], rowCount: 1, executionTimeMs: 5 }, 60);

    // La segunda pregunta NO es la primera: no puede recibir sus filas.
    expect(await cacheGet(segunda)).toBeNull();
    expect(await cacheGet(primera)).not.toBeNull();
  });
});

describe('query cache key — la misma pregunta sigue dando la misma key', () => {
  it('es determinista', () => {
    const query = { kind: 'sql', sql: 'SELECT * FROM users WHERE id = $1', params: [{ id: 7 }] };

    expect(KEY(query)).toBe(KEY(query));
  });

  it('no depende del ORDEN de las keys del objeto', () => {
    // Cambiar el orden de las keys no cambia la pregunta: si el hash
    // cambiara, la cache no pegaría nunca y perdería su razón de ser.
    const a = KEY({ kind: 'sql', sql: 'SELECT 1', params: [{ id: 1, name: 'x' }] });
    const b = KEY({ sql: 'SELECT 1', params: [{ name: 'x', id: 1 }], kind: 'sql' });

    expect(a).toBe(b);
  });

  it('sigue separando org, datasource y rol', () => {
    const query = { kind: 'sql', sql: 'SELECT 1' };

    expect(generateCacheKey('org-1', 'ds-1', query, 'admin')).not.toBe(
      generateCacheKey('org-2', 'ds-1', query, 'admin'),
    );
    expect(generateCacheKey('org-1', 'ds-1', query, 'admin')).not.toBe(
      generateCacheKey('org-1', 'ds-2', query, 'admin'),
    );
    expect(generateCacheKey('org-1', 'ds-1', query, 'admin')).not.toBe(
      generateCacheKey('org-1', 'ds-1', query, 'viewer'),
    );
  });
});
