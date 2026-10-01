import { NextResponse } from 'next/server';
import { errorResponse } from '@/lib/errors/response';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { withOrgContext } from '@/db/client';
import { orgs } from '@/db/schema';
import { requireAuth } from '@/lib/auth/request';
import { AiGateway } from '@/lib/ai/gateway';
import { type LLMProvider } from '@/lib/ai/types';
import { recordLLMUsage, assertOrgCanSpendLlm } from '@/lib/ai/quota';
import { checkRateLimit } from '@/lib/rate-limit';
import { audit } from '@/lib/audit/log';

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
          plan: orgs.plan,
        })
        .from(orgs)
        .where(eq(orgs.id, ctx.orgId)),
    );

    const provider = (orgConfig?.llmProvider ?? 'openai') as LLMProvider;
    const modelName = orgConfig?.llmModel ?? 'gpt-4o';
    const apiKeyEncrypted = orgConfig?.llmApiKeyEncrypted ?? undefined;

    await assertOrgCanSpendLlm(ctx.orgId, ctx.userId, orgConfig?.plan ?? 'free');

    const gateway = new AiGateway(provider, modelName, apiKeyEncrypted);

    const startTime = Date.now();
    const explanation = await gateway.explainWidgetData({
      widgetTitle,
      widgetType,
      data,
      context,
    });
    const latencyMs = Date.now() - startTime;

    await recordLLMUsage({
      orgId: ctx.orgId,
      userId: ctx.userId,
      provider,
      model: modelName,
      usage: explanation.usage,
      latencyMs,
    });

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
