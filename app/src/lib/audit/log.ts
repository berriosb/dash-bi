import { withOrgContext } from '@/db/client';
import { auditLog } from '@/db/schema';
import { logger } from '@/lib/logger';
import { redactSecrets } from '@/lib/redact';
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

/**
 * Request-like minimal interface (compatible con Next.js Request y
 * Fetch API Request, sin acoplar al tipo).
 */
type RequestLike = {
  headers: {
    get(name: string): string | null;
  };
};

function extractRequestMetadata(req: RequestLike | undefined): {
  ip?: string;
  userAgent?: string;
} {
  if (!req) return {};
  return {
    ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      ?? req.headers.get('x-real-ip')
      ?? undefined,
    userAgent: req.headers.get('user-agent') ?? undefined,
  };
}

function redactMetadata(meta?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!meta) return undefined;
  return Object.fromEntries(
    Object.entries(meta).map(([k, v]) => [
      k,
      typeof v === 'string' ? redactSecrets(v) : v,
    ]),
  );
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