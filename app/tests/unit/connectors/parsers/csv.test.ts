import { describe, it, expect } from 'vitest';
import { parseCSV } from '@/lib/connectors/parsers/csv';

describe('parseCSV', () => {
  it('parses comma-separated values with header row', () => {
    const buf = Buffer.from(
      'name,age,city\nAlice,30,NYC\nBob,25,LA\n',
      'utf8',
    );
    const out = parseCSV(buf);
    expect(out.headers).toEqual(['name', 'age', 'city']);
    expect(out.rows).toEqual([
      { name: 'Alice', age: '30', city: 'NYC' },
      { name: 'Bob', age: '25', city: 'LA' },
    ]);
    expect(out.errors).toEqual([]);
  });

  it('strips BOM from the first header', () => {
    const buf = Buffer.from('\uFEFFname,age\nAlice,30\n', 'utf8');
    const out = parseCSV(buf);
    expect(out.headers).toEqual(['name', 'age']);
  });

  it('auto-detects tab delimiter', () => {
    const buf = Buffer.from('name\tage\nAlice\t30\n', 'utf8');
    const out = parseCSV(buf);
    expect(out.headers).toEqual(['name', 'age']);
    expect(out.rows).toEqual([{ name: 'Alice', age: '30' }]);
  });

  it('respects explicit delimiter option', () => {
    const buf = Buffer.from('name;age\nAlice;30\n', 'utf8');
    const out = parseCSV(buf, { delimiter: ';' });
    expect(out.rows).toEqual([{ name: 'Alice', age: '30' }]);
  });

  it('skips empty lines', () => {
    const buf = Buffer.from('name\n\n\nAlice\n\nBob\n', 'utf8');
    const out = parseCSV(buf);
    expect(out.rows).toEqual([{ name: 'Alice' }, { name: 'Bob' }]);
  });

  it('normalizes headers to snake_case', () => {
    const buf = Buffer.from('Order Date,Total Sales\n2024-01-01,100\n', 'utf8');
    const out = parseCSV(buf);
    expect(out.headers).toEqual(['order_date', 'total_sales']);
  });

  it('deduplicates identical headers', () => {
    const buf = Buffer.from('name,name\nAlice,Bob\n', 'utf8');
    const out = parseCSV(buf);
    expect(out.headers).toEqual(['name', 'name_1']);
  });

  it('sanitizes formula-injection sequences', () => {
    const buf = Buffer.from('col\n=cmd|"/c calc"!A0\n', 'utf8');
    const out = parseCSV(buf);
    expect(out.rows[0]?.col).toBe(`'=cmd|"/c calc"!A0`);
  });

  it('truncates at maxRows', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `n${i}`).join('\n');
    const buf = Buffer.from(`name\n${lines}\n`, 'utf8');
    const out = parseCSV(buf, { maxRows: 10 });
    expect(out.rows).toHaveLength(10);
  });

  it('returns empty rows for empty input', () => {
    const out = parseCSV(Buffer.from('', 'utf8'));
    expect(out.rows).toEqual([]);
  });
});
