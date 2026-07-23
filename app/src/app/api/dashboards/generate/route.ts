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
import type { ThemeId } from '@/lib/widgets/types';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const url = new URL(req.url);
  const orgId = req.headers.get('x-org-id') || url.searchParams.get('orgId');
  const userId = req.headers.get('x-user-id');

  if (!orgId || !userId) {
    return NextResponse.json({ error: 'x-org-id and x-user-id headers required' }, { status: 400 });
  }

  try {
    await requirePermission(userId, orgId, 'dashboard.create');
    const { prompt, dataSourceId } = await req.json();

    if (!prompt || !dataSourceId) {
      return NextResponse.json({ error: 'prompt and dataSourceId are required' }, { status: 400 });
    }

    // 1. Resolve connector and get schema (pruned if >20 tables)
    const connector = await resolveConnector(orgId, userId, dataSourceId);
    const rawSchema = await connector.getSchema();
    const prunedSchema = pruneSchemaForPrompt(rawSchema, prompt);

    // 2. Generate dashboard definition via AI Gateway
    const gateway = new AiGateway();
    const dsType = (connector.type === 'stripe' || connector.type === 'sheets' ? connector.type : 'postgres') as 'postgres' | 'stripe' | 'sheets';
    const generated = await gateway.generateDashboard({
      prompt,
      schemaInfo: JSON.stringify(prunedSchema, null, 2),
      dataSourceId,
      dataSourceType: dsType,
    });

    // 3. Hydrate widgets with real query engine execution
    const hydratedWidgets = await hydrateDashboard(orgId, userId, generated.widgets);

    // 4. Save dashboard into DB
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

    // 5. Track audit log
    await withOrgContext(orgId, userId, async () => {
      await db.insert(auditLog).values({
        orgId,
        userId,
        action: 'dashboard.generated',
        resource: `dashboard:${saved.id}`,
        metadata: { promptLength: prompt.length, archetype: generated.archetype },
      });
    });

    return NextResponse.json({
      dashboard: {
        ...saved,
        widgets: hydratedWidgets,
        archetype: generated.archetype,
        archetypeVariant: generated.archetypeVariant,
      },
    }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: error.name === 'ForbiddenError' ? 403 : 500 });
  }
}
