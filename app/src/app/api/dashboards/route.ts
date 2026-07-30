import { NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { withOrgContext } from '@/db/client';
import { dashboards } from '@/db/schema';
import { requireAuth } from '@/lib/auth/request';
import { logRequest } from '@/lib/logger';
import { audit } from '@/lib/audit/log';
import { toUserError, getOrGenerateCorrelationId } from '@/lib/errors/to-user-error';
import { statusFromCode } from '@/lib/errors/types';
import type { ThemeId } from '@/lib/widgets/types';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const ArchetypeVariantSchema = z.object({
  density: z.enum(['spacious', 'balanced', 'dense']).optional(),
  accent: z.enum(['default', 'accent', 'muted']).optional(),
  timeWindow: z
    .enum(['last_24h', 'last_7d', 'last_30d', 'last_quarter', 'last_90d', 'last_6mo', 'last_year', 'all_time'])
    .optional(),
  comparativo: z
    .enum(['none', 'previous_period', 'previous_month', 'previous_quarter', 'previous_year', 'last_year_same_week'])
    .optional(),
});

const CreateDashboardSchema = z.object({
  title: z.string().min(1).max(200),
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
  archetypeVariant: ArchetypeVariantSchema.optional(),
});

function errorResponse(error: unknown, req: Request, fallbackStatus = 500) {
  const correlationId = getOrGenerateCorrelationId(req);
  const appError = toUserError(error, correlationId);
  const status = appError.code === 'internal_server_error' ? fallbackStatus : statusFromCode(appError.code);
  return NextResponse.json(appError, {
    status,
    headers: { 'x-correlation-id': correlationId },
  });
}

export async function GET(req: Request) {
  const { correlationId, logger: reqLogger } = logRequest(req);

  try {
    const ctx = await requireAuth(req, 'dashboard.view');

    const result = await withOrgContext(ctx.orgId, ctx.userId, ctx.role, async (tx) =>
      tx.select().from(dashboards).where(eq(dashboards.orgId, ctx.orgId)).orderBy(desc(dashboards.updatedAt))
    );

    reqLogger.info({ count: result.length }, 'dashboards listed');
    return NextResponse.json(
      { dashboards: result },
      { headers: { 'x-correlation-id': correlationId } },
    );
  } catch (error) {
    reqLogger.error({ err: error }, 'dashboards GET failed');
    return errorResponse(error, req);
  }
}

export async function POST(req: Request) {
  const { correlationId, logger: reqLogger } = logRequest(req);

  try {
    const ctx = await requireAuth(req, 'dashboard.create');

    const body = await req.json();
    const parsed = CreateDashboardSchema.parse(body);

    const inserted = await withOrgContext(ctx.orgId, ctx.userId, ctx.role, async (tx) =>
      tx.insert(dashboards).values({
        orgId: ctx.orgId,
        title: parsed.title,
        description: parsed.description ?? null,
        theme: (parsed.theme as ThemeId) ?? 'moderno-saas',
        widgets: parsed.widgets ?? [],
        archetype: parsed.archetype ?? 'custom',
        archetypeVariantDensity: parsed.archetypeVariant?.density ?? 'balanced',
        archetypeVariantAccent: parsed.archetypeVariant?.accent ?? 'default',
        archetypeVariantTimeWindow: parsed.archetypeVariant?.timeWindow ?? 'last_30d',
        archetypeVariantComparativo: parsed.archetypeVariant?.comparativo ?? 'previous_period',
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      }).returning()
    );

    const created = inserted[0];
    if (!created) {
      throw new Error('Dashboard insert returned no row');
    }

    await audit(ctx.orgId, ctx.userId, 'dashboard.created', `dashboard:${created.id}`, {
      metadata: { title: parsed.title },
      req,
    });
    reqLogger.info({ dashboardId: created.id, title: parsed.title }, 'dashboard created');

    return NextResponse.json(
      { dashboard: created },
      {
        status: 201,
        headers: { 'x-correlation-id': correlationId },
      },
    );
  } catch (error) {
    reqLogger.error({ err: error }, 'dashboards POST failed');
    return errorResponse(error, req);
  }
}