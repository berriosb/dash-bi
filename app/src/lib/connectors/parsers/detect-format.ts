export type DetectedFormat = 'csv' | 'xlsx' | 'xls';

/**
 * Decide which parser handles an uploaded file.
 *
 * Lives in `connectors/parsers/` (not in the upload route handler) so every
 * caller — the upload route, the commit route, the worker, and any future
 * import path — resolves formats through ONE place. Previously adding a
 * format meant editing the route handler.
 */
export function detectFormat(filename: string, mime: string): DetectedFormat {
  const lower = filename.toLowerCase();

  if (lower.endsWith('.xlsx')) return 'xlsx';
  if (lower.endsWith('.xls')) return 'xls';

  if (
    mime === 'text/csv' ||
    mime === 'application/csv' ||
    lower.endsWith('.csv') ||
    lower.endsWith('.tsv') ||
    lower.endsWith('.txt')
  ) {
    return 'csv';
  }

  // Unknown extension + unknown mime: the csv parser tolerates more inputs
  // than the excel one, so it is the safer default.
  return 'csv';
}
