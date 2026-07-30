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
  if (dataSourceType === 'postgres') {
    if (query.kind !== 'sql') {
      throw new ValidationError('Postgres expects SQL query');
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

    // Prohibir DML/DDL
    const forbidden = /\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE|GRANT|REVOKE)\b/i;
    if (forbidden.test(sql)) {
      throw new ValidationError('DML/DDL statements not allowed');
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

export function assertRolePermissions(sql: string, role: OrgRole): void {
  if (role !== 'viewer') return;

  if (SENSITIVE_COLUMN_PATTERN.test(sql)) {
    throw new ValidationError(
      'Role viewer cannot access sensitive columns (PII protection)',
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