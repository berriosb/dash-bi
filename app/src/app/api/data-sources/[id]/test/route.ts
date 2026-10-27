import { NextResponse } from 'next/server';
import { errorResponse } from '@/lib/errors/response';
import { resolveConnector } from '@/lib/query-engine/resolve';
import { requireAuth } from '@/lib/auth/request';
import { checkRateLimit } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { redactError } from '@/lib/redact';

export const dynamic = 'force-dynamic';

/**
 * What the user is told when the connection test fails.
 *
 * Curated on purpose: the driver's own message names the host, the port, the
 * database role and sometimes the credentials, and `datasource.view` is
 * granted to viewers — so the raw text is reconnaissance, not copy.
 */
const CONNECTION_FAILED_MESSAGE =
  'No pudimos conectar con la fuente de datos. Revisá la configuración y las credenciales.';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const ctx = await requireAuth(req, 'datasource.view');
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';

    const testLimit = checkRateLimit({
      capacity: 60,
      refillPerSecond: 1,
      key: `ds-test:org:${ctx.orgId}:ip:${ip}`,
    });
    if (!testLimit.allowed) {
      return NextResponse.json(
        { ok: false, error: 'rate_limited', retryAfterSeconds: testLimit.retryAfterSeconds },
        { status: 429, headers: { 'Retry-After': String(testLimit.retryAfterSeconds) } },
      );
    }

    const connector = await resolveConnector(ctx.orgId, ctx.userId, id, ctx.role);
    const result = await connector.testConnection();

    if (result.ok) {
      return NextResponse.json(result);
    }

    // This used to echo `error.message` back. For a connector test that
    // message is routinely a DSN: `getaddrinfo ENOTFOUND db.internal` or
    // `password authentication failed for user "dashbi_readonly"`, host and
    // role name included. That is infrastructure reconnaissance handed to any
    // authenticated user who can press "test connection".
    //
    // `testConnection()` RESOLVES with the failure instead of throwing it,
    // which is why `errorResponse()` never sanitized it: the raw object came
    // straight out of this route. The detail now stays here, and the client
    // gets a stable code plus a message it can show.
    const detail = redactError(result.error);
    logger.warn(
      {
        dataSourceId: id,
        orgId: ctx.orgId,
        userId: ctx.userId,
        role: ctx.role,
        latencyMs: result.latencyMs,
        error: detail,
      },
      'Data source connection test failed',
    );

    return NextResponse.json({
      ok: false,
      error: 'connection_failed',
      message: CONNECTION_FAILED_MESSAGE,
      latencyMs: result.latencyMs,
    });
  } catch (error: unknown) {
    return errorResponse(error, req);
  }
}
