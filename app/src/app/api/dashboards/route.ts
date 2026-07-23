import { NextResponse } from 'next/server';
import { eq, desc } from 'drizzle-orm';
import { db, withOrgContext } from '@/db/client';
import { dashboards } from '@/db/schema';
import { requirePermission } from '@/lib/auth/context';
import type { ThemeId } from '@/lib/widgets/types';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const orgId = req.headers.get('x-org-id') || url.searchParams.get('orgId');
  const userId = req.headers.get('x-user-id');

  if (!orgId || !userId) {
    return NextResponse.json({ error: 'x-org-id and x-user-id headers required' }, { status: 400 });
  }

  try {
    await requirePermission(userId, orgId, 'dashboard.view');
    const result = await withOrgContext(orgId, userId, async () => {
      return db.select()
        .from(dashboards)
        .where(eq(dashboards.orgId, orgId))
        .orderBy(desc(dashboards.updatedAt));
    });

    return NextResponse.json({ dashboards: result });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: error.name === 'ForbiddenError' ? 403 : 500 });
  }
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const orgId = req.headers.get('x-org-id') || url.searchParams.get('orgId');
  const userId = req.headers.get('x-user-id');

  if (!orgId || !userId) {
    return NextResponse.json({ error: 'x-org-id and x-user-id headers required' }, { status: 400 });
  }

  try {
    await requirePermission(userId, orgId, 'dashboard.create');
    const body = await req.json();
    const { title, description, theme, widgets } = body;

    if (!title) {
      return NextResponse.json({ error: 'title is required' }, { status: 400 });
    }

    const [created] = await withOrgContext(orgId, userId, async () => {
      return db.insert(dashboards).values({
        orgId,
        title,
        description: description || null,
        theme: (theme as ThemeId) || 'moderno-saas',
        widgets: widgets || [],
        createdBy: userId,
        updatedBy: userId,
      }).returning();
    });

    return NextResponse.json({ dashboard: created }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: error.name === 'ForbiddenError' ? 403 : 500 });
  }
}
