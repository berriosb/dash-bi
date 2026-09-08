import { NextResponse } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { withOrgContext } from '@/db/client';
import { orgs, llmUsage } from '@/db/schema';
import { requireAuth } from '@/lib/auth/request';
import { AiGateway } from '@/lib/ai/gateway';
import { calculateCostUsd, type LLMProvider } from '@/lib/ai/types';
import { checkRateLimit } from '@/lib/rate-limit';
import { audit } from '@/lib/audit/log';
import { toUserError, getOrGenerateCorrelationId } from '@/lib/errors/to-user-error';
import { statusFromCode } from '@/lib/errors/types';

export const dynamic = 'force-dynamic';

const ExplainBodySchema = z.object({
  widgetTitle: z.string().min(1).max(120),
  widgetType: z.string().min(1).max(40),
  data: z.unknown(),
  context: z
    .object({
      dashboardTitle: z.string().max(200).optional(),
      timeWindow: z.string().max(80).optional(),
      comparativo: z.string().max(80).optional(),
    })
    .optional(),
  dataSourceId: z.string().optional(),
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
  try {
    const ctx = await requireAuth(req, 'query.execute');
    const ip = getClientIp(req);

    const rateLimit = checkRateLimit({
      capacity: 30,
      refillPerSecond: 0.5,
      key: `widget-explain:org:${ctx.orgId}:ip:${ip}`,
    });
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'rate_limited', retryAfterSeconds: rateLimit.retryAfterSeconds },
        { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
      );
    }

    const rawBody = await req.json();
    const parsed = ExplainBodySchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'validation.invalid_format', issues: parsed.error.issues },
        { status: 400 },
      );
    }

    const { widgetTitle, widgetType, data, context } = parsed.data;

    const [orgConfig] = await withOrgContext(ctx.orgId, ctx.userId, ctx.role, async (tx) =>
      tx
        .select({
          llmProvider: orgs.llmProvider,
          llmModel: orgs.llmModel,
          llmApiKeyEncrypted: orgs.llmApiKeyEncrypted,
        })
        .from(orgs)
        .where(eq(orgs.id, ctx.orgId)),
    );

    const provider = (orgConfig?.llmProvider ?? 'openai') as LLMProvider;
    const modelName = orgConfig?.llmModel ?? 'gpt-4o';
    const apiKeyEncrypted = orgConfig?.llmApiKeyEncrypted ?? undefined;

    const gateway = new AiGateway(provider, modelName, apiKeyEncrypted);

    const startTime = Date.now();
    const explanation = await gateway.explainWidgetData({
      widgetTitle,
      widgetType,
      data,
      context,
    });
    const latencyMs = Date.now() - startTime;

    if (explanation.usage) {
      const promptTokens = explanation.usage.promptTokens;
      const completionTokens = explanation.usage.completionTokens;
      const costUsd = calculateCostUsd(modelName, promptTokens, completionTokens);

      await withOrgContext(ctx.orgId, ctx.userId, ctx.role, async (tx) =>
        tx.insert(llmUsage).values({
          orgId: ctx.orgId,
          userId: ctx.userId,
          provider,
          model: modelName,
          promptTokens,
          completionTokens,
          costUsd,
          latencyMs,
          success: true,
        }),
      );
    }

    await audit(ctx.orgId, ctx.userId, 'nlqa.widget_explained', `widget:${widgetTitle}`, {
      metadata: {
        widgetTitle,
        widgetType,
        trend: explanation.trend,
        keyDriversCount: explanation.keyDrivers.length,
      },
      req,
    });

    return NextResponse.json({
      headline: explanation.headline,
      summary: explanation.summary,
      trend: explanation.trend,
      keyDrivers: explanation.keyDrivers,
      suggestedAction: explanation.suggestedAction,
    });
  } catch (error) {
    return errorResponse(error, req);
  }
}
