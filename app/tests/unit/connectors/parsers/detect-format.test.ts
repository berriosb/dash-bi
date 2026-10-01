import { describe, it, expect } from 'vitest';
import { detectFormat } from '@/lib/connectors/parsers/detect-format';

describe('detectFormat', () => {
  it('detects xlsx by extension', () => {
    expect(detectFormat('report.xlsx', 'application/octet-stream')).toBe('xlsx');
  });

  it('detects legacy xls by extension', () => {
    expect(detectFormat('report.xls', 'application/octet-stream')).toBe('xls');
  });

  it('is case-insensitive on the extension', () => {
    expect(detectFormat('REPORT.XLSX', '')).toBe('xlsx');
  });

  it('detects csv by extension', () => {
    expect(detectFormat('data.csv', '')).toBe('csv');
  });

  it('detects tsv by extension', () => {
    expect(detectFormat('data.tsv', '')).toBe('csv');
  });

  it('detects txt by extension', () => {
    expect(detectFormat('data.txt', '')).toBe('csv');
  });

  it('detects csv by mime type when the extension is unknown', () => {
    expect(detectFormat('export', 'text/csv')).toBe('csv');
  });

  it('detects csv by the application/csv mime variant', () => {
    expect(detectFormat('export', 'application/csv')).toBe('csv');
  });

  it('prefers the excel mime over nothing when the extension is absent', () => {
    // Unknown extension + unknown mime falls back to csv, which the csv
    // parser tolerates. Pinned so the fallback is not silently changed.
    expect(detectFormat('export', 'application/octet-stream')).toBe('csv');
  });
});
