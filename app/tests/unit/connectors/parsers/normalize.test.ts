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
  it('prefixes org_ and lowercases the filename', () => {
    const out = safeTableName('Customers.csv', 'abcdef-1234');
    expect(out).toMatch(/^org_abcdef1234_customers$/);
  });

  it('strips file extension', () => {
    const out = safeTableName('Sales-2024.xlsx', 'org');
    expect(out).toBe('org_org_sales_2024');
  });

  it('strips non-alphanumeric characters from org id', () => {
    const out = safeTableName('data.csv', 'f47ac10b-58cc-4372-a567-0e02b2c3d479');
    expect(out).toMatch(/^org_f47ac10b58cc4372_/);
  });

  it('takes only first 16 chars of the org id', () => {
    const out = safeTableName('x.csv', '0123456789abcdef');
    expect(out).toMatch(/^org_0123456789abcdef_x$/);
  });

  it('truncates the basename to 40 chars', () => {
    const long = 'a'.repeat(50) + '.csv';
    const out = safeTableName(long, 'o');
    expect(out.split('_').pop()!.length).toBeLessThanOrEqual(40);
  });
});
