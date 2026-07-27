import { NextResponse } from 'next/server';
import { eq, sql, and, gte, desc } from 'drizzle-orm';
import { db, withOrgContext } from '@/db/client';
import { llmUsage } from '@/db/schema';
import { requirePermission } from '@/lib/auth/context';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const orgId = req.headers.get('x-org-id') || url.searchParams.get('orgId');
  const userId = req.headers.get('x-user-id');
  const daysParam = url.searchParams.get('days');
  const days = Math.min(90, Math.max(1, Number(daysParam) || 30));

  if (!orgId || !userId) {
    return NextResponse.json({ error: 'x-org-id and x-user-id headers required' }, { status: 400 });
  }

  try {
    await requirePermission(userId, orgId, 'org.settings.read');

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [totals] = await withOrgContext(orgId, userId, async () => {
      return db
        .select({
          totalRequests: sql<number>`COUNT(*)::int`,
          successCount: sql<number>`COUNT(*) FILTER (WHERE ${llmUsage.success})::int`,
          totalPromptTokens: sql<number>`COALESCE(SUM(${llmUsage.promptTokens}), 0)::int`,
          totalCompletionTokens: sql<number>`COALESCE(SUM(${llmUsage.completionTokens}), 0)::int`,
          totalCostUsd: sql<string>`COALESCE(SUM(${llmUsage.costUsd}::numeric), 0)::text`,
          avgLatencyMs: sql<number>`COALESCE(AVG(${llmUsage.latencyMs}), 0)::int`,
        })
        .from(llmUsage)
        .where(and(eq(llmUsage.orgId, orgId), gte(llmUsage.createdAt, since)));
    });

    const byProvider = await withOrgContext(orgId, userId, async () => {
      return db
        .select({
          provider: llmUsage.provider,
          model: llmUsage.model,
          count: sql<number>`COUNT(*)::int`,
          totalCostUsd: sql<string>`COALESCE(SUM(${llmUsage.costUsd}::numeric), 0)::text`,
          totalTokens: sql<number>`(COALESCE(SUM(${llmUsage.promptTokens}), 0) + COALESCE(SUM(${llmUsage.completionTokens}), 0))::int`,
        })
        .from(llmUsage)
        .where(and(eq(llmUsage.orgId, orgId), gte(llmUsage.createdAt, since)))
        .groupBy(llmUsage.provider, llmUsage.model)
        .orderBy(desc(sql`COUNT(*)`));
    });

    const byDay = await withOrgContext(orgId, userId, async () => {
      return db
        .select({
          day: sql<string>`to_char(${llmUsage.createdAt}, 'YYYY-MM-DD')`,
          count: sql<number>`COUNT(*)::int`,
          costUsd: sql<string>`COALESCE(SUM(${llmUsage.costUsd}::numeric), 0)::text`,
        })
        .from(llmUsage)
        .where(and(eq(llmUsage.orgId, orgId), gte(llmUsage.createdAt, since)))
        .groupBy(sql`to_char(${llmUsage.createdAt}, 'YYYY-MM-DD')`)
        .orderBy(sql`to_char(${llmUsage.createdAt}, 'YYYY-MM-DD')`);
    });

    return NextResponse.json({
      window: { days, since: since.toISOString() },
      totals: totals ?? {
        totalRequests: 0,
        successCount: 0,
        totalPromptTokens: 0,
        totalCompletionTokens: 0,
        totalCostUsd: '0',
        avgLatencyMs: 0,
      },
      byProvider,
      byDay,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal error';
    const status = error instanceof Error && error.name === 'ForbiddenError' ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}