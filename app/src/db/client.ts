import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import { logger } from '@/lib/logger';
import * as schema from './schema';

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
});

export const db = drizzle(mainClient, { schema });

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
 */
export async function withOrgContext<T>(
  orgId: string,
  userId: string,
  fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>,
): Promise<T> {
  return await db.transaction(async (tx) => {
    // Setear variables de sesión que las RLS policies leen
    await tx.execute(sql`SET LOCAL app.current_org_id = ${orgId}`);
    await tx.execute(sql`SET LOCAL app.current_user_id = ${userId}`);

    const start = Date.now();
    try {
      const result = await fn(tx);
      logger.debug({ orgId, userId, durationMs: Date.now() - start }, 'withOrgContext completed');
      return result;
    } catch (error) {
      logger.error(
        { orgId, userId, durationMs: Date.now() - start, error },
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
export async function withSystemContext<T>(fn: () => Promise<T>): Promise<T> {
  return await db.transaction(fn);
}