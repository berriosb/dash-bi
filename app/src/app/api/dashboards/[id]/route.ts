import { NextResponse } from 'next/server';
import { eq, and, desc } from 'drizzle-orm';
import { withOrgContext } from '@/db/client';
import { dashboards, dashboardVersions } from '@/db/schema';
import { requireAuth } from '@/lib/auth/request';
import { hydrateDashboard } from '@/lib/query-engine/dashboard';
import { toUserError, getOrGenerateCorrelationId } from '@/lib/errors/to-user-error';
import { statusFromCode } from '@/lib/errors/types';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const UpdateDashboardSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  theme: z.enum(['moderno-saas', 'corporate']).optional(),
  widgets: z.array(z.unknown()).optional(),
  archetype: z
    .enum([
      'kpi-grid',
      'hero-focus',
      'cohort-matrix',
      'sales-pipeline',
      'executive-summary',
      'operations-live',
      'finance-report',
      'growth-metrics',
      'custom',
    ])
    .optional(),
  archetypeVariant: z
    .object({
      density: z.enum(['spacious', 'balanced', 'dense']).optional(),
      accent: z.enum(['default', 'accent', 'muted']).optional(),
      timeWindow: z
        .enum(['last_24h', 'last_7d', 'last_30d', 'last_quarter', 'last_90d', 'last_6mo', 'last_year', 'all_time'])
        .optional(),
      comparativo: z
        .enum(['none', 'previous_period', 'previous_month', 'previous_quarter', 'previous_year', 'last_year_same_week'])
        .optional(),
    })
    .optional(),
  updatedAt: z.string().datetime().optional(),
});

function errorResponse(error: unknown, req: Request) {
  const correlationId = getOrGenerateCorrelationId(req);
  const appError = toUserError(error, correlationId);
  return NextResponse.json(appError, {
    status: statusFromCode(appError.code),
    headers: { 'x-correlation-id': correlationId },
  });
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const ctx = await requireAuth(req, 'dashboard.view');
    const dashboard = await withOrgContext(ctx.orgId, ctx.userId, ctx.role, async (tx) =>
      tx.query.dashboards.findFirst({
        where: and(eq(dashboards.id, id), eq(dashboards.orgId, ctx.orgId)),
      })
    );

    if (!dashboard) {
      return NextResponse.json({ error: 'Dashboard not found' }, { status: 404 });
    }

    const hydratedWidgets = await hydrateDashboard(ctx.orgId, ctx.userId, dashboard.widgets as Parameters<typeof hydrateDashboard>[2]);

    return NextResponse.json({
      dashboard: {
        ...dashboard,
        widgets: hydratedWidgets,
      },
    });
  } catch (error) {
    return errorResponse(error, req);
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const ctx = await requireAuth(req, 'dashboard.edit');
    const body = UpdateDashboardSchema.parse(await req.json());

    await withOrgContext(ctx.orgId, ctx.userId, ctx.role, async (tx) => {
      const current = await tx.query.dashboards.findFirst({
        where: and(eq(dashboards.id, id), eq(dashboards.orgId, ctx.orgId)),
      });

      if (!current) {
        throw Object.assign(new Error('Dashboard not found'), { __code: 'not_found' });
      }

      if (body.updatedAt && current.updatedAt && new Date(body.updatedAt).getTime() < current.updatedAt.getTime()) {
        throw Object.assign(new Error('CONCURRENCY_CONFLICT'), { __code: 'conflict' });
      }

      await tx.update(dashboards)
        .set({
          title: body.title ?? current.title,
          description: body.description ?? current.description,
          theme: body.theme ?? current.theme,
          widgets: body.widgets ?? current.widgets,
          archetype: body.archetype ?? current.archetype,
          archetypeVariantDensity:
            body.archetypeVariant?.density ?? current.archetypeVariantDensity,
          archetypeVariantAccent:
            body.archetypeVariant?.accent ?? current.archetypeVariantAccent,
          archetypeVariantTimeWindow:
            body.archetypeVariant?.timeWindow ?? current.archetypeVariantTimeWindow,
          archetypeVariantComparativo:
            body.archetypeVariant?.comparativo ?? current.archetypeVariantComparativo,
          updatedBy: ctx.userId,
          updatedAt: new Date(),
        })
        .where(and(eq(dashboards.id, id), eq(dashboards.orgId, ctx.orgId)));

      const lastVersion = await tx.query.dashboardVersions.findFirst({
        where: eq(dashboardVersions.dashboardId, id),
        orderBy: desc(dashboardVersions.version),
      });
      const nextVersion = (lastVersion?.version ?? 0) + 1;

      await tx.insert(dashboardVersions).values({
        dashboardId: id,
        orgId: ctx.orgId,
        version: nextVersion,
        widgets: body.widgets ?? current.widgets,
        theme: body.theme ?? current.theme,
        createdBy: ctx.userId,
      });
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error, req);
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const ctx = await requireAuth(req, 'dashboard.delete');
    await withOrgContext(ctx.orgId, ctx.userId, ctx.role, async (tx) =>
      tx.delete(dashboards).where(and(eq(dashboards.id, id), eq(dashboards.orgId, ctx.orgId)))
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error, req);
  }
}