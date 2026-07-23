import { NextResponse } from 'next/server';
import { eq, and } from 'drizzle-orm';
import { db, withOrgContext } from '@/db/client';
import { publicLinks } from '@/db/schema';
import { requirePermission } from '@/lib/auth/context';

export const dynamic = 'force-dynamic';

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(req.url);
  const orgId = req.headers.get('x-org-id') || url.searchParams.get('orgId');
  const userId = req.headers.get('x-user-id');

  if (!orgId || !userId) {
    return NextResponse.json({ error: 'x-org-id and x-user-id headers required' }, { status: 400 });
  }

  try {
    await requirePermission(userId, orgId, 'dashboard.sharePublic');
    await withOrgContext(orgId, userId, async () => {
      await db.update(publicLinks)
        .set({ revokedAt: new Date() })
        .where(and(eq(publicLinks.id, id), eq(publicLinks.orgId, orgId)));
    });

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: error.name === 'ForbiddenError' ? 403 : 500 });
  }
}
