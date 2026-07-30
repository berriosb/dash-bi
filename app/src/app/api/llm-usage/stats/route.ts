import { NextResponse } from 'next/server';
import { eq, sql, and, gte, desc } from 'drizzle-orm';
import { withOrgContext } from '@/db/client';
import { llmUsage } from '@/db/schema';
import { requireAuth } from '@/lib/auth/request';
import { toUserError, getOrGenerateCorrelationId } from '@/lib/errors/to-user-error';
import { statusFromCode } from '@/lib/errors/types';

export const dynamic = 'force-dynamic';

function errorResponse(error: unknown, req: Request) {
  const correlationId = getOrGenerateCorrelationId(req);
  const appError = toUserError(error, correlationId);
  return NextResponse.json(appError, {
    status: statusFromCode(appError.code),
    headers: { 'x-correlation-id': correlationId },
  });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const daysParam = url.searchParams.get('days');
  const days = Math.min(90, Math.max(1, Number(daysParam) || 30));

  try {
    const ctx = await requireAuth(req, 'dashboard.view');

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [totals] = await withOrgContext(ctx.orgId, ctx.userId, ctx.role, async (tx) =>
      tx
        .select({
          totalRequests: sql<number>`COUNT(*)::int`,
          successCount: sql<number>`COUNT(*) FILTER (WHERE ${llmUsage.success})::int`,
          totalPromptTokens: sql<number>`COALESCE(SUM(${llmUsage.promptTokens}), 0)::int`,
          totalCompletionTokens: sql<number>`COALESCE(SUM(${llmUsage.completionTokens}), 0)::int`,
          totalCostUsd: sql<string>`COALESCE(SUM(${llmUsage.costUsd}::numeric), 0)::text`,
          avgLatencyMs: sql<number>`COALESCE(AVG(${llmUsage.latencyMs}), 0)::int`,
        })
        .from(llmUsage)
        .where(and(eq(llmUsage.orgId, ctx.orgId), gte(llmUsage.createdAt, since)))
    );

    const byProvider = await withOrgContext(ctx.orgId, ctx.userId, ctx.role, async (tx) =>
      tx
        .select({
          provider: llmUsage.provider,
          model: llmUsage.model,
          count: sql<number>`COUNT(*)::int`,
          totalCostUsd: sql<string>`COALESCE(SUM(${llmUsage.costUsd}::numeric), 0)::text`,
          totalTokens: sql<number>`(COALESCE(SUM(${llmUsage.promptTokens}), 0) + COALESCE(SUM(${llmUsage.completionTokens}), 0))::int`,
        })
        .from(llmUsage)
        .where(and(eq(llmUsage.orgId, ctx.orgId), gte(llmUsage.createdAt, since)))
        .groupBy(llmUsage.provider, llmUsage.model)
        .orderBy(desc(sql`COUNT(*)`))
    );

    const byDay = await withOrgContext(ctx.orgId, ctx.userId, ctx.role, async (tx) =>
      tx
        .select({
          day: sql<string>`to_char(${llmUsage.createdAt}, 'YYYY-MM-DD')`,
          count: sql<number>`COUNT(*)::int`,
          costUsd: sql<string>`COALESCE(SUM(${llmUsage.costUsd}::numeric), 0)::text`,
        })
        .from(llmUsage)
        .where(and(eq(llmUsage.orgId, ctx.orgId), gte(llmUsage.createdAt, since)))
        .groupBy(sql`to_char(${llmUsage.createdAt}, 'YYYY-MM-DD')`)
        .orderBy(sql`to_char(${llmUsage.createdAt}, 'YYYY-MM-DD')`)
    );

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
  } catch (error) {
    return errorResponse(error, req);
  }
}