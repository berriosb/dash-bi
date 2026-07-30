import Papa from 'papaparse';
import { normalizeHeaders } from './normalize';
import { sanitizeRows } from './sanitize';

export interface ParsedFile {
  headers: string[];
  rows: Array<Record<string, unknown>>;
  errors: string[];
}

export interface ParseOptions {
  /** Delimiter override. If undefined, Papa.parse auto-detects. */
  delimiter?: string;
  /** Max rows to keep in memory. Rows beyond are dropped (Sprint 1.5
   *  MVP limit; for large files use a streaming worker). */
  maxRows?: number;
}

/**
 * Parse CSV/TSV/TXT content into structured rows.
 *
 * - Auto-detects delimiter (Papa.parse heuristic)
 * - Trims BOM
 * - Skips empty lines
 * - Normalizes headers to snake_case (so 'Order Date' → 'order_date')
 * - Sanitizes cells against formula injection (see sanitize.ts)
 */
export function parseCSV(
  buffer: Buffer,
  options: ParseOptions = {},
): ParsedFile {
  const text = buffer.toString('utf8');
  const maxRows = options.maxRows ?? 1_000_000;

  const result = Papa.parse<Record<string, unknown>>(text, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h,
    delimiter: options.delimiter ?? '',
  });

  const rawHeaders = result.meta.fields ?? [];
  const headers = normalizeHeaders(rawHeaders);
  const rows = sanitizeRows(
    result.data.slice(0, maxRows).map((row) => {
      // Rename raw header keys to normalized ones so the consumer
      // gets a consistent shape regardless of source casing.
      const renamed: Record<string, unknown> = {};
      rawHeaders.forEach((raw, i) => {
        renamed[headers[i]!] = (row as Record<string, unknown>)[raw];
      });
      return renamed;
    }),
  );

  return {
    headers,
    rows,
    errors: result.errors.map((e) => e.message),
  };
}