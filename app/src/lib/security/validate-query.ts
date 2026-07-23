import { z } from 'zod';
import { redactSecrets } from '@/lib/redact';

// Tipos (importar de @/lib/widgets/schemas cuando exista)
const querySchema = z.union([
  z.object({ kind: z.literal('sql'), sql: z.string() }),
  z.object({
    kind: z.literal('stripe'),
    operation: z.object({
      type: z.string(),
      params: z.unknown(),
    }),
  }),
  z.object({
    kind: z.literal('sheets'),
    spreadsheetId: z.string(),
    range: z.string(),
  }),
]);

export type Query = z.infer<typeof querySchema>;
export type ConnectorType = 'postgres' | 'stripe' | 'sheets';

/**
 * T2 del threat model: validar SQL/queries generadas por IA ANTES de ejecutar.
 * 
 * Defense in depth:
 * 1. Esta función bloquea queries maliciosas
 * 2. DB user es read-only (no puede DML/DDL aunque se cuele algo)
 * 3. Postgres host validation (no localhost/metadata)
 */
export function validateQuery(query: Query, dataSourceType: ConnectorType): void {
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
  }

  if (dataSourceType === 'sheets') {
    if (query.kind !== 'sheets') {
      throw new ValidationError('Sheets expects sheet query');
    }
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}