import { describe, it, expect } from 'vitest';
import { normalizeHeader, normalizeHeaders, safeTableName } from '@/lib/connectors/parsers/normalize';

describe('normalizeHeader', () => {
  it('lowercases and replaces non-alphanumeric with underscores', () => {
    expect(normalizeHeader('Order Date')).toBe('order_date');
  });

  it('strips BOM character', () => {
    expect(normalizeHeader('\uFEFFProduct')).toBe('product');
  });

  it('trims whitespace and converts to lowercase', () => {
    expect(normalizeHeader('  HELLO  ')).toBe('hello');
  });

  it('collapses multiple underscores', () => {
    expect(normalizeHeader('a___b')).toBe('a_b');
  });

  it('strips leading and trailing underscores', () => {
    expect(normalizeHeader('___hello___')).toBe('hello');
  });

  it('prefixes underscore when the first char is a digit', () => {
    expect(normalizeHeader('2024 sales')).toBe('_2024_sales');
  });

  it('falls back to "col" when normalization strips everything', () => {
    expect(normalizeHeader('---')).toBe('col');
  });

  it('returns empty string fallback for empty input', () => {
    expect(normalizeHeader('')).toBe('col');
  });

  it('truncates to 63 characters (Postgres identifier limit)', () => {
    const long = 'a'.repeat(100);
    expect(normalizeHeader(long)).toHaveLength(63);
  });

  it('collapses non-ASCII characters', () => {
    expect(normalizeHeader('Español ñ')).toBe('espa_ol');
  });

  it('preserves underscores from input', () => {
    expect(normalizeHeader('user_id')).toBe('user_id');
  });
});

describe('normalizeHeaders', () => {
  it('returns normalized headers as-is when no duplicates', () => {
    expect(normalizeHeaders(['A', 'B', 'C'])).toEqual(['a', 'b', 'c']);
  });

  it('deduplicates by appending _1, _2 to duplicates', () => {
    expect(normalizeHeaders(['a', 'a', 'b'])).toEqual(['a', 'a_1', 'b']);
  });

  it('handles case where different raw headers normalize to the same key', () => {
    expect(normalizeHeaders(['Foo', 'foo', 'FOO'])).toEqual(['foo', 'foo_1', 'foo_2']);
  });

  it('returns empty array for empty input', () => {
    expect(normalizeHeaders([])).toEqual([]);
  });
});

describe('safeTableName', () => {
  // The output is `schema.table`: one schema per org, one table per file, and
  // the file id suffix so two uploads never share a table. Every DDL builder
  // in `load.ts` requires the dot -- see `target-table-sink.test.ts` for the
  // regression that contract protects, and
  // `safe-table-name-collision.test.ts` for the disambiguation.
  const FILE_ID = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';

  it('returns a schema-qualified name with an org_ schema and lowercased basename', () => {
    const out = safeTableName('Customers.csv', 'abcdef-1234', FILE_ID);
    expect(out).toBe('org_abcdef1234.customers_aaaaaaaa');
  });

  it('strips file extension', () => {
    const out = safeTableName('Sales-2024.xlsx', 'org', FILE_ID);
    expect(out).toBe('org_org.sales_2024_aaaaaaaa');
  });

  it('strips non-alphanumeric characters from org id', () => {
    const out = safeTableName('data.csv', 'f47ac10b-58cc-4372-a567-0e02b2c3d479', FILE_ID);
    expect(out).toBe('org_f47ac10b58cc4372.data_aaaaaaaa');
  });

  it('takes only first 16 chars of the org id', () => {
    const out = safeTableName('x.csv', '0123456789abcdefEXTRA', FILE_ID);
    expect(out).toBe('org_0123456789abcdef.x_aaaaaaaa');
  });

  it('truncates the basename so the table part stays within 40 chars', () => {
    // 31 chars of basename + '_' + 8 of suffix. Postgres truncates identifiers
    // at 63 bytes SILENTLY, and silent truncation is another way two tables
    // become one.
    const long = 'a'.repeat(50) + '.csv';
    const out = safeTableName(long, 'o', FILE_ID);
    expect(out.split('.').pop()!.length).toBeLessThanOrEqual(40);
  });

  it('always yields two non-empty identifiers, even for a degenerate input', () => {
    for (const [filename, orgId] of [
      ['.csv', ''],
      ['---.csv', '!!!'],
      ['.csv', 'x'],
    ] as const) {
      const out = safeTableName(filename, orgId, FILE_ID);
      expect(out).toMatch(/^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/);
    }
  });

  it('drops the suffix entirely when there is no file id, without breaking the shape', () => {
    // A caller with no id yet still gets a valid pair rather than a trailing
    // underscore. Unreachable from the upload route, which always has one.
    const out = safeTableName('Customers.csv', 'org', '');
    expect(out).toBe('org_org.customers');
  });
});
