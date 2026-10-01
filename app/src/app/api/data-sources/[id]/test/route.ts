import { NextResponse } from 'next/server';
import { errorResponse } from '@/lib/errors/response';
import { resolveConnector } from '@/lib/query-engine/resolve';
import { requireAuth } from '@/lib/auth/request';
import { checkRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

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

    return NextResponse.json(result);
  } catch (error: unknown) {
    // This used to echo `error.message` back. For a connector test that
    // message is routinely a DSN: `getaddrinfo ENOTFOUND db.internal` or
    // `password authentication failed for user "dashbi_readonly"`, host and
    // role name included. That is infrastructure reconnaissance handed to any
    // authenticated user who can press "test connection".
    return errorResponse(error, req);
  }
}