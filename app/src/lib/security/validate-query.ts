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
 * T2 del threat model: validar SQL/queries generadas por IA ANTES de ejecutar.
 *
 * Defense in depth:
 * 1. Esta función bloquea queries maliciosas
 * 2. DB user es read-only (no puede DML/DDL aunque se cuele algo)
 * 3. Postgres host validation (no localhost/metadata)
 * 4. Role-based filtering (Sprint 1): viewer no accede a columnas PII
 */
export function validateQuery(
  query: Query,
  dataSourceType: ConnectorType,
  role?: OrgRole,
): void {
  if (dataSourceType === 'postgres' || dataSourceType === 'mysql') {
    if (query.kind !== 'sql') {
      throw new ValidationError(`${dataSourceType} expects SQL query`);
    }

    const sql = query.sql.trim();
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
    const forbidden = /\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE|GRANT|REVOKE|SLEEP|BENCHMARK|LOAD_FILE|OUTFILE)\b/i;
    if (forbidden.test(sql)) {
      throw new ValidationError('DML/DDL or forbidden function statements not allowed');
    }

    // Role-based filter: viewer no puede acceder a columnas PII (Sprint 1 v0.2)
    if (role) {
      assertRolePermissions(sql, role);
    }

    // Auto-inject LIMIT 10000 si no tiene
    if (!/LIMIT\s+\d+/i.test(sql)) {
      // Quitar ; final si existe, agregar LIMIT
      const cleanSql = sql.replace(/;\s*$/, '');
      query.sql = `${cleanSql} LIMIT 10000`;
    }
  }

  if (dataSourceType === 'stripe') {
    if (query.kind !== 'stripe') {
      throw new ValidationError('Stripe expects stripe operation');
    }
    if (role) {
      assertStripeRolePermissions(query.operation.type, role);
    }
  }

  if (dataSourceType === 'sheets') {
    if (query.kind !== 'sheets') {
      throw new ValidationError('Sheets expects sheet query');
    }
  }

  if (dataSourceType === 'shopify') {
    if (query.kind === 'sql') {
      const sql = query.sql.trim();
      const upper = sql.toUpperCase();
      if (!/^(SELECT|WITH|EXPLAIN)/.test(upper)) {
        throw new ValidationError('Only SELECT queries allowed');
      }
    }
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
    const upper = sql.toUpperCase();
    if (!/^(SELECT|WITH|EXPLAIN)/.test(upper)) {
      throw new ValidationError('Only SELECT queries allowed');
    }
    const semicolons = sql.split(';').filter((s) => s.trim().length > 0);
    if (semicolons.length > 1) {
      throw new ValidationError('Multi-statement queries not allowed');
    }
    const forbidden = /\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE|GRANT|REVOKE)\b/i;
    if (forbidden.test(sql)) {
      throw new ValidationError('DML/DDL statements not allowed');
    }
    if (role) assertRolePermissions(sql, role);
    if (!/LIMIT\s+\d+/i.test(sql)) {
      query.sql = `${sql.replace(/;\s*$/, '')} LIMIT 10000`;
    }
  }

  if (dataSourceType === 'ga4') {
    // GA4 (Tier 2): the Query union has a `kind: 'ga4'` variant for
    // metrics/dimensions/dateRange. There is no SQL string to validate
    // here — the connector enforces structural invariants (≥1 metric,
    // startDate ≤ endDate). This branch only verifies the query kind.
    if (query.kind !== 'ga4') {
      throw new ValidationError('GA4 expects a ga4 query (metrics/dimensions/dateRange)');
    }
  }

  if (dataSourceType === 'snowflake') {
    // Snowflake (Tier 2): SQL semantics are identical to Postgres/
    // MySQL — SELECT-only, single statement, no DML/DDL, role-based
    // PII filter, auto-inject LIMIT.
    if (query.kind !== 'sql') {
      throw new ValidationError('Snowflake expects a SQL query');
    }
    const sql = query.sql.trim();
    const upper = sql.toUpperCase();
    if (!/^(SELECT|WITH|EXPLAIN)/.test(upper)) {
      throw new ValidationError('Only SELECT queries allowed');
    }
    const semicolons = sql.split(';').filter((s) => s.trim().length > 0);
    if (semicolons.length > 1) {
      throw new ValidationError('Multi-statement queries not allowed');
    }
    const forbidden = /\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE|GRANT|REVOKE|MERGE)\b/i;
    if (forbidden.test(sql)) {
      throw new ValidationError('DML/DDL statements not allowed');
    }
    if (role) assertRolePermissions(sql, role);
    if (!/LIMIT\s+\d+/i.test(sql)) {
      query.sql = `${sql.replace(/;\s*$/, '')} LIMIT 10000`;
    }
  }

  if (dataSourceType === 'spreadsheet' || dataSourceType === 'csv' || dataSourceType === 'excel') {
    if (query.kind !== 'spreadsheet') {
      throw new ValidationError('Spreadsheet expects spreadsheet query');
    }
    // Validate the embedded SQL the same way as postgres: SELECT-only,
    // single statement, no DML/DDL, optional role-based PII filter.
    const sql = query.sql.trim();
    const upper = sql.toUpperCase();
    if (!/^(SELECT|WITH|EXPLAIN)/.test(upper)) {
      throw new ValidationError('Only SELECT queries allowed');
    }
    const semicolons = sql.split(';').filter((s) => s.trim().length > 0);
    if (semicolons.length > 1) {
      throw new ValidationError('Multi-statement queries not allowed');
    }
    const forbidden = /\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE|GRANT|REVOKE)\b/i;
    if (forbidden.test(sql)) {
      throw new ValidationError('DML/DDL statements not allowed');
    }
    if (role) assertRolePermissions(sql, role);
    if (!/LIMIT\s+\d+/i.test(sql)) {
      query.sql = `${sql.replace(/;\s*$/, '')} LIMIT 10000`;
    }
  }
}

/**
 * Filtros row-level por rol (defense in depth, además de RLS).
 * El viewer:
 *   - Solo puede SELECT (ya cubierto por regex arriba)
 *   - No puede acceder a columnas sensibles marcadas (PII masking)
 */
const SENSITIVE_COLUMN_PATTERN = /\b(password|secret|api_key|apiKey|token|ssn|tax_id|credit_card|card_number|cvv)\b/i;

/**
 * A wildcard projection returns every column, so it necessarily returns
 * the sensitive ones. `SELECT *` contains no column NAME, so the literal
 * pattern above cannot see it — a viewer could exfiltrate `password`,
 * `token` and `ssn` with a bare `SELECT * FROM users`.
 *
 * `*` and `alias.*` are blocked; `COUNT(*)` is exempt because it
 * aggregates to a single number and leaks nothing.
 */
const WILDCARD_PROJECTION = /(^|[\s,(])(?:[A-Za-z_][A-Za-z0-9_]*\s*\.\s*)?\*(?!\s*\))/;

export function assertRolePermissions(sql: string, role: OrgRole): void {
  if (role !== 'viewer') return;

  if (SENSITIVE_COLUMN_PATTERN.test(sql)) {
    throw new ValidationError(
      'Role viewer cannot access sensitive columns (PII protection)',
    );
  }

  if (WILDCARD_PROJECTION.test(sql)) {
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