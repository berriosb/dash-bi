/**
 * Formula-injection sanitizer for CSV/Excel cells.
 *
 * Excel/Sheets interpret a cell starting with `=`, `+`, `-`, or `@` as
 * the start of a formula. When a malicious user uploads a CSV with
 * `=cmd|'/c calc'!A0` (or similar), a downstream consumer that opens
 * the file in Excel runs arbitrary code. See OWASP "Formula Injection".
 *
 * Defense: prefix any cell starting with these chars with a single
 * apostrophe. Excel renders the apostrophe as a leading character, so
 * the cell displays as plain text.
 *
 * Apply at load time (not query time) so the sanitized data is what
 * actually lands in the SQL table.
 */

const FORMULA_TRIGGERS = /^[=+\-@\t\r]/;

export function sanitizeCellValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'string') return value;
  if (value.length === 0) return value;
  if (FORMULA_TRIGGERS.test(value)) {
    return `'${value}`;
  }
  return value;
}

export function sanitizeRow(
  row: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = sanitizeCellValue(v);
  }
  return out;
}

export function sanitizeRows(
  rows: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  return rows.map(sanitizeRow);
}