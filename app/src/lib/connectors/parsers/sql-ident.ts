/**
 * T3 — identifier validation for every raw-SQL sink.
 *
 * Drizzle cannot bind an identifier (table/schema) as a query parameter, so
 * each `sql.raw` call site that interpolates one has to validate it itself.
 * Historically these sinks had two independent problems:
 *
 *   1. No validation. `sql.raw(\`SELECT 1 FROM ${file.targetTable}\`)` trusts a
 *      `text` column. Anything that can write that column owns the database.
 *   2. No shared rule. `load.ts` had a local `quoteIdent`, so a caller that
 *      interpolated the identifier *unquoted* (`loadRows`) was still injectable
 *      even though every sibling quoted correctly.
 *
 * So validation lives here, once, and every sink routes through it. The rule
 * is deliberately stricter than Postgres: unquoted identifiers in this app are
 * always lowercase, ASCII, `[a-z_][a-z0-9_]*`, which is exactly what
 * `safeTableName` and `normalizeHeader` emit. Anything else — uppercase,
 * embedded quotes, whitespace, comments, extra dots — is rejected rather than
 * escaped, so a poisoned value fails loudly instead of reaching the parser.
 *
 * `quoteIdent` is exported for building *derived* names (index and policy
 * names we construct ourselves), but it is deliberately NOT the validation
 * boundary: quoting makes hostile input inert, it does not make it intended.
 * Use `parseQualifiedIdent` for anything that came from storage or a request.
 */

export class UnsafeIdentifierError extends Error {
  constructor(what: string) {
    // The offending value is deliberately NOT in the message: it is untrusted
    // and this class is thrown from request handlers, so it can reach logs and
    // error responses. The caller knows which sink failed from the stack.
    super(`Unsafe SQL identifier for ${what}: expected schema.table with [a-z_][a-z0-9_]* parts`);
    this.name = 'UnsafeIdentifierError';
  }
}

/** Postgres truncates identifiers at 63 bytes; our alphabet is ASCII. */
const MAX_IDENTIFIER_LENGTH = 63;

/** Stricter than Postgres: lowercase-only, ASCII, no `$`, no digits first. */
const BARE_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

export type QualifiedIdent = {
  schema: string;
  table: string;
  /** Pre-quoted, ready to interpolate: `"schema"."table"`. */
  sql: string;
};

function assertBareIdentifier(part: string, what: string): void {
  if (part.length === 0 || part.length > MAX_IDENTIFIER_LENGTH || !BARE_IDENTIFIER.test(part)) {
    throw new UnsafeIdentifierError(what);
  }
}

/**
 * Validate and quote a schema-qualified identifier.
 *
 * Exactly one dot is allowed. `a.b.c` and `a` are both rejected — the first
 * would silently target a different table than the caller thinks, the second
 * would be an unqualified name in whatever `search_path` resolves to.
 */
export function parseQualifiedIdent(target: string): QualifiedIdent {
  const parts = target.split('.');
  if (parts.length !== 2) {
    throw new UnsafeIdentifierError('targetTable');
  }
  const [schema = '', table = ''] = parts;
  assertBareIdentifier(schema, 'schema');
  assertBareIdentifier(table, 'table');
  return { schema, table, sql: `"${schema}"."${table}"` };
}

/** Validate a single (unqualified) identifier, e.g. a schema name. */
export function parseBareIdent(name: string, what: string): string {
  assertBareIdentifier(name, what);
  return name;
}

/**
 * Quote a single identifier by escaping internal double quotes.
 *
 * Only for names this module built or that already passed
 * `parseQualifiedIdent`. Not a sanitizer.
 */
export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}
