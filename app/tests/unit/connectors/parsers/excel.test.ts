import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { parseExcel } from '@/lib/connectors/parsers/excel';

function buildXlsxBuffer(rows: Array<Array<unknown>>, sheetName = 'Sheet1'): Buffer {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

describe('parseExcel', () => {
  it('parses a simple xlsx file', () => {
    const buf = buildXlsxBuffer([
      ['name', 'age'],
      ['Alice', '30'],
      ['Bob', '25'],
    ]);
    const out = parseExcel(buf);
    expect(out.headers).toEqual(['name', 'age']);
    expect(out.rows).toEqual([
      { name: 'Alice', age: '30' },
      { name: 'Bob', age: '25' },
    ]);
  });

  it('normalizes headers to snake_case', () => {
    const buf = buildXlsxBuffer([
      ['Order Date', 'Total Sales'],
      ['2024-01-01', 100],
    ]);
    const out = parseExcel(buf);
    expect(out.headers).toEqual(['order_date', 'total_sales']);
  });

  it('reads the first sheet when no sheetName is provided', () => {
    const buf = buildXlsxBuffer(
      [
        ['name', 'value'],
        ['Alice', '1'],
      ],
      'CustomSheet',
    );
    const out = parseExcel(buf);
    expect(out.rows).toEqual([{ name: 'Alice', value: '1' }]);
  });

  it('returns an empty result for a workbook with an empty sheet', () => {
    const buf = buildXlsxBuffer([]);
    const out = parseExcel(buf);
    expect(out.rows).toEqual([]);
  });

  it('sanitizes formula-injection sequences', () => {
    const buf = buildXlsxBuffer([
      ['cmd'],
      ['=cmd|"/c calc"!A0'],
    ]);
    const out = parseExcel(buf);
    expect(out.rows[0]?.cmd).toBe(`'=cmd|"/c calc"!A0`);
  });

  it('preserves empty cells as empty strings', () => {
    const buf = buildXlsxBuffer([
      ['a', 'b'],
      ['', 'x'],
      ['y', ''],
    ]);
    const out = parseExcel(buf);
    expect(out.rows).toEqual([
      { a: '', b: 'x' },
      { a: 'y', b: '' },
    ]);
  });

  it('truncates at maxRows', () => {
    const rows: Array<Array<unknown>> = [['id']];
    for (let i = 0; i < 100; i++) rows.push([String(i)]);
    const buf = buildXlsxBuffer(rows);
    const out = parseExcel(buf, { maxRows: 10 });
    expect(out.rows).toHaveLength(10);
  });
});
