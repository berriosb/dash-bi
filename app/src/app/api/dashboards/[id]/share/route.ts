import { NextResponse } from 'next/server';
import { withOrgContext } from '@/db/client';
import { publicLinks } from '@/db/schema';
import { requireAuth } from '@/lib/auth/request';
import { generatePublicToken } from '@/lib/sharing/token';
import { audit } from '@/lib/audit/log';
import { toUserError, getOrGenerateCorrelationId } from '@/lib/errors/to-user-error';
import { statusFromCode } from '@/lib/errors/types';

export const dynamic = 'force-dynamic';

const DEFAULT_EXPIRY_DAYS = 30;
const MAX_EXPIRY_DAYS = 365;

function sanitizeExpiresInDays(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_EXPIRY_DAYS;
  const days = Math.floor(value);
  if (days <= 0) return DEFAULT_EXPIRY_DAYS;
  if (days > MAX_EXPIRY_DAYS) return MAX_EXPIRY_DAYS;
  return days;
}

function errorResponse(error: unknown, req: Request) {
  const correlationId = getOrGenerateCorrelationId(req);
  const appError = toUserError(error, correlationId);
  return NextResponse.json(appError, {
    status: statusFromCode(appError.code),
    headers: { 'x-correlation-id': correlationId },
  });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: dashboardId } = await params;

  try {
    const ctx = await requireAuth(req, 'dashboard.sharePublic');

    const body = await req.json().catch(() => ({}));
    const expiresInDays = sanitizeExpiresInDays(body.expiresInDays);
    const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);
    const token = generatePublicToken();

    const [link] = await withOrgContext(ctx.orgId, ctx.userId, ctx.role, async (tx) =>
      tx.insert(publicLinks).values({
        orgId: ctx.orgId,
        dashboardId,
        token,
        expiresAt,
        createdBy: ctx.userId,
      }).returning()
    );

    if (!link) {
      return NextResponse.json({ error: 'Failed to create share link' }, { status: 500 });
    }

    await audit(ctx.orgId, ctx.userId, 'export.link_generated', `dashboard:${dashboardId}`, {
      metadata: { linkId: link.id, expiresInDays },
      req,
    });

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? '';
    return NextResponse.json(
      {
        url: `${baseUrl}/share/${link.token}`,
        token: link.token,
        expiresAt: link.expiresAt,
      },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error, req);
  }
}