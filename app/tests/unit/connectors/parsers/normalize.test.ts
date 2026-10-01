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
  // The output is `schema.table`: one schema per org, one table per file.
  // Every DDL builder in `load.ts` requires the dot — see
  // `target-table-sink.test.ts` for the regression this contract protects.
  it('returns a schema-qualified name with an org_ schema and lowercased basename', () => {
    const out = safeTableName('Customers.csv', 'abcdef-1234');
    expect(out).toBe('org_abcdef1234.customers');
  });

  it('strips file extension', () => {
    const out = safeTableName('Sales-2024.xlsx', 'org');
    expect(out).toBe('org_org.sales_2024');
  });

  it('strips non-alphanumeric characters from org id', () => {
    const out = safeTableName('data.csv', 'f47ac10b-58cc-4372-a567-0e02b2c3d479');
    expect(out).toBe('org_f47ac10b58cc4372.data');
  });

  it('takes only first 16 chars of the org id', () => {
    const out = safeTableName('x.csv', '0123456789abcdefEXTRA');
    expect(out).toBe('org_0123456789abcdef.x');
  });

  it('truncates the basename to 40 chars', () => {
    const long = 'a'.repeat(50) + '.csv';
    const out = safeTableName(long, 'o');
    expect(out.split('.').pop()!.length).toBeLessThanOrEqual(40);
  });

  it('always yields two non-empty identifiers, even for a degenerate input', () => {
    for (const [filename, orgId] of [
      ['.csv', ''],
      ['---.csv', '!!!'],
      ['.csv', 'x'],
    ] as const) {
      const out = safeTableName(filename, orgId);
      expect(out).toMatch(/^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/);
    }
  });
});
