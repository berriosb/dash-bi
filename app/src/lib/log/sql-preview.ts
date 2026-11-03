import { createHash } from 'node:crypto';
import { scrubLogText } from '@/lib/redact';

/**
 * The loggable fields of a SQL statement.
 *
 * A tenant's SQL is the shape of their warehouse: table names, join logic
 * and the literals of their own data. The NLQA route logged it in full on
 * two error paths, and the threat model is explicit about it: "no loguear
 * SQL completo en error (solo query hash + primeros 100 chars)".
 *
 * So a log line carries:
 *
 * - `sqlHash`: a stable id of the statement (the same SQL always hashes
 *   the same), so the same failing query can be correlated across lines
 *   without the statement itself;
 * - `sqlPreview`: the first 100 characters, scrubbed. It carries the shape
 *   of the query (which table, which columns) and not the data, which
 *   lives in the literals further down.
 */
export const SQL_PREVIEW_MAX_CHARS = 100;

export interface SqlLogFields {
  sqlHash: string;
  sqlPreview: string;
}

export function sqlLogFields(sql: string): SqlLogFields {
  return {
    sqlHash: createHash('sha256').update(sql).digest('hex').slice(0, 12),
    sqlPreview: scrubLogText(sql.slice(0, SQL_PREVIEW_MAX_CHARS)),
  };
}
