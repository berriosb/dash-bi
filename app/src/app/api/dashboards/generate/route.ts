import { NextResponse } from 'next/server';
import { eq, and } from 'drizzle-orm';
import { withOrgContext } from '@/db/client';
import { dashboards } from '@/db/schema';
import { requireAuth } from '@/lib/auth/request';
import { resolveConnector } from '@/lib/query-engine/resolve';
import { hydrateDashboard } from '@/lib/query-engine/dashboard';
import { pruneSchemaForPrompt } from '@/lib/connectors/types';
import { AiGateway } from '@/lib/ai/gateway';
import { checkRateLimit } from '@/lib/rate-limit';
import { audit } from '@/lib/audit/log';
import { toUserError, getOrGenerateCorrelationId } from '@/lib/errors/to-user-error';
import { statusFromCode } from '@/lib/errors/types';
import type { ThemeId, Dashboard, Widget } from '@/lib/widgets/types';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const AI_GENERATE_PER_ORG = { capacity: 5, refillPerSecond: 5 / 60 };
const AI_GENERATE_PER_IP = { capacity: 20, refillPerSecond: 20 / 60 };

const GenerateBodySchema = z.object({
  prompt: z.string().min(1).max(500),
  dataSourceId: z.string().min(1),
  dashboardId: z.string().uuid().optional(),
});

function getClientIp(req: Request): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

function errorResponse(error: unknown, req: Request) {
  const correlationId = getOrGenerateCorrelationId(req);
  const appError = toUserError(error, correlationId);
  return NextResponse.json(appError, {
    status: statusFromCode(appError.code),
    headers: { 'x-correlation-id': correlationId },
  });
}

export async function POST(req: Request) {
  const correlationId = getOrGenerateCorrelationId(req);
  const ip = getClientIp(req);

  try {
    const ctx = await requireAuth(req, 'dashboard.create');

    const orgLimit = checkRateLimit({ ...AI_GENERATE_PER_ORG, key: `ai-generate:org:${ctx.orgId}` });
    if (!orgLimit.allowed) {
      return NextResponse.json(
        { error: 'rate_limited', scope: 'org', retryAfterSeconds: orgLimit.retryAfterSeconds },
        { status: 429, headers: { 'Retry-After': String(orgLimit.retryAfterSeconds) } },
      );
    }

    const ipLimit = checkRateLimit({ ...AI_GENERATE_PER_IP, key: `ai-generate:ip:${ip}` });
    if (!ipLimit.allowed) {
      return NextResponse.json(
        { error: 'rate_limited', scope: 'ip', retryAfterSeconds: ipLimit.retryAfterSeconds },
        { status: 429, headers: { 'Retry-After': String(ipLimit.retryAfterSeconds) } },
      );
    }

    const rawBody = await req.json();
    const parsed = GenerateBodySchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'validation.invalid_format', issues: parsed.error.issues },
        { status: 400, headers: { 'x-correlation-id': correlationId } },
      );
    }
    const { prompt, dataSourceId, dashboardId } = parsed.data;

    if (dashboardId) {
      // Edit mode requires dashboard.edit; we'll re-check permission below
      // to avoid trusting client-controlled dashboardId for permission scoping.
      await requireAuth(req, 'dashboard.edit');
    }

    const connector = await resolveConnector(ctx.orgId, ctx.userId, dataSourceId, ctx.role);
    const rawSchema = await connector.getSchema();
    const prunedSchema = pruneSchemaForPrompt(rawSchema, prompt);
    const dsType = (connector.type === 'stripe' || connector.type === 'sheets' ? connector.type : 'postgres') as 'postgres' | 'stripe' | 'sheets';
    const gateway = new AiGateway();

    let responsePayload: {
      dashboard: Dashboard & { id?: string };
      action: 'created' | 'modified';
      reasoning?: string;
    };

    if (dashboardId) {
      const existing = await withOrgContext(ctx.orgId, ctx.userId, ctx.role, async (tx) =>
        tx.query.dashboards.findFirst({
          where: and(eq(dashboards.id, dashboardId), eq(dashboards.orgId, ctx.orgId)),
        })
      );
      if (!existing) {
        return NextResponse.json({ error: 'Dashboard not found' }, { status: 404 });
      }

      const editResult = await gateway.generateNLQAEdit({
        prompt,
        existingDashboard: {
          title: existing.title,
          description: existing.description ?? undefined,
          widgets: (existing.widgets as Widget[]) ?? [],
        },
        schemaInfo: JSON.stringify(prunedSchema, null, 2),
        dataSourceType: dsType,
      });

      let newWidgets = (existing.widgets as Widget[]) ?? [];

      if (editResult.action === 'add' && editResult.widgets && editResult.widgets.length > 0) {
        const newOnes = (editResult.widgets as unknown as Widget[]).map((w) => ({
          ...w,
          id: w.id ?? `w_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        }));
        newWidgets = [...newWidgets, ...newOnes];
      } else if (editResult.action === 'modify' && editResult.modifyWidgetId && editResult.widgets) {
        newWidgets = newWidgets.map((w) => {
          const replacement = (editResult.widgets as unknown as Widget[]).find(
            (r) => r.id === editResult.modifyWidgetId,
          );
          return replacement ?? w;
        });
      } else if (editResult.action === 'remove' && editResult.modifyWidgetId) {
        newWidgets = newWidgets.filter((w) => w.id !== editResult.modifyWidgetId);
      }

      const toHydrate = newWidgets.filter(
        (w) => !w.data || (Array.isArray(w.data) && w.data.length === 0),
      );
      let finalWidgets = newWidgets;
      if (toHydrate.length > 0) {
        const hydrated = await hydrateDashboard(ctx.orgId, ctx.userId, toHydrate);
        const byId = new Map(hydrated.map((h) => [h.id, h]));
        finalWidgets = newWidgets.map((w) => byId.get(w.id) ?? w);
      }

      const [saved] = await withOrgContext(ctx.orgId, ctx.userId, ctx.role, async (tx) =>
        tx.update(dashboards)
          .set({
            widgets: finalWidgets,
            updatedBy: ctx.userId,
            updatedAt: new Date(),
          })
          .where(and(eq(dashboards.id, dashboardId), eq(dashboards.orgId, ctx.orgId)))
          .returning()
      );

      await audit(ctx.orgId, ctx.userId, 'dashboard.updated', `dashboard:${dashboardId}`, {
        metadata: {
          action: 'ai_edit',
          editAction: editResult.action,
          reasoning: editResult.reasoning,
        },
        req,
      });

      responsePayload = {
        dashboard: { ...(saved as Dashboard & { id?: string }), widgets: finalWidgets },
        action: 'modified',
        reasoning: editResult.reasoning,
      };
    } else {
      const generated = await gateway.generateDashboard({
        prompt,
        schemaInfo: JSON.stringify(prunedSchema, null, 2),
        dataSourceId,
        dataSourceType: dsType,
      });

      const hydratedWidgets = await hydrateDashboard(ctx.orgId, ctx.userId, generated.widgets);

      const [saved] = await withOrgContext(ctx.orgId, ctx.userId, ctx.role, async (tx) =>
        tx.insert(dashboards).values({
          orgId: ctx.orgId,
          title: generated.title,
          description: generated.description || null,
          theme: (generated.theme as ThemeId) || 'moderno-saas',
          widgets: hydratedWidgets,
          archetype: generated.archetype ?? 'custom',
          archetypeVariantDensity: generated.archetypeVariant?.density ?? 'balanced',
          archetypeVariantAccent: generated.archetypeVariant?.accent ?? 'default',
          archetypeVariantTimeWindow: generated.archetypeVariant?.timeWindow ?? 'last_30d',
          archetypeVariantComparativo: generated.archetypeVariant?.comparativo ?? 'previous_period',
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
        }).returning()
      );

      if (!saved) {
        return NextResponse.json({ error: 'Failed to save generated dashboard' }, { status: 500 });
      }

      await audit(ctx.orgId, ctx.userId, 'dashboard.generated', `dashboard:${saved.id}`, {
        metadata: { promptLength: prompt.length, archetype: generated.archetype },
        req,
      });

      responsePayload = {
        dashboard: {
          ...saved,
          description: saved.description ?? undefined,
          widgets: hydratedWidgets,
          archetype: generated.archetype,
          archetypeVariant: generated.archetypeVariant,
        },
        action: 'created',
      };
    }

    return NextResponse.json(responsePayload, {
      status: dashboardId ? 200 : 201,
      headers: { 'x-correlation-id': correlationId },
    });
  } catch (error) {
    return errorResponse(error, req);
  }
}