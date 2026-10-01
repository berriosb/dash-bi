import { describe, it, expect } from 'vitest';
import { safeTableName } from '@/lib/connectors/parsers/normalize';
import { parseQualifiedIdent } from '@/lib/connectors/parsers/sql-ident';

/**
 * Data-integrity bug: `targetTable` had no disambiguation at all.
 *
 * It was built from the filename alone, so within one org every filename that
 * normalised to the same string pointed at the SAME Postgres table. Measured:
 *
 *   "Reporte de Ventas.csv"   -> org_xxx.reporte_de_ventas
 *   "Reporte de Ventas.xlsx"  -> org_xxx.reporte_de_ventas
 *   "reporte-de-ventas.csv"   -> org_xxx.reporte_de_ventas
 *
 * Two `uploaded_files` rows, one table. The second commit collided, and the
 * index on `(org_id, target_table)` was NOT unique, so the database was happy
 * to store it. Nothing surfaced until the data was wrong.
 *
 * The suffix is derived from the file id, never from the filename. A
 * filename-derived hash would look like a fix and be none: hashed on the
 * normalised name it preserves the collision, hashed on the raw name
 * re-uploading the same file silently overwrites the old table.
 *
 * `normalizeHeaders` (plural, column names) already deduplicated with `_1`,
 * `_2`. `safeTableName` (singular, table name) did not. The asymmetry was the
 * bug.
 */

const ORG = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
const FILE_A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const FILE_B = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';

describe('safeTableName — disambiguation by file id', () => {
  it('gives two uploads of the SAME filename different tables', () => {
    const a = safeTableName('Reporte de Ventas.csv', ORG, FILE_A);
    const b = safeTableName('Reporte de Ventas.csv', ORG, FILE_B);
    expect(a).not.toBe(b);
  });

  it('separates filenames that normalise to the same string', () => {
    // The exact case that collided before, across extension, case and
    // punctuation. These are four SEPARATE uploads, so each gets its own file
    // id -- passing one shared id here would ask for the same table four
    // times, and getting the same answer is the point of the determinism
    // test above, not a bug.
    const names = [
      'Reporte de Ventas.csv',
      'Reporte de Ventas.xlsx',
      'reporte-de-ventas.csv',
      'REPORTE DE VENTAS.txt',
    ];
    const tables = names.map((n, i) => safeTableName(n, ORG, `${i}-${FILE_A}`));
    expect(new Set(tables).size).toBe(names.length);
  });

  it('is deterministic: same filename and same file id gives the same table', () => {
    // Retries of the same upload must not orphan the rows already committed
    // under the first attempt.
    expect(safeTableName('Ventas.csv', ORG, FILE_A)).toBe(
      safeTableName('Ventas.csv', ORG, FILE_A),
    );
  });

  it('stays inside the grammar parseQualifiedIdent enforces', () => {
    for (const fileId of [FILE_A, FILE_B, '', 'not-a-uuid', '0'.repeat(60)]) {
      const out = safeTableName('Reporte de Ventas.csv', ORG, fileId);
      expect(() => parseQualifiedIdent(out), fileId).not.toThrow();
    }
  });

  it('keeps each identifier under the 63-byte Postgres limit', () => {
    // Postgres truncates silently at 63 bytes, and truncation is how two
    // different tables become the same table. The long-filename case is the
    // one that would hit it.
    const long = 'a'.repeat(200) + '.csv';
    const { schema, table } = parseQualifiedIdent(safeTableName(long, ORG, FILE_A));
    expect(schema.length).toBeLessThanOrEqual(63);
    expect(table.length).toBeLessThanOrEqual(63);
  });

  it('keeps the human-readable basename visible in the name', () => {
    // The suffix exists to disambiguate, not to replace. An operator looking
    // at \dt should still recognise what the table holds.
    const { table } = parseQualifiedIdent(safeTableName('Reporte de Ventas.csv', ORG, FILE_A));
    expect(table).toContain('reporte_de_ventas');
  });

  it('derives the suffix from the file id, not from the filename', () => {
    // Same file id, different filename: the name part changes, the suffix
    // does not. This is what distinguishes it from a filename hash.
    const a = parseQualifiedIdent(safeTableName('Ventas.csv', ORG, FILE_A)).table;
    const b = parseQualifiedIdent(safeTableName('Clientes.csv', ORG, FILE_A)).table;
    expect(a.slice(-8)).toBe(b.slice(-8));
    expect(a).not.toBe(b);
  });

  it('still produces two valid identifiers for a degenerate input', () => {
    for (const [filename, orgId, fileId] of [
      ['.csv', '', ''],
      ['', '', ''],
      ['ünïcödé.csv', 'ñ', FILE_A],
      ['---.csv', '!!!', FILE_A],
    ] as const) {
      const out = safeTableName(filename, orgId, fileId);
      expect(out, `${filename}/${orgId}/${fileId}`).toMatch(
        /^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/,
      );
      expect(() => parseQualifiedIdent(out)).not.toThrow();
    }
  });
});
