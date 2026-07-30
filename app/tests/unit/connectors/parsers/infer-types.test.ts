import { describe, it, expect } from 'vitest';
import { detectType, inferColumns } from '@/lib/connectors/parsers/infer-types';

describe('detectType', () => {
  it('returns string for null/undefined/empty', () => {
    expect(detectType(null)).toBe('string');
    expect(detectType(undefined)).toBe('string');
    expect(detectType('')).toBe('string');
  });

  it('returns number for finite numbers', () => {
    expect(detectType(42)).toBe('number');
    expect(detectType(0)).toBe('number');
    expect(detectType(-1.5)).toBe('number');
  });

  it('returns string for non-finite numbers', () => {
    expect(detectType(NaN)).toBe('string');
    expect(detectType(Infinity)).toBe('string');
  });

  it('returns boolean for booleans', () => {
    expect(detectType(true)).toBe('boolean');
    expect(detectType(false)).toBe('boolean');
  });

  it('returns date for valid Date objects', () => {
    expect(detectType(new Date('2024-01-15'))).toBe('date');
  });

  it('returns string for invalid Date objects', () => {
    expect(detectType(new Date('not-a-date'))).toBe('string');
  });

  it('detects integer strings as number', () => {
    expect(detectType('42')).toBe('number');
    expect(detectType('-100')).toBe('number');
  });

  it('detects decimal strings as number', () => {
    expect(detectType('3.14')).toBe('number');
    expect(detectType('-0.5')).toBe('number');
  });

  it('detects boolean strings', () => {
    expect(detectType('true')).toBe('boolean');
    expect(detectType('false')).toBe('boolean');
    expect(detectType('yes')).toBe('boolean');
    expect(detectType('no')).toBe('boolean');
  });

  it('detects ISO date strings', () => {
    expect(detectType('2024-01-15')).toBe('date');
    expect(detectType('2024-01-15T10:30:00Z')).toBe('date');
    expect(detectType('2024-01-15T10:30:00.000Z')).toBe('date');
  });

  it('detects common date formats', () => {
    expect(detectType('01/15/2024')).toBe('date');
    expect(detectType('1/5/24')).toBe('date');
  });

  it('returns string for non-numeric non-date strings', () => {
    expect(detectType('hello')).toBe('string');
    expect(detectType('123abc')).toBe('string');
  });
});

describe('inferColumns', () => {
  it('returns empty array for empty rows', () => {
    expect(inferColumns([])).toEqual([]);
  });

  it('infers number column when >= 80% of values are numbers', () => {
    const rows = [
      { x: 1 },
      { x: 2 },
      { x: 3 },
      { x: 4 },
      { x: 5 },
    ];
    expect(inferColumns(rows)[0]?.type).toBe('number');
  });

  it('falls back to string when no type reaches 80% majority', () => {
    const rows = [
      { x: 1 },
      { x: 'two' },
      { x: 'three' },
      { x: 'four' },
      { x: 'five' },
    ];
    expect(inferColumns(rows)[0]?.type).toBe('string');
  });

  it('flags column as nullable when some values are null/empty', () => {
    const rows = [
      { x: 1 },
      { x: null },
      { x: '' },
      { x: 4 },
      { x: 5 },
    ];
    expect(inferColumns(rows)[0]?.nullable).toBe(true);
  });

  it('flags column as non-nullable when all values are present', () => {
    const rows = [
      { x: 1 },
      { x: 2 },
      { x: 3 },
      { x: 4 },
      { x: 5 },
    ];
    expect(inferColumns(rows)[0]?.nullable).toBe(false);
  });

  it('handles columns with all null values by inferring string', () => {
    const rows = [
      { x: null },
      { x: null },
      { x: null },
    ];
    expect(inferColumns(rows)[0]?.type).toBe('string');
  });

  it('infers multiple columns independently', () => {
    const rows = [
      { id: 1, name: 'a', created: '2024-01-01' },
      { id: 2, name: 'b', created: '2024-01-02' },
      { id: 3, name: 'c', created: '2024-01-03' },
      { id: 4, name: 'd', created: '2024-01-04' },
      { id: 5, name: 'e', created: '2024-01-05' },
    ];
    const cols = inferColumns(rows);
    expect(cols).toHaveLength(3);
    expect(cols.map((c) => c.type).sort()).toEqual(['date', 'number', 'string']);
  });

  it('preserves the original header names', () => {
    const rows = [{ OrderDate: '2024-01-01', Total: 100 }];
    const cols = inferColumns(rows);
    expect(cols.map((c) => c.name)).toEqual(['OrderDate', 'Total']);
  });

  it('includes up to 5 sample values', () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ x: i + 1 }));
    const cols = inferColumns(rows);
    expect(cols[0]?.samples).toEqual([1, 2, 3, 4, 5]);
  });
});
