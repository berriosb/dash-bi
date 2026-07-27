import { NextResponse } from 'next/server';
import { eq, and } from 'drizzle-orm';
import { db } from '@/db/client';
import { dataSources, dashboards, llmUsage, auditLog } from '@/db/schema';
import { withOrgContext } from '@/db/client';
import { requirePermission } from '@/lib/auth/context';
import { resolveConnector } from '@/lib/query-engine/resolve';
import { hydrateDashboard } from '@/lib/query-engine/dashboard';
import { pruneSchemaForPrompt } from '@/lib/connectors/types';
import { AiGateway } from '@/lib/ai/gateway';
import { checkRateLimit } from '@/lib/rate-limit';
import { audit } from '@/lib/audit/log';
import type { ThemeId, Dashboard, Widget } from '@/lib/widgets/types';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

// T9: AI generation is the most expensive operation. Limit per org to
// prevent runaway costs and per IP to prevent abuse across orgs.
const AI_GENERATE_PER_ORG = { capacity: 5, refillPerSecond: 5 / 60 }; // 5 burst, 1/min sustained
const AI_GENERATE_PER_IP = { capacity: 20, refillPerSecond: 20 / 60 }; // 20 burst, 1/3s sustained

const GenerateBodySchema = z.object({
  prompt: z.string().min(1).max(500),
  dataSourceId: z.string().min(1),
  /**
   * Sprint 3 — edit iterativo. Si se pasa, modificamos el dashboard
   * existente en lugar de crear uno nuevo.
   */
  dashboardId: z.string().uuid().optional(),
});

function getClientIp(req: Request): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const orgId = req.headers.get('x-org-id') || url.searchParams.get('orgId');
  const userId = req.headers.get('x-user-id');
  const ip = getClientIp(req);

  if (!orgId || !userId) {
    return NextResponse.json({ error: 'x-org-id and x-user-id headers required' }, { status: 400 });
  }

  // Rate limit BEFORE auth — cheapest gate first.
  const orgLimit = checkRateLimit({ ...AI_GENERATE_PER_ORG, key: `ai-generate:org:${orgId}` });
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

  try {
    const rawBody = await req.json();
    const parsed = GenerateBodySchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'validation.invalid_format', issues: parsed.error.issues },
        { status: 400 },
      );
    }
    const { prompt, dataSourceId, dashboardId } = parsed.data;

    // Edit mode requires dashboard.edit, create mode requires dashboard.create
    const permission = dashboardId ? 'dashboard.edit' : 'dashboard.create';
    await requirePermission(userId, orgId, permission);

    // 1. Resolve connector and get schema (pruned if >20 tables)
    const connector = await resolveConnector(orgId, userId, dataSourceId);
    const rawSchema = await connector.getSchema();
    const prunedSchema = pruneSchemaForPrompt(rawSchema, prompt);

    // 2. Get org LLM config
    const dsType = (connector.type === 'stripe' || connector.type === 'sheets' ? connector.type : 'postgres') as 'postgres' | 'stripe' | 'sheets';
    const gateway = new AiGateway();

    let responsePayload: {
      dashboard: Dashboard & { id?: string };
      action: 'created' | 'modified';
      reasoning?: string;
    };

    if (dashboardId) {
      // ─── Edit iterativo ─────────────────────────────────────
      // Load existing dashboard + run edit agent
      const existing = await withOrgContext(orgId, userId, async () => {
        return db.query.dashboards.findFirst({
          where: and(eq(dashboards.id, dashboardId), eq(dashboards.orgId, orgId)),
        });
      });
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
    let updatedTitle = existing.title;
    void updatedTitle; // not used yet (we keep title unless prompt asks)

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

      // Hydrate any new/modified widgets (touch only those whose data is null)
      const toHydrate = newWidgets.filter(
        (w) => !w.data || (Array.isArray(w.data) && w.data.length === 0),
      );
      let finalWidgets = newWidgets;
      if (toHydrate.length > 0) {
        const hydrated = await hydrateDashboard(orgId, userId, toHydrate);
        const byId = new Map(hydrated.map((h) => [h.id, h]));
        finalWidgets = newWidgets.map((w) => byId.get(w.id) ?? w);
      }

      const [saved] = await withOrgContext(orgId, userId, async () => {
        return db
          .update(dashboards)
          .set({
            widgets: finalWidgets,
            updatedBy: userId,
            updatedAt: new Date(),
          })
          .where(and(eq(dashboards.id, dashboardId), eq(dashboards.orgId, orgId)))
          .returning();
      });

      await audit(orgId, userId, 'dashboard.updated', `dashboard:${dashboardId}`, {
        metadata: {
          action: 'ai_edit',
          editAction: editResult.action,
          reasoning: editResult.reasoning,
        },
      });

      responsePayload = {
        dashboard: { ...saved, widgets: finalWidgets } as Dashboard & { id?: string },
        action: 'modified',
        reasoning: editResult.reasoning,
      };
      void updatedTitle; // silence
    } else {
      // ─── Create nuevo dashboard ─────────────────────────────
      const generated = await gateway.generateDashboard({
        prompt,
        schemaInfo: JSON.stringify(prunedSchema, null, 2),
        dataSourceId,
        dataSourceType: dsType,
      });

      const hydratedWidgets = await hydrateDashboard(orgId, userId, generated.widgets);

      const [saved] = await withOrgContext(orgId, userId, async () => {
        return db.insert(dashboards).values({
          orgId,
          title: generated.title,
          description: generated.description || null,
          theme: (generated.theme as ThemeId) || 'moderno-saas',
          widgets: hydratedWidgets,
          createdBy: userId,
          updatedBy: userId,
        }).returning();
      });

      if (!saved) {
        return NextResponse.json({ error: 'Failed to save generated dashboard' }, { status: 500 });
      }

      await audit(orgId, userId, 'dashboard.generated', `dashboard:${saved.id}`, {
        metadata: { promptLength: prompt.length, archetype: generated.archetype },
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

    return NextResponse.json(responsePayload, { status: dashboardId ? 200 : 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: error.name === 'ForbiddenError' ? 403 : 500 });
  }
}
