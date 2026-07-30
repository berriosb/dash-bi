import { NextResponse } from 'next/server';
import { eq, and } from 'drizzle-orm';
import { withOrgContext } from '@/db/client';
import { publicLinks } from '@/db/schema';
import { requireAuth } from '@/lib/auth/request';
import { audit } from '@/lib/audit/log';
import { toUserError, getOrGenerateCorrelationId } from '@/lib/errors/to-user-error';
import { statusFromCode } from '@/lib/errors/types';

export const dynamic = 'force-dynamic';

function errorResponse(error: unknown, req: Request) {
  const correlationId = getOrGenerateCorrelationId(req);
  const appError = toUserError(error, correlationId);
  return NextResponse.json(appError, {
    status: statusFromCode(appError.code),
    headers: { 'x-correlation-id': correlationId },
  });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const ctx = await requireAuth(req, 'dashboard.sharePublic');
    await withOrgContext(ctx.orgId, ctx.userId, ctx.role, async (tx) =>
      tx.update(publicLinks)
        .set({ revokedAt: new Date() })
        .where(and(eq(publicLinks.id, id), eq(publicLinks.orgId, ctx.orgId)))
    );

    await audit(ctx.orgId, ctx.userId, 'export.link_revoked', `public_link:${id}`, { req });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error, req);
  }
}