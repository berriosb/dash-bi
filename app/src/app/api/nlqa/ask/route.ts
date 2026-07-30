import { NextResponse } from 'next/server';
import { z } from 'zod';
import { eq, desc, asc } from 'drizzle-orm';
import { withOrgContext } from '@/db/client';
import { nlqaConversations, nlqaMessages, orgs } from '@/db/schema';
import { requireAuth } from '@/lib/auth/request';
import { resolveConnector } from '@/lib/query-engine/resolve';
import { executeWithTimeout } from '@/lib/query-engine/execute';
import { AiGateway, type NLQAHistoryTurn } from '@/lib/ai/gateway';
import { validateQuery } from '@/lib/security/validate-query';
import { audit } from '@/lib/audit/log';
import { checkRateLimit } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { toUserError, getOrGenerateCorrelationId } from '@/lib/errors/to-user-error';
import { statusFromCode } from '@/lib/errors/types';

export const dynamic = 'force-dynamic';

const AskBodySchema = z.object({
  conversationId: z.string().uuid().optional(),
  dataSourceId: z.string().uuid(),
  question: z.string().min(1).max(500),
});

const MAX_HISTORY_TURNS = 6;

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
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';

    const nlqaLimit = checkRateLimit({
      capacity: 30,
      refillPerSecond: 0.5,
      key: `nlqa-ask:org:${ctx.orgId}:ip:${ip}`,
    });
    if (!nlqaLimit.allowed) {
      return NextResponse.json(
        { error: 'rate_limited', retryAfterSeconds: nlqaLimit.retryAfterSeconds },
        { status: 429, headers: { 'Retry-After': String(nlqaLimit.retryAfterSeconds) } },
      );
    }

    const rawBody = await req.json();
    const parsed = AskBodySchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'validation.invalid_format', issues: parsed.error.issues },
        { status: 400 },
      );
    }

    const { conversationId, dataSourceId, question } = parsed.data;

    const connector = await resolveConnector(ctx.orgId, ctx.userId, dataSourceId, ctx.role);
    const dataSourceType = connector.type as 'postgres' | 'stripe' | 'sheets';
    const rawSchema = await connector.getSchema();

    let activeConversationId = conversationId;
    if (!activeConversationId) {
      const [created] = await withOrgContext(ctx.orgId, ctx.userId, ctx.role, async (tx) =>
        tx.insert(nlqaConversations)
          .values({
            orgId: ctx.orgId,
            userId: ctx.userId,
            dataSourceId,
            title: question.slice(0, 80),
          })
          .returning({ id: nlqaConversations.id })
      );
      if (!created) {
        return NextResponse.json({ error: 'Failed to create conversation' }, { status: 500 });
      }
      activeConversationId = created.id;
    } else {
      const [conv] = await withOrgContext(ctx.orgId, ctx.userId, ctx.role, async (tx) =>
        tx.select({ id: nlqaConversations.id })
          .from(nlqaConversations)
          .where(eq(nlqaConversations.id, activeConversationId!))
      );
      if (!conv) {
        return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
      }
    }

    const historyRows = await withOrgContext(ctx.orgId, ctx.userId, ctx.role, async (tx) =>
      tx.select({
        role: nlqaMessages.role,
        content: nlqaMessages.content,
        generatedSql: nlqaMessages.generatedSql,
      })
      .from(nlqaMessages)
      .where(eq(nlqaMessages.conversationId, activeConversationId!))
      .orderBy(desc(nlqaMessages.createdAt))
      .limit(MAX_HISTORY_TURNS)
    );

    const history: NLQAHistoryTurn[] = historyRows.reverse().map((row) => ({
      role: row.role === 'user' ? 'user' : 'assistant',
      content: row.content,
      sql: row.generatedSql,
    }));

    const [userMessage] = await withOrgContext(ctx.orgId, ctx.userId, ctx.role, async (tx) =>
      tx.insert(nlqaMessages)
        .values({
          orgId: ctx.orgId,
          conversationId: activeConversationId!,
          role: 'user',
          content: question,
        })
        .returning({ id: nlqaMessages.id })
    );
    if (!userMessage) {
      return NextResponse.json({ error: 'Failed to persist message' }, { status: 500 });
    }

    await audit(ctx.orgId, ctx.userId, 'nlqa.question_asked', `conversation:${activeConversationId}`, {
      metadata: { questionLength: question.length },
      req,
    });

    const [orgConfig] = await withOrgContext(ctx.orgId, ctx.userId, ctx.role, async (tx) =>
      tx.select({
        llmProvider: orgs.llmProvider,
        llmModel: orgs.llmModel,
        llmApiKeyEncrypted: orgs.llmApiKeyEncrypted,
      })
      .from(orgs)
      .where(eq(orgs.id, ctx.orgId))
    );

    const provider = (orgConfig?.llmProvider ?? 'openai') as 'openai' | 'anthropic' | 'gemini';
    const modelName = orgConfig?.llmModel ?? 'gpt-4o';
    const apiKeyEncrypted = orgConfig?.llmApiKeyEncrypted ?? undefined;
    const gateway = new AiGateway(provider, modelName, apiKeyEncrypted ?? undefined);

    const sqlResult = await gateway.generateNLQASql({
      question,
      schemaInfo: JSON.stringify(rawSchema, null, 2),
      dataSourceType,
      history,
    });

    if (!sqlResult.sql) {
      const fallback = sqlResult.fallbackAnswer ?? 'No puedo responder esa pregunta con los datos disponibles.';
      const [assistantMsg] = await withOrgContext(ctx.orgId, ctx.userId, ctx.role, async (tx) =>
        tx.insert(nlqaMessages)
          .values({
            orgId: ctx.orgId,
            conversationId: activeConversationId!,
            role: 'assistant',
            content: fallback,
          })
          .returning({ id: nlqaMessages.id })
      );

      await audit(ctx.orgId, ctx.userId, 'nlqa.answer_generated', `message:${assistantMsg?.id ?? 'unknown'}`, {
        metadata: { hadSql: false, reasoning: sqlResult.reasoning ?? '' },
        req,
      });

      return NextResponse.json({
        conversationId: activeConversationId,
        message: {
          id: assistantMsg?.id,
          role: 'assistant',
          content: fallback,
          chartSuggestion: null,
          generatedSql: null,
        },
      });
    }

    try {
      validateQuery({ kind: 'sql', sql: sqlResult.sql }, dataSourceType);
    } catch (err) {
      logger.warn({ sql: sqlResult.sql, error: err }, 'NLQA SQL failed validation');
      const message = 'La IA generó una query inválida. Reformulá tu pregunta.';
      await withOrgContext(ctx.orgId, ctx.userId, ctx.role, async (tx) =>
        tx.insert(nlqaMessages).values({
          orgId: ctx.orgId,
          conversationId: activeConversationId!,
          role: 'assistant',
          content: message,
        })
      );
      return NextResponse.json({ error: 'sql_validation_failed', message }, { status: 422 });
    }

    const execStart = Date.now();
    let result;
    try {
      result = await executeWithTimeout(
        connector,
        dataSourceId,
        { kind: 'sql', sql: sqlResult.sql, params: sqlResult.params as never },
        { timeoutMs: 30000, retries: 0 },
      );
    } catch (execErr) {
      const message = execErr instanceof Error ? execErr.message : 'Error ejecutando la query';
      return NextResponse.json({ error: 'query_execution_failed', message }, { status: 500 });
    }
    const execMs = Date.now() - execStart;

    const answerResult = await gateway.generateNLQAAnswer({
      question,
      sql: sqlResult.sql,
      result: { rows: result.rows, rowCount: result.rowCount },
      history,
    });

    const [assistantMsg] = await withOrgContext(ctx.orgId, ctx.userId, ctx.role, async (tx) =>
      tx.insert(nlqaMessages)
        .values({
          orgId: ctx.orgId,
          conversationId: activeConversationId!,
          role: 'assistant',
          content: answerResult.answer,
          generatedSql: sqlResult.sql,
          generatedChartType: answerResult.chartSuggestion?.type ?? null,
          generatedChartConfig: answerResult.chartSuggestion?.config ?? null,
          rowCount: result.rowCount,
          executionMs: execMs,
        })
        .returning({ id: nlqaMessages.id })
    );

    await audit(ctx.orgId, ctx.userId, 'nlqa.answer_generated', `message:${assistantMsg?.id ?? 'unknown'}`, {
      metadata: {
        hadSql: true,
        rowCount: result.rowCount,
        executionMs: execMs,
        chartType: answerResult.chartSuggestion?.type ?? null,
      },
      req,
    });

    return NextResponse.json({
      conversationId: activeConversationId,
      message: {
        id: assistantMsg?.id,
        role: 'assistant',
        content: answerResult.answer,
        chartSuggestion: answerResult.chartSuggestion,
        generatedSql: sqlResult.sql,
        rowCount: result.rowCount,
        executionMs: execMs,
        reasoning: sqlResult.reasoning,
      },
    });
  } catch (error) {
    return errorResponse(error, req);
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const conversationId = url.searchParams.get('conversationId');

  try {
    const ctx = await requireAuth(req, 'query.execute');
    if (!conversationId) {
      return NextResponse.json({ error: 'conversationId required' }, { status: 400 });
    }

    const messages = await withOrgContext(ctx.orgId, ctx.userId, ctx.role, async (tx) =>
      tx.select()
        .from(nlqaMessages)
        .where(eq(nlqaMessages.conversationId, conversationId))
        .orderBy(asc(nlqaMessages.createdAt))
    );

    return NextResponse.json({ conversationId, messages });
  } catch (error) {
    return errorResponse(error, req);
  }
}