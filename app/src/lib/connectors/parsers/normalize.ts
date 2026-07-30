/**
 * Header normalizer for CSV/Excel files.
 *
 * Postgres identifiers are 63 chars max and must be alphanumeric/underscore
 * for unquoted use. The normalizeHeader function below makes a raw CSV/Excel
 * header safe to use as a column name.
 */
export function normalizeHeader(raw: string): string {
  return (
    raw
      // Strip BOM (Excel writes \uFEFF on UTF-8 files)
      .replace(/^\uFEFF/, '')
      .trim()
      .toLowerCase()
      // Non-alphanumeric → underscore
      .replace(/[^a-z0-9_]+/g, '_')
      // Collapse multiple underscores
      .replace(/_+/g, '_')
      // Strip leading/trailing underscores
      .replace(/^_|_$/g, '')
      // Prefix with _ if starts with a digit
      .replace(/^(\d)/, '_$1')
      // Truncate to Postgres identifier limit
      .slice(0, 63) ||
    // Fallback if everything was stripped
    'col'
  );
}

export function normalizeHeaders(raw: string[]): string[] {
  const seen = new Map<string, number>();
  return raw.map((h) => {
    const base = normalizeHeader(h);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}_${count}`;
  });
}

export function safeTableName(originalFilename: string, orgId: string): string {
  // Postgres identifier: org_<safe-orgid>_<safe-basename>
  const base = originalFilename
    .replace(/\.(csv|tsv|txt|xlsx|xls)$/i, '')
    .toLowerCase();
  const orgPart = orgId.replace(/[^a-z0-9]/gi, '');
  const namePart = normalizeHeader(base).slice(0, 40);
  return `org_${orgPart.slice(0, 16)}_${namePart}`;
}