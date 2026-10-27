import { redactSecrets } from '@/lib/redact';
import type { OrgRole } from '@/lib/auth/permissions';
import type { ConnectorType, Query } from '@/lib/connectors/types';

// Re-export the canonical Query type so existing callers
// (`import { Query } from '@/lib/security/validate-query'`)
// keep compiling. The canonical type lives in `@/lib/connectors/types`
// and is the single source of truth for the in-memory shape.
export type { Query } from '@/lib/connectors/types';

// Re-export for backward compat
export type { ConnectorType };

/**
 * DML/DDL keywords. Shared by every SQL-backed connector so a new connector
 * cannot ship with a weaker list than the one before it.
 *
 * `INTO` is here because `SELECT * INTO evil FROM orders` is CTAS: it
 * creates a table, i.e. DDL, in the customer's database, and the threat
 * model claims DML/DDL is blocked. `COPY` and `PROGRAM` are here because
 * `COPY orders TO PROGRAM '...'` is command execution on MySQL, and
 * `COPY` is DDL-ish on Postgres.
 */
const DML_DDL_KEYWORDS = [
  'INSERT', 'UPDATE', 'DELETE', 'DROP', 'TRUNCATE', 'ALTER', 'CREATE', 'GRANT', 'REVOKE',
  'INTO', 'COPY', 'PROGRAM',
] as const;

/**
 * T7 — functions a DB-issued query must never call.
 *
 * These exist because the read-only role is not the only thing standing
 * between a model and the filesystem. `validateQuery` is the layer that
 * actually decides what runs, and it used to have no file-reading function in
 * its list at all: `SELECT pg_read_file('/etc/passwd')` passed validation.
 *
 * `pg_read_file` & friends read the DATABASE SERVER's filesystem, not the
 * connector's — an AI query that reaches them turns prompt injection into
 * arbitrary file disclosure of `/etc/passwd`, service credentials and
 * anything else the process can read.
 *
 * Timing functions are timing-based DoS against the DB; the `dblink` /
 * `pg_*` egress functions let a query use the DB as a network pivot into
 * hosts the application itself cannot reach.
 */
const DANGEROUS_DB_FUNCTIONS = [
  // Postgres server filesystem
  'pg_read_file', 'pg_read_binary_file', 'pg_ls_dir', 'pg_stat_file',
  // Large-object import/export
  'lo_import', 'lo_export',
  // MySQL server filesystem
  'load_file', 'into outfile', 'into dumpfile',
  // Timing / DoS
  'pg_sleep', 'sleep', 'benchmark',
  // Network egress from the DB
  'dblink', 'dblink_connect', 'dblink_send_query',
  'pg_connect_backend', 'pg_forward_wal', 'lo_create', 'lo_unlink',
  // Session control: kill another backend (DoS against the DB)
  'pg_terminate_backend', 'pg_cancel_backend',
  // Tenant context GUCs: every tenant-scoped RLS policy reads the org
  // through `app_current_org_id()`, which reads the `app.current_org_id`
  // GUC. `set_config` can re-point that GUC mid-statement — or set `role`
  // on the customer's own database — and `current_setting` reads it back.
  'set_config', 'current_setting',
  // Internal SECURITY DEFINER helpers (cross-tenant system functions)
  'dashbi_due_alert_rules', 'dashbi_count_enabled_alert_rules',
  'dashbi_load_alert_rule', 'dashbi_resolve_public_link',
  'dashbi_user_belongs_to_org', 'dashbi_slug_is_taken',
  'dashbi_due_scheduled_reports',
] as const;

/**
 * Accepted false positives of the blocklist, all of them on the fail-closed
 * side. The list is matched as WORDS (`\b`), so a snake_case column that
 * merely CONTAINS a blocked word is not a blocked word: `into_count` and
 * `copy_count` pass. What IS over-blocked:
 *
 *  - a column literally named `copy` (or `program`, or `into`);
 *  - a string literal containing the word `into` — e.g.
 *    `SELECT 'copied into the archive' AS note`;
 *  - a legitimate `current_setting('search_path')` on the customer's own
 *    database.
 *
 * That trade is deliberate: a false NEGATIVE here re-opens a tenant
 * isolation hole (a `set_config` call re-points the `app.current_org_id`
 * GUC that every RLS policy reads through `app_current_org_id()`), while a
 * false positive costs one query that has to be rephrased. A comment and
 * string-literal stripper would narrow the list, but it is deliberately
 * NOT used: mishandling a literal there is a fail-open hole, which is
 * strictly worse than an over-block — the same reasoning that keeps
 * `SELECT *` and `password_reset_required_at` rejected below.
 */

/**
 * Build the forbidden-statement pattern for a SQL-backed connector.
 *
 * `extraKeywords` covers engine-specific DML (Snowflake's `MERGE`). Every
 * dangerous function is included in all of them: a blocklist that differs per
 * connector is how `pg_read_file` survived in the first place.
 */
function buildForbiddenPattern(extraKeywords: readonly string[] = []): RegExp {
  const alternatives = [
    ...DML_DDL_KEYWORDS,
    ...extraKeywords,
    ...DANGEROUS_DB_FUNCTIONS,
  ]
    // `into outfile` / `into dumpfile` contain a space, so escape the rest.
    .map((kw) => kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');

  return new RegExp(`\\b(${alternatives})\\b`, 'i');
}

/**
 * The shared SQL guard. EVERY SQL-backed connector runs exactly these three
 * checks, in this order, against the SAME blocklist.
 *
 * The checks used to be re-implemented per branch, and they drifted: the
 * shopify branch only verified the leading keyword, so a blocked token
 * walked straight through it. One helper, one blocklist — a new connector
 * now gets the whole protection by calling this instead of re-listing the
 * rules.
 */
function assertSafeSqlStatement(sql: string, extraKeywords: readonly string[] = []): void {
  const upper = sql.toUpperCase();

  // Solo lectura
  if (!/^(SELECT|WITH|EXPLAIN)/.test(upper)) {
    throw new ValidationError('Only SELECT queries allowed');
  }

  // Prohibir stacked queries (separados por ;)
  // Permitir ; al final, pero nada después
  const semicolons = sql.split(';').filter((s) => s.trim().length > 0);
  if (semicolons.length > 1) {
    throw new ValidationError('Multi-statement queries not allowed');
  }

  // Prohibir DML/DDL y funciones potencialmente peligrosas (SLEEP, BENCHMARK, etc.)
  const forbidden = buildForbiddenPattern(extraKeywords);
  if (forbidden.test(sql)) {
    throw new ValidationError('DML/DDL or forbidden function statements not allowed');
  }
}

function stripParenthesizedSubqueries(sql: string): string {
  let result = '';
  let depth = 0;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      if (depth > 0) depth--;
    } else if (depth === 0) {
      result += ch;
    }
  }
  return result;
}

function normalizeSqlLimit(sql: string, maxRows = 10000): string {
  const cleanSql = sql.replace(/;\s*$/, '');
  const topLevel = stripParenthesizedSubqueries(cleanSql);
  const limitMatch = topLevel.match(/\bLIMIT\s+(\d+)\b/i);

  if (!limitMatch) {
    return `${cleanSql} LIMIT ${maxRows}`;
  }

  const parsedLimit = Number(limitMatch[1]);
  if (Number.isFinite(parsedLimit) && parsedLimit > maxRows) {
    // Clamp the trailing/outer LIMIT down to maxRows
    return cleanSql.replace(
      /\bLIMIT\s+\d+(\s+OFFSET\s+\d+)?\s*$/i,
      `LIMIT ${maxRows}$1`,
    );
  }

  return cleanSql;
}

/**
 * T2 del threat model: validar SQL/queries generadas por IA ANTES de ejecutar.
 *
 * Defense in depth:
 * 1. Esta función bloquea queries maliciosas
 * 2. DB user es read-only (no puede DML/DDL aunque se cuele algo)
 * 3. Postgres host validation (no localhost/metadata)
 * 4. Role-based filtering (Sprint 1): viewer no accede a columnas PII
 *
 * PURE BY CONTRACT. This function never writes to `query`; the normalized
 * SQL (with the LIMIT injected or clamped) is returned. It used to
 * reassign `query.sql` in place, which made the validator unsafe to run
 * twice on a shared object and left any caller that computed a cache key
 * from `query.sql` before validating describing a statement that was never
 * executed. Callers that execute the SQL must use the return value.
 *
 * Returns the normalized SQL for SQL-like connectors, `undefined` for the
 * REST connectors (stripe/sheets/ga4/hubspot/shopify), which have no SQL
 * to normalize.
 */
export function validateQuery(
  query: Query,
  dataSourceType: ConnectorType,
  role?: OrgRole,
): string | undefined {
  if (dataSourceType === 'postgres' || dataSourceType === 'mysql') {
    if (query.kind !== 'sql') {
      throw new ValidationError(`${dataSourceType} expects SQL query`);
    }

    const sql = query.sql.trim();

    assertSafeSqlStatement(sql);

    // Role-based filter: viewer no puede acceder a columnas PII (Sprint 1 v0.2)
    if (role) {
      assertRolePermissions(sql, role);
    }

    // Auto-inject / clamp LIMIT 10000. Returned rather than written back:
    // this function must not mutate its argument (see the purity note
    // above `normalizeSqlLimit`).
    return normalizeSqlLimit(sql);
  }

  if (dataSourceType === 'stripe') {
    if (query.kind !== 'stripe') {
      throw new ValidationError('Stripe expects stripe operation');
    }
    if (role) {
      assertStripeRolePermissions(query.operation.type, role);
    }
    return undefined;
  }

  if (dataSourceType === 'sheets') {
    if (query.kind !== 'sheets') {
      throw new ValidationError('Sheets expects sheet query');
    }
    return undefined;
  }

  if (dataSourceType === 'shopify') {
    if (query.kind === 'sql') {
      // Same shared guard as every other SQL-backed connector: the shopify
      // branch used to check only the leading keyword, so the blocklist
      // could drift away from the other connectors.
      const sql = query.sql.trim();
      assertSafeSqlStatement(sql);
      if (role) {
        assertRolePermissions(sql, role);
      }
      return query.sql;
    }
    return undefined;
  }

  if (dataSourceType === 'hubspot') {
    // Hubspot (Tier 2): SQL is SELECT-only and maps to a CRM resource
    // (contacts/companies/deals). The connector enforces the resource
    // allowlist; here we block DML/DDL/stacked statements and apply the
    // role-based PII filter.
    if (query.kind !== 'sql') {
      throw new ValidationError('Hubspot expects a SQL query');
    }
    const sql = query.sql.trim();
    assertSafeSqlStatement(sql);
    if (role) assertRolePermissions(sql, role);
    return normalizeSqlLimit(sql);
  }

  if (dataSourceType === 'ga4') {
    // GA4 (Tier 2): the Query union has a `kind: 'ga4'` variant for
    // metrics/dimensions/dateRange. There is no SQL string to validate
    // here — the connector enforces structural invariants (≥1 metric,
    // startDate ≤ endDate). This branch only verifies the query kind.
    if (query.kind !== 'ga4') {
      throw new ValidationError('GA4 expects a ga4 query (metrics/dimensions/dateRange)');
    }
    return undefined;
  }

  if (dataSourceType === 'snowflake') {
    // Snowflake (Tier 2): SQL semantics are identical to Postgres/
    // MySQL — SELECT-only, single statement, no DML/DDL, role-based
    // PII filter, auto-inject LIMIT.
    if (query.kind !== 'sql') {
      throw new ValidationError('Snowflake expects a SQL query');
    }
    const sql = query.sql.trim();
    assertSafeSqlStatement(sql, ['MERGE']);
    if (role) assertRolePermissions(sql, role);
    return normalizeSqlLimit(sql);
  }

  if (dataSourceType === 'spreadsheet' || dataSourceType === 'csv' || dataSourceType === 'excel') {
    if (query.kind !== 'spreadsheet') {
      throw new ValidationError('Spreadsheet expects spreadsheet query');
    }
    // Validate the embedded SQL the same way as postgres: SELECT-only,
    // single statement, no DML/DDL, optional role-based PII filter.
    const sql = query.sql.trim();
    assertSafeSqlStatement(sql);
    if (role) assertRolePermissions(sql, role);
    return normalizeSqlLimit(sql);
  }

  return undefined;
}

/**
 * Filtros row-level por rol (defense in depth, además de RLS).
 * El viewer:
 *   - Solo puede SELECT (ya cubierto por regex arriba)
 *   - No puede acceder a columnas sensibles marcadas (PII masking)
 *
 * The lookarounds replace `\b` on purpose: `\b` is NOT a boundary between
 * `_` and a word character, so every snake_case column (`user_password`,
 * `customer_ssn`, `billing_tax_id`, `token_type`) used to walk straight
 * through this filter. Negating `[A-Za-z0-9]` makes `_` a valid boundary
 * while still leaving `tokenizer` alone.
 */
const SENSITIVE_COLUMN_PATTERN =
  /(?<![A-Za-z0-9])(password|secret|api_key|apiKey|token|ssn|tax_id|credit_card|card_number|cvv)(?![A-Za-z0-9])/i;

/**
 * A wildcard projection returns every column, so it necessarily returns
 * the sensitive ones. `SELECT *` contains no column NAME, so the literal
 * pattern above cannot see it — a viewer could exfiltrate `password`,
 * `token` and `ssn` with a bare `SELECT * FROM users`.
 *
 * The previous regex demanded a `[\s,(]` before the star, so a SQL comment
 * wedged in between hid it. Instead we mask the stars that belong to an
 * aggregate — `COUNT(*)` aggregates to a single number and leaks nothing —
 * and reject whatever `*` survives. A SQL
 * comment cannot hide a projection star, it can only add one, so this fails
 * closed.
 *
 * Accepted false positives, both from the fail-closed direction: a column
 * named `password_reset_required_at` is now rejected by the sensitive
 * pattern, and a `*` anywhere that is not an aggregate star — an arithmetic
 * `2 * 3`, a LIKE pattern `'a*b'` — is now rejected. `SELECT 2 * 3` was
 * already rejected by the old pattern, so that part is not a regression.
 * A SQL comment stripper would narrow this further but is deliberately NOT
 * used: mishandling a string literal there is a fail-open hole, which is
 * strictly worse than an over-block.
 */
const AGGREGATE_STAR =
  /\b(?:count|sum|avg|min|max|array_agg|json_agg)\s*\(\s*\*\s*\)/gi;

export function assertRolePermissions(sql: string, role: OrgRole): void {
  if (role !== 'viewer') return;

  if (SENSITIVE_COLUMN_PATTERN.test(sql)) {
    throw new ValidationError(
      'Role viewer cannot access sensitive columns (PII protection)',
    );
  }

  if (sql.replace(AGGREGATE_STAR, '()').includes('*')) {
    throw new ValidationError(
      'Role viewer cannot use wildcard projection (SELECT *); name the columns explicitly',
    );
  }
}

/**
 * Restricciones específicas por connector + rol.
 * Stripe: viewer no puede listar customers (PII: email, name).
 */
export function assertStripeRolePermissions(operationType: string, role: OrgRole): void {
  if (role !== 'viewer') return;

  const VIEWER_FORBIDDEN_STRIPE_OPS = new Set(['listCustomers']);
  if (VIEWER_FORBIDDEN_STRIPE_OPS.has(operationType)) {
    throw new ValidationError(
      `Role viewer cannot execute Stripe operation: ${operationType}`,
    );
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

// Re-export redactSecrets for convenience
export { redactSecrets };