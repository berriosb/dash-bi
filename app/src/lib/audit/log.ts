import { db, withOrgContext } from '@/db/client';
import { auditLog, orgMembers } from '@/db/schema';
import { eq, sql } from 'drizzle-orm';
import { logger } from '@/lib/logger';
import { getClientIp } from '@/lib/http/client-ip';
import { redactLogObject } from '@/lib/redact';
import {
  assertSafeMetadata,
  type AuditEvent,
} from './events';

/**
 * Audit log helper.
 *
 * Sprint 1 v0.2: extraído a lib/audit para uso transversal. El spec
 * `multi-tenant.md §7` define los eventos tracked; este helper valida
 * que el metadata no incluya secrets antes de loguear.
 *
 * Uso:
 * ```ts
 * await audit(orgId, userId, 'dashboard.generated', `dashboard:${id}`, { promptLength: 120 }, req);
 * ```
 *
 * Features:
 * - Redaction automática de secrets en metadata (defense in depth)
 * - Extracción de IP y user-agent del request
 * - Failure mode: si la DB falla, loguea el error pero NO propaga
 *   (audit log nunca debe romper el flujo principal)
 *
 * Performance:
 * - Single INSERT por evento
 * - Para high-throughput (e.g., query.executed), considerar batch via
 *   BullMQ en Sprint 5+ (ver testing.md §3.2 sobre audit log isolation).
 *
 * Sprint 1.5: el INSERT corre dentro de `withOrgContext` para que las
 * RLS policies (`audit_log_isolation`) acepten la fila. Antes hacía
 * `db.insert(auditLog)` directo y el INSERT fallaba silenciosamente
 * con `FORCE ROW LEVEL SECURITY`.
 */
export interface AuditOptions {
  /**
   * Request object (opcional). Si se pasa, se extrae IP y user-agent.
   */
  req?: Request;
  /**
   * Metadata adicional. NO incluir secrets — serán redactados.
   * Si NODE_ENV !== 'production', se valida contra forbidden keys.
   */
  metadata?: Record<string, unknown>;
}

function extractRequestMetadata(req: Request | undefined): {
  ip?: string;
  userAgent?: string;
} {
  if (!req) return {};
  return {
    // The resolved client IP, not the first hop of `x-forwarded-for`: that
    // hop is the caller-controlled one, and recording it let a caller forge
    // the address stored in `audit_log.ip`. See `@/lib/http/client-ip`.
    ip: getClientIp(req),
    userAgent: req.headers.get('user-agent') ?? undefined,
  };
}

/**
 * Scrub the metadata before it is stored.
 *
 * Recursive: the redaction used to only touch top-level strings, so a
 * secret nested one level down (`{ config: { keyPreview: 'sk-…' } }`)
 * was stored in clear. The same recursive scrubber the logger uses
 * (`redactLogObject`) applies here.
 */
function redactMetadata(meta?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!meta) return undefined;
  return redactLogObject(meta);
}

export async function audit(
  orgId: string,
  userId: string | null,
  action: AuditEvent,
  resource?: string,
  options: AuditOptions = {},
): Promise<void> {
  const requestMeta = extractRequestMetadata(options.req);
  const sanitizedMetadata = redactMetadata(options.metadata);

  try {
    assertSafeMetadata(options.metadata);

    await withOrgContext(orgId, userId, async (tx) => {
      await tx.insert(auditLog).values({
        orgId,
        userId,
        action,
        resource,
        metadata: sanitizedMetadata,
        ip: requestMeta.ip,
        userAgent: requestMeta.userAgent,
      });
    });
  } catch (error) {
    // Audit log nunca debe romper el flujo principal.
    // Logueamos el error para debugging pero NO propagamos.
    logger.error(
      {
        err: error,
        orgId,
        userId,
        action,
        resource,
      },
      'audit log failed',
    );
  }
}

/**
 * The org a user belongs to, for the events that happen BEFORE a request
 * exists (a login, a logout).
 *
 * `audit_log.org_id` is NOT NULL, so an event that cannot be attributed to
 * an org cannot be stored at all: there is no "system" org to file it
 * under, and inventing one would put a tenant's login in another
 * tenant's audit log.
 */
async function resolveUserOrgId(userId: string): Promise<string | null> {
  const rows = await db.transaction(async (tx) => {
    // The `org_members_isolation` policy reads `app.current_user_id`.
    await tx.execute(sql`SELECT set_config('app.current_user_id', ${userId}, true)`);
    return tx
      .select({ orgId: orgMembers.orgId })
      .from(orgMembers)
      .where(eq(orgMembers.userId, userId))
      .limit(1);
  });
  return rows[0]?.orgId ?? null;
}

/**
 * Audit an event that belongs to a USER rather than to a request: a login,
 * a logout, a signup.
 *
 * The org comes from the user's membership. When the user has no org yet
 * (the signup flow creates it right after), there is nowhere to file the
 * event and it is skipped: an audit row with a wrong org would be worse
 * than no row.
 */
export async function auditAuthEvent(
  userId: string,
  action: AuditEvent,
  options: AuditOptions = {},
): Promise<void> {
  try {
    const orgId = await resolveUserOrgId(userId);
    if (!orgId) return;
    await audit(orgId, userId, action, `user:${userId}`, options);
  } catch (error) {
    logger.warn(
      { err: error, userId, action },
      'audit: could not resolve the org for an auth event',
    );
  }
}

/**
 * Versión sin throw — para tests que quieren verificar el INSERT directamente.
 * NO usar en código de producción. Usar `audit()` siempre.
 */
export async function _auditUnsafe(
  orgId: string,
  userId: string | null,
  action: AuditEvent,
  resource?: string,
  options: AuditOptions = {},
): Promise<void> {
  const requestMeta = extractRequestMetadata(options.req);
  const sanitizedMetadata = redactMetadata(options.metadata);

  assertSafeMetadata(options.metadata);

  await withOrgContext(orgId, userId, async (tx) => {
    await tx.insert(auditLog).values({
      orgId,
      userId,
      action,
      resource,
      metadata: sanitizedMetadata,
      ip: requestMeta.ip,
      userAgent: requestMeta.userAgent,
    });
  });
}