import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { sqlLogFields } from '@/lib/log/sql-preview';

/**
 * A tenant's SQL is the shape of their warehouse: table names, join
 * logic and the literals of their own data. The NLQA route logged it in
 * full on two error paths.
 *
 * The invariant is asserted on the SOURCES, not on one call site: the
 * next route that logs `sql:` breaks this test.
 */
const SRC = resolve(__dirname, '../../../src');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe('SQL en los logs', () => {
  it('sqlLogFields devuelve un hash estable y un preview corto', () => {
    const sql = 'SELECT id, total FROM ventas WHERE region = \' norte \' LIMIT 10000';
    const fields = sqlLogFields(sql);

    expect(fields.sqlHash).toMatch(/^[a-f0-9]{12}$/);
    expect(fields.sqlPreview.length).toBeLessThanOrEqual(100);
    expect(fields.sqlHash).toBe(sqlLogFields(sql).sqlHash);
    expect(fields.sqlHash).not.toBe(sqlLogFields(`${sql} `).sqlHash);
  });

  it('sqlLogFields no devuelve el SQL completo', () => {
    const sql = `SELECT ${'columna, '.repeat(40)}total FROM tabla_secreta`;
    const fields = sqlLogFields(sql);

    // El preview es el truncado, no el SQL entero.
    expect(fields.sqlPreview.length).toBeLessThanOrEqual(100);
    expect(fields.sqlPreview).toBe(sql.slice(0, 100));
    expect(fields.sqlPreview).not.toContain('tabla_secreta');
  });

  it('scrubea el preview', () => {
    const fields = sqlLogFields(
      'SELECT sk_FAKE_KEY_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa FROM t',
    );

    expect(fields.sqlPreview).not.toContain('sk_FAKE_KEY_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  });

  it('ningún logger.loguea la propiedad `sql` completa', () => {
    const offenders: string[] = [];

    for (const file of walk(SRC)) {
      const source = readFileSync(file, 'utf8');
      // Un `logger.warn({ sql: ... })` — la forma prohibida. `sqlHash:` y
      // `sqlPreview:` no matchean: la palabra "sql" tiene que estar sola.
      const pattern = /logger\.(warn|error|info|debug)\(\s*\{[^}]*\bsql\s*:/s;
      if (pattern.test(source)) offenders.push(file.replace(SRC, 'app/src'));
    }

    expect(offenders, 'loguear el SQL completo').toEqual([]);
  });
});
