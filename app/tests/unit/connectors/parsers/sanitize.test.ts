import { describe, it, expect } from 'vitest';
import { sanitizeCellValue, sanitizeRow, sanitizeRows } from '@/lib/connectors/parsers/sanitize';

describe('sanitizeCellValue', () => {
  it('returns null unchanged', () => {
    expect(sanitizeCellValue(null)).toBe(null);
  });

  it('returns undefined unchanged', () => {
    expect(sanitizeCellValue(undefined)).toBe(undefined);
  });

  it('returns empty string unchanged', () => {
    expect(sanitizeCellValue('')).toBe('');
  });

  it('returns numbers unchanged', () => {
    expect(sanitizeCellValue(42)).toBe(42);
  });

  it('returns booleans unchanged', () => {
    expect(sanitizeCellValue(true)).toBe(true);
  });

  it('prefixes = cells with an apostrophe', () => {
    expect(sanitizeCellValue('=cmd|"/c calc"!A0')).toBe(`'=cmd|"/c calc"!A0`);
  });

  it('prefixes + cells with an apostrophe', () => {
    expect(sanitizeCellValue('+1+1')).toBe(`'+1+1`);
  });

  it('prefixes - cells with an apostrophe', () => {
    expect(sanitizeCellValue('-2+3')).toBe(`'-2+3`);
  });

  it('prefixes @ cells with an apostrophe', () => {
    expect(sanitizeCellValue('@SUM(A1)')).toBe(`'@SUM(A1)`);
  });

  it('prefixes tab-starting cells with an apostrophe', () => {
    expect(sanitizeCellValue('\t=foo')).toBe(`'\t=foo`);
  });

  it('prefixes \\r-starting cells with an apostrophe', () => {
    expect(sanitizeCellValue('\r=foo')).toBe(`'\r=foo`);
  });

  it('does not prefix benign strings', () => {
    expect(sanitizeCellValue('hello world')).toBe('hello world');
  });

  it('does not prefix strings where the trigger is not at the start', () => {
    expect(sanitizeCellValue('hello=world')).toBe('hello=world');
  });
});

describe('sanitizeRow', () => {
  it('sanitizes every value in the row', () => {
    const out = sanitizeRow({
      name: 'Alice',
      formula: '=1+1',
      note: 'ok',
    });
    expect(out).toEqual({
      name: 'Alice',
      formula: `'=1+1`,
      note: 'ok',
    });
  });

  it('preserves keys exactly', () => {
    const out = sanitizeRow({ a: 1, b: '=foo', c: null });
    expect(Object.keys(out).sort()).toEqual(['a', 'b', 'c']);
  });
});

describe('sanitizeRows', () => {
  it('applies sanitizeRow to every row', () => {
    const out = sanitizeRows([
      { a: '=x' },
      { a: '=y' },
      { a: 'plain' },
    ]);
    expect(out).toEqual([
      { a: `'=x` },
      { a: `'=y` },
      { a: 'plain' },
    ]);
  });

  it('returns empty array for empty input', () => {
    expect(sanitizeRows([])).toEqual([]);
  });
});
