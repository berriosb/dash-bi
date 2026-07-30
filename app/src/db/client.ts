import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import { logger } from '@/lib/logger';
import * as schema from './schema';
import type { OrgRole } from '@/lib/auth/permissions';

// ─────────────────────────────────────────────────────────────────
// Database clients
// ─────────────────────────────────────────────────────────────────

const connectionString = process.env.DATABASE_URL || 'postgresql://localhost:5432/dashbi';

// Cliente principal (lectura + escritura desde app)
const mainClient = postgres(connectionString, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
  prepare: false,
  debug: process.env.PG_DEBUG === '1'
    ? (_connection: number, query: string, _params: unknown[]) => {
        // Sprint 1.5: gated behind PG_DEBUG=1. Logs every prepared
        // statement — useful for tracing better-auth's INSERT flow.
        if (query.includes('INSERT') || query.includes('UPDATE')) {
          logger.debug({ query }, 'postgres query');
        }
      }
    : undefined,
});

export const db = drizzle(mainClient, { schema });

// ─────────────────────────────────────────────────────────────────
// T7 — Read-only DB client (defense in depth)
// ─────────────────────────────────────────────────────────────────
//
// Conexión que usa el rol Postgres `dashbi_readonly`, que solo tiene
// permisos SELECT. Si una query generada por IA logra escapar la
// validación de `validateQuery()` (T3) y se cuela un INSERT/UPDATE/
// DROP, la DB rechaza la operación a nivel de rol.
//
// Caso de uso actual: queries que la IA hace sobre tablas internas
// de dash-bi (NLQA, "cuántos dashboards tenemos?", etc. — Sprint 3+).
// Las queries de hidratación sobre data sources del usuario siguen
// yendo por los connectors (que usan las credenciales que el usuario
// proveyó, fuera de nuestro control de DB).

const readonlyConnectionString =
  process.env.DATABASE_READONLY_URL || 'postgresql://localhost:5432/dashbi';

const readonlyClient = postgres(readonlyConnectionString, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
  prepare: false,
});

export const readonlyDb = drizzle(readonlyClient, { schema });

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type ReadOnlyTx = Parameters<Parameters<typeof readonlyDb.transaction>[0]>[0];

// ─────────────────────────────────────────────────────────────────
// ⚠️ withOrgContext: WRAPPER OBLIGATORIO para queries a DB
// ─────────────────────────────────────────────────────────────────

/**
 * CRÍTICO para seguridad multi-tenant.
 *
 * TODA query a DB en /app/api debe pasar por este wrapper.
 * El ESLint rule custom `no-raw-db-queries` rechaza db.select()
 * directo en API routes.
 *
 * SET LOCAL solo vive dentro de la transacción, así que el contexto
 * de org_id SIEMPRE se aplica a las queries que están adentro.
 *
 * Postgres RLS policies leen `app.current_org_id` y filtran rows.
 *
 * IMPORTANTE — Sprint 1.5: el callback recibe `tx` y DEBE usarlo para
 * todas las queries. Si el código llama `db.select()` desde adentro del
 * callback, esas queries NO verán las GUC y RLS las rechazará / will
 * leak rows. ESLint lo bloquea vía `dash-bi/no-raw-db-queries`.
 *
 * Acepta `role` opcional (Sprint 1, v0.2): si se pasa, se setea
 * `app.current_user_role` para que `query-engine` y RLS policies
 * adicionales puedan aplicar filtros (ej: viewer sin acceso a PII).
 *
 * Overloads:
 *   withOrgContext(orgId, userId, fn)                  // legacy, default 'editor'
 *   withOrgContext(orgId, userId, role, fn)            // explícito
 */
export async function withOrgContext<T>(
  orgId: string,
  userId: string | null,
  fn: (tx: Tx) => Promise<T>,
): Promise<T>;
export async function withOrgContext<T>(
  orgId: string,
  userId: string | null,
  role: OrgRole,
  fn: (tx: Tx) => Promise<T>,
): Promise<T>;
export async function withOrgContext<T>(
  orgId: string,
  userId: string | null,
  roleOrFn: OrgRole | ((tx: Tx) => Promise<T>),
  fnMaybe?: (tx: Tx) => Promise<T>,
): Promise<T> {
  const role: OrgRole = typeof roleOrFn === 'function' ? 'editor' : roleOrFn;
  const fn = (typeof roleOrFn === 'function' ? roleOrFn : fnMaybe)!;

  return await db.transaction(async (tx) => {
    // Setear variables de sesión que las RLS policies leen.
    // Use `set_config(name, value, is_local)` instead of `SET LOCAL name = $val`
    // because (a) it accepts NULL for anonymous callers without breaking
    // the `::uuid` cast in the policies and (b) avoids the postgres-js
    // tagged-template binding for SET, which only works for DML params.
    await tx.execute(sql`SELECT set_config('app.current_org_id', ${orgId}, true)`);
    if (userId === null) {
      await tx.execute(sql`SELECT set_config('app.current_user_id', NULL, true)`);
    } else {
      await tx.execute(sql`SELECT set_config('app.current_user_id', ${userId}, true)`);
    }
    await tx.execute(sql`SELECT set_config('app.current_user_role', ${role}, true)`);

    const start = Date.now();
    try {
      const result = await fn(tx);
      logger.debug(
        { orgId, userId, role, durationMs: Date.now() - start },
        'withOrgContext completed',
      );
      return result;
    } catch (error) {
      logger.error(
        { orgId, userId, role, durationMs: Date.now() - start, error },
        'withOrgContext failed',
      );
      throw error;
    }
  });
}

/**
 * System context para migrations y cleanup jobs.
 * NO usar en /app/api/. Bypassea RLS.
 */
export async function withSystemContext<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return await db.transaction(fn);
}

/**
 * T7 — Read-only org context para queries ejecutadas por IA.
 *
 * Misma semántica que `withOrgContext` (SET LOCAL de org_id/user_id/role
 * para que las RLS policies filtren), pero usa el rol Postgres
 * `dashbi_readonly` que solo tiene permisos SELECT.
 *
 * Defense in depth: aunque `validateQuery()` falle, la DB rechaza
 * cualquier INSERT/UPDATE/DELETE/DROP a nivel de rol.
 *
 * Úsalo en:
 * - Endpoints NLQA que ejecutan SQL generado por IA contra tablas internas
 * - Cualquier futuro flow donde la IA necesite leer estado de la app
 *
 * NO lo uses para escrituras legítimas (dashboard create/update, etc.).
 */
export async function withOrgContextReadOnly<T>(
  orgId: string,
  userId: string,
  fn: (tx: ReadOnlyTx) => Promise<T>,
): Promise<T>;
export async function withOrgContextReadOnly<T>(
  orgId: string,
  userId: string,
  role: OrgRole,
  fn: (tx: ReadOnlyTx) => Promise<T>,
): Promise<T>;
export async function withOrgContextReadOnly<T>(
  orgId: string,
  userId: string,
  roleOrFn:
    | OrgRole
    | ((tx: ReadOnlyTx) => Promise<T>),
  fnMaybe?: (tx: ReadOnlyTx) => Promise<T>,
): Promise<T> {
  const role: OrgRole = typeof roleOrFn === 'function' ? 'editor' : roleOrFn;
  const fn = (typeof roleOrFn === 'function' ? roleOrFn : fnMaybe)!;

  return await readonlyDb.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.current_org_id', ${orgId}, true)`);
    await tx.execute(sql`SELECT set_config('app.current_user_id', ${userId}, true)`);
    await tx.execute(sql`SELECT set_config('app.current_user_role', ${role}, true)`);

    const start = Date.now();
    try {
      const result = await fn(tx);
      logger.debug(
        { orgId, userId, role, durationMs: Date.now() - start, mode: 'readonly' },
        'withOrgContextReadOnly completed',
      );
      return result;
    } catch (error) {
      logger.error(
        { orgId, userId, role, durationMs: Date.now() - start, error, mode: 'readonly' },
        'withOrgContextReadOnly failed',
      );
      throw error;
    }
  });
}