import { NextResponse } from 'next/server';
import { resolveConnector } from '@/lib/query-engine/resolve';
import { requirePermission } from '@/lib/auth/context';
import { checkRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(req.url);
  const orgId = req.headers.get('x-org-id') || url.searchParams.get('orgId');
  const userId = req.headers.get('x-user-id');
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';

  if (!orgId || !userId) {
    return NextResponse.json({ error: 'x-org-id and x-user-id headers required' }, { status: 400 });
  }

  // T9: connector.test abre conexión real a la DB/Stripe/Sheets del usuario.
  // 60 burst, 1 por segundo sostenido — evita spam de tests pero deja
  // iteración normal en la UI de configuración.
  const testLimit = checkRateLimit({
    capacity: 60,
    refillPerSecond: 1,
    key: `ds-test:org:${orgId}:ip:${ip}`,
  });
  if (!testLimit.allowed) {
    return NextResponse.json(
      { ok: false, error: 'rate_limited', retryAfterSeconds: testLimit.retryAfterSeconds },
      { status: 429, headers: { 'Retry-After': String(testLimit.retryAfterSeconds) } },
    );
  }

  try {
    await requirePermission(userId, orgId, 'datasource.view');
    const connector = await resolveConnector(orgId, userId, id);
    const result = await connector.testConnection();

    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
