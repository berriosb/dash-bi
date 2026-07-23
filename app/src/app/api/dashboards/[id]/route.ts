import { NextResponse } from 'next/server';
import { eq, and, desc } from 'drizzle-orm';
import { db } from '@/db/client';
import { dashboards, dashboardVersions } from '@/db/schema';
import { withOrgContext } from '@/db/client';
import { requirePermission } from '@/lib/auth/context';
import { hydrateDashboard } from '@/lib/query-engine/dashboard';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(req.url);
  const orgId = req.headers.get('x-org-id') || url.searchParams.get('orgId');
  const userId = req.headers.get('x-user-id');

  if (!orgId || !userId) {
    return NextResponse.json({ error: 'x-org-id and x-user-id headers required' }, { status: 400 });
  }

  try {
    await requirePermission(userId, orgId, 'dashboard.view');
    const dashboard = await withOrgContext(orgId, userId, async () => {
      return db.query.dashboards.findFirst({
        where: and(eq(dashboards.id, id), eq(dashboards.orgId, orgId)),
      });
    });

    if (!dashboard) {
      return NextResponse.json({ error: 'Dashboard not found' }, { status: 404 });
    }

    // Hydrate widgets with real data
    const hydratedWidgets = await hydrateDashboard(orgId, userId, dashboard.widgets as any[]);

    return NextResponse.json({
      dashboard: {
        ...dashboard,
        widgets: hydratedWidgets,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: error.name === 'ForbiddenError' ? 403 : 500 });
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(req.url);
  const orgId = req.headers.get('x-org-id') || url.searchParams.get('orgId');
  const userId = req.headers.get('x-user-id');

  if (!orgId || !userId) {
    return NextResponse.json({ error: 'x-org-id and x-user-id headers required' }, { status: 400 });
  }

  try {
    await requirePermission(userId, orgId, 'dashboard.edit');
    const body = await req.json();

    await withOrgContext(orgId, userId, async () => {
      await db.transaction(async (tx) => {
        // Optimistic concurrency check
        const current = await tx.query.dashboards.findFirst({
          where: and(eq(dashboards.id, id), eq(dashboards.orgId, orgId)),
        });

        if (!current) {
          throw new Error('Dashboard not found');
        }

        if (body.updatedAt && current.updatedAt && new Date(body.updatedAt).getTime() < current.updatedAt.getTime()) {
          throw new Error('CONCURRENCY_CONFLICT: Dashboard was modified by another session');
        }

        await tx.update(dashboards)
          .set({
            title: body.title ?? current.title,
            description: body.description ?? current.description,
            theme: body.theme ?? current.theme,
            widgets: body.widgets ?? current.widgets,
            updatedBy: userId,
            updatedAt: new Date(),
          })
          .where(and(eq(dashboards.id, id), eq(dashboards.orgId, orgId)));

        // Create version history entry
        const lastVersion = await tx.query.dashboardVersions.findFirst({
          where: eq(dashboardVersions.dashboardId, id),
          orderBy: desc(dashboardVersions.version),
        });
        const nextVersion = (lastVersion?.version ?? 0) + 1;

        await tx.insert(dashboardVersions).values({
          dashboardId: id,
          orgId,
          version: nextVersion,
          widgets: body.widgets ?? current.widgets,
          theme: body.theme ?? current.theme,
          createdBy: userId,
        });
      });
    });

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    const isConflict = error.message.includes('CONCURRENCY_CONFLICT');
    return NextResponse.json(
      { error: error.message },
      { status: isConflict ? 409 : error.name === 'ForbiddenError' ? 403 : 500 }
    );
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(req.url);
  const orgId = req.headers.get('x-org-id') || url.searchParams.get('orgId');
  const userId = req.headers.get('x-user-id');

  if (!orgId || !userId) {
    return NextResponse.json({ error: 'x-org-id and x-user-id headers required' }, { status: 400 });
  }

  try {
    await requirePermission(userId, orgId, 'dashboard.delete');
    await withOrgContext(orgId, userId, async () => {
      await db.delete(dashboards).where(and(eq(dashboards.id, id), eq(dashboards.orgId, orgId)));
    });

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: error.name === 'ForbiddenError' ? 403 : 500 });
  }
}
