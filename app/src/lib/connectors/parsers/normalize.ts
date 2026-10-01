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

/**
 * Build the schema-qualified Postgres name for an uploaded file.
 *
 * One schema per org (`org_<orgid>`), one table per file (`<basename>`).
 * The dot is load-bearing: every DDL builder in `load.ts` requires
 * `schema.table`, and the RLS policy is written per table. This function
 * used to emit `org_<orgid>_<basename>` with no dot, so
 * `POST /api/files/commit` always threw `targetTable must be
 * schema-qualified` — the upload succeeded and the commit could never run.
 *
 * Both parts stay inside `[a-z_][a-z0-9_]*` and under 63 chars, which is
 * exactly what `parseQualifiedIdent` accepts. Keeping the producer inside
 * the validator's grammar is deliberate: the validator is the security
 * boundary, and this is what keeps the happy path inside it.
 */
export function safeTableName(originalFilename: string, orgId: string): string {
  const base = originalFilename
    .replace(/\.(csv|tsv|txt|xlsx|xls)$/i, '')
    .toLowerCase();
  const orgPart = orgId.replace(/[^a-z0-9]/gi, '').slice(0, 16);
  const namePart = normalizeHeader(base).slice(0, 40);
  // A degenerate org id or filename normalizes to nothing; keep both
  // identifiers non-empty so the result is always a valid pair.
  const schema = orgPart ? `org_${orgPart}` : 'org_unknown';
  const table = namePart || 'upload';
  return `${schema}.${table}`;
}