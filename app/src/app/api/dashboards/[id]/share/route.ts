import { NextResponse } from 'next/server';
import { db, withOrgContext } from '@/db/client';
import { publicLinks } from '@/db/schema';
import { requirePermission } from '@/lib/auth/context';
import { generatePublicToken } from '@/lib/sharing/token';
import { audit } from '@/lib/audit/log';

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

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: dashboardId } = await params;
  const url = new URL(req.url);
  const orgId = req.headers.get('x-org-id') || url.searchParams.get('orgId');
  const userId = req.headers.get('x-user-id');

  if (!orgId || !userId) {
    return NextResponse.json(
      { error: 'x-org-id and x-user-id headers required' },
      { status: 400 }
    );
  }

  try {
    await requirePermission(userId, orgId, 'dashboard.sharePublic');

    const body = await req.json().catch(() => ({}));
    const expiresInDays = sanitizeExpiresInDays(body.expiresInDays);
    const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);
    const token = generatePublicToken();

    const [link] = await withOrgContext(orgId, userId, async () => {
      return db.insert(publicLinks).values({
        orgId,
        dashboardId,
        token,
        expiresAt,
        createdBy: userId,
      }).returning();
    });

    if (!link) {
      return NextResponse.json(
        { error: 'Failed to create share link' },
        { status: 500 }
      );
    }

    await audit(orgId, userId, 'export.link_generated', `dashboard:${dashboardId}`, {
      metadata: { linkId: link.id, expiresInDays },
    });

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? '';
    return NextResponse.json(
      {
        url: `${baseUrl}/share/${link.token}`,
        token: link.token,
        expiresAt: link.expiresAt,
      },
      { status: 201 }
    );
  } catch (error) {
    const e = error as { message?: string; name?: string };
    return NextResponse.json(
      { error: e.message ?? 'Internal error' },
      { status: e.name === 'ForbiddenError' ? 403 : 500 }
    );
  }
}