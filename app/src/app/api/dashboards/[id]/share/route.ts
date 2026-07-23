import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { db, withOrgContext } from '@/db/client';
import { publicLinks } from '@/db/schema';
import { requirePermission } from '@/lib/auth/context';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(req.url);
  const orgId = req.headers.get('x-org-id') || url.searchParams.get('orgId');
  const userId = req.headers.get('x-user-id');

  if (!orgId || !userId) {
    return NextResponse.json({ error: 'x-org-id and x-user-id headers required' }, { status: 400 });
  }

  try {
    await requirePermission(userId, orgId, 'dashboard.sharePublic');
    const body = await req.json().catch(() => ({}));
    const { expiresInDays = 30 } = body;

    const token = crypto.randomBytes(24).toString('base64url');
    const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);

    const [link] = await withOrgContext(orgId, userId, async () => {
      return db.insert(publicLinks).values({
        orgId,
        dashboardId: id,
        token,
        expiresAt,
        createdBy: userId,
      }).returning();
    });

    if (!link) {
      return NextResponse.json({ error: 'Failed to create share link' }, { status: 500 });
    }

    return NextResponse.json({
      url: `/share/${link.token}`,
      token: link.token,
      expiresAt: link.expiresAt,
    }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: error.name === 'ForbiddenError' ? 403 : 500 });
  }
}
