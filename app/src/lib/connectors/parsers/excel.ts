import * as XLSX from 'xlsx';
import { normalizeHeaders } from './normalize';
import { sanitizeRows } from './sanitize';
import type { ParsedFile } from './csv';

export interface ParseExcelOptions {
  /** Max rows to keep in memory. */
  maxRows?: number;
  /** Sheet name to parse. Defaults to the first sheet. */
  sheetName?: string;
}

/**
 * Parse an XLSX/XLS file into structured rows using SheetJS.
 *
 * MVP: reads only the first sheet. Multi-sheet support is tracked
 * as Fase 2 in specs/csv-excel-connector.md.
 */
export function parseExcel(
  buffer: Buffer,
  options: ParseExcelOptions = {},
): ParsedFile {
  const maxRows = options.maxRows ?? 1_000_000;
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });

  const sheetName = options.sheetName ?? workbook.SheetNames[0];
  if (!sheetName) {
    return { headers: [], rows: [], errors: ['Workbook has no sheets'] };
  }
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    return {
      headers: [],
      rows: [],
      errors: [`Sheet not found: ${sheetName}`],
    };
  }

  // First row as header. We read with header: 1 to avoid SheetJS's
  // type inference for the first sheet row, then sheet_to_json for
  // the rest of the data with raw: false (so dates render as strings
  // that our type-inference pass can recognise).
  const headerRow = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    range: XLSX.utils.decode_range(sheet['!ref'] ?? 'A1:A1'),
    raw: true,
  })[0] as unknown[] | undefined;
  const rawHeaders = (headerRow ?? []).map((c) => (c == null ? '' : String(c)));
  const headers = normalizeHeaders(rawHeaders);

  const dataRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: null,
    raw: false,
    range: XLSX.utils.decode_range(sheet['!ref'] ?? 'A1:A1'),
  });

  // Re-key to normalized headers
  const renamed = dataRows.slice(0, maxRows).map((row) => {
    const out: Record<string, unknown> = {};
    rawHeaders.forEach((raw, i) => {
      const key = headers[i]!;
      if (!key) return;
      // SheetJS may have used the original header as the key; remap.
      out[key] = (row as Record<string, unknown>)[raw] ?? null;
    });
    return out;
  });

  return {
    headers,
    rows: sanitizeRows(renamed),
    errors: [],
  };
}