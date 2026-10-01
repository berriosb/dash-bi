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
 * One schema per org (`org_<orgid>`), one table per file
 * (`<basename>_<fileid fragment>`). The dot is load-bearing: every DDL builder
 * in `load.ts` requires `schema.table`, and the RLS policy is written per
 * table. This function used to emit `org_<orgid>_<basename>` with no dot, so
 * `POST /api/files/commit` always threw `targetTable must be
 * schema-qualified` — the upload succeeded and the commit could never run.
 *
 * The `fileId` fragment is what stops two uploads from landing on one table.
 * Without it the name came from the filename alone, so within one org every
 * filename that normalised to the same string shared a table:
 * "Reporte de Ventas.csv", "Reporte de Ventas.xlsx" and "reporte-de-ventas.csv"
 * all became `org_xxx.reporte_de_ventas`. Two `uploaded_files` rows, one
 * table, and the index on `(org_id, target_table)` was not unique, so the
 * database stored it without complaint.
 *
 * The suffix is derived from the file id and NOT from the filename, on
 * purpose. A filename hash looks like a fix and is not one: hashed on the
 * normalised name it preserves the collision, hashed on the raw name
 * re-uploading the same file overwrites the previous table. The file id is
 * already unique by construction, and deriving the name from it makes a
 * retry of the same upload resolve to the same table instead of orphaning
 * what was already committed.
 *
 * `normalizeHeaders` (column names) has always deduplicated with `_1`, `_2`.
 * This is the singular counterpart; the asymmetry between the two was the
 * bug.
 *
 * Both parts stay inside `[a-z_][a-z0-9_]*` and under 63 bytes, which is
 * exactly what `parseQualifiedIdent` accepts. Postgres truncates identifiers
 * at 63 bytes SILENTLY, and silent truncation is another way two different
 * tables become the same table, so the caps below are load-bearing.
 * Keeping the producer inside the validator's grammar is deliberate: the
 * validator is the security boundary, and this is what keeps the happy path
 * inside it.
 */
export function safeTableName(
  originalFilename: string,
  orgId: string,
  fileId: string,
): string {
  const base = originalFilename
    .replace(/\.(csv|tsv|txt|xlsx|xls)$/i, '')
    .toLowerCase();
  const orgPart = orgId.replace(/[^a-z0-9]/gi, '').slice(0, 16);
  // 8 hex chars off a UUID: 32 bits of disambiguation, which is far more than
  // a single org will ever upload, while staying short enough to leave room
  // for a readable basename.
  const suffix = fileId.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 8);
  // 31 + 1 + 8 = 40, the same cap the table part had before the suffix
  // existed, so the qualified name stays well inside the 63-byte limit.
  const namePart = normalizeHeader(base).slice(0, 31);
  // A degenerate org id or filename normalizes to nothing; keep both
  // identifiers non-empty so the result is always a valid pair.
  const schema = orgPart ? `org_${orgPart}` : 'org_unknown';
  const table = suffix ? `${namePart || 'upload'}_${suffix}` : namePart || 'upload';
  return `${schema}.${table}`;
}