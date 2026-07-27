import { NextResponse } from 'next/server';
import { z } from 'zod';
import { eq, desc, asc } from 'drizzle-orm';
import { db, withOrgContext } from '@/db/client';
import { nlqaConversations, nlqaMessages, orgs } from '@/db/schema';
import { requirePermission } from '@/lib/auth/context';
import { resolveConnector } from '@/lib/query-engine/resolve';
import { executeWithTimeout } from '@/lib/query-engine/execute';
import { AiGateway, type NLQAHistoryTurn } from '@/lib/ai/gateway';
import { validateQuery } from '@/lib/security/validate-query';
import { audit } from '@/lib/audit/log';
import { checkRateLimit } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const AskBodySchema = z.object({
  conversationId: z.string().uuid().optional(),
  dataSourceId: z.string().uuid(),
  question: z.string().min(1).max(500),
});

const MAX_HISTORY_TURNS = 6; // 3 user + 3 assistant

export async function POST(req: Request) {
  const url = new URL(req.url);
  const orgId = req.headers.get('x-org-id') || url.searchParams.get('orgId');
  const userId = req.headers.get('x-user-id');
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';

  if (!orgId || !userId) {
    return NextResponse.json({ error: 'x-org-id and x-user-id headers required' }, { status: 400 });
  }

  // T9: rate limit NLQA — puede ser caro (2 LLM calls por turno)
  const nlqaLimit = checkRateLimit({
    capacity: 30,
    refillPerSecond: 0.5,
    key: `nlqa-ask:org:${orgId}:ip:${ip}`,
  });
  if (!nlqaLimit.allowed) {
    return NextResponse.json(
      { error: 'rate_limited', retryAfterSeconds: nlqaLimit.retryAfterSeconds },
      { status: 429, headers: { 'Retry-After': String(nlqaLimit.retryAfterSeconds) } },
    );
  }

  try {
    await requirePermission(userId, orgId, 'query.execute');

    const rawBody = await req.json();
    const parsed = AskBodySchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'validation.invalid_format', issues: parsed.error.issues },
        { status: 400 },
      );
    }

    const { conversationId, dataSourceId, question } = parsed.data;

    // 1. Resolve data source + schema
    const connector = await resolveConnector(orgId, userId, dataSourceId);
    const dataSourceType = connector.type as 'postgres' | 'stripe' | 'sheets';
    const rawSchema = await connector.getSchema();

    // 2. Get or create conversation
    let activeConversationId = conversationId;
    if (!activeConversationId) {
      const [created] = await withOrgContext(orgId, userId, async () => {
        return db
          .insert(nlqaConversations)
          .values({
            orgId,
            userId,
            dataSourceId,
            title: question.slice(0, 80),
          })
          .returning({ id: nlqaConversations.id });
      });
      if (!created) {
        return NextResponse.json({ error: 'Failed to create conversation' }, { status: 500 });
      }
      activeConversationId = created.id;
    } else {
      // Verify conversation exists and belongs to this user
      const [conv] = await withOrgContext(orgId, userId, async () => {
        return db
          .select({ id: nlqaConversations.id })
          .from(nlqaConversations)
          .where(eq(nlqaConversations.id, activeConversationId!));
      });
      if (!conv) {
        return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
      }
    }

    // 3. Load conversation history (last N turns)
    const historyRows = await withOrgContext(orgId, userId, async () => {
      return db
        .select({
          role: nlqaMessages.role,
          content: nlqaMessages.content,
          generatedSql: nlqaMessages.generatedSql,
        })
        .from(nlqaMessages)
        .where(eq(nlqaMessages.conversationId, activeConversationId!))
        .orderBy(desc(nlqaMessages.createdAt))
        .limit(MAX_HISTORY_TURNS);
    });

    const history: NLQAHistoryTurn[] = historyRows.reverse().map((row) => ({
      role: row.role === 'user' ? 'user' : 'assistant',
      content: row.content,
      sql: row.generatedSql,
    }));

    // 4. Persist user message
    const [userMessage] = await withOrgContext(orgId, userId, async () => {
      return db
        .insert(nlqaMessages)
        .values({
          orgId,
          conversationId: activeConversationId!,
          role: 'user',
          content: question,
        })
        .returning({ id: nlqaMessages.id });
    });
    if (!userMessage) {
      return NextResponse.json({ error: 'Failed to persist message' }, { status: 500 });
    }

    await audit(orgId, userId, 'nlqa.question_asked', `conversation:${activeConversationId}`, {
      metadata: { questionLength: question.length },
    });

    // 5. Get org LLM config (with BYOK encryption handled by AiGateway)
    const orgRows = await withOrgContext(orgId, userId, async () => {
      return db
        .select({
          llmProvider: orgs.llmProvider,
          llmModel: orgs.llmModel,
          llmApiKeyEncrypted: orgs.llmApiKeyEncrypted,
        })
        .from(orgs)
        .where(eq(orgs.id, orgId));
    });
    const orgConfig = orgRows[0];
    const provider = (orgConfig?.llmProvider ?? 'openai') as 'openai' | 'anthropic' | 'gemini';
    const modelName = orgConfig?.llmModel ?? 'gpt-4o';
    const apiKeyEncrypted = orgConfig?.llmApiKeyEncrypted ?? undefined;

    const gateway = new AiGateway(provider, modelName, apiKeyEncrypted ?? undefined);

    // 6. Step 1: generate SQL
    const sqlResult = await gateway.generateNLQASql({
      question,
      schemaInfo: JSON.stringify(rawSchema, null, 2),
      dataSourceType,
      history,
    });

    // 7. If SQL is null → assistant sends fallback answer
    if (!sqlResult.sql) {
      const fallback = sqlResult.fallbackAnswer ?? 'No puedo responder esa pregunta con los datos disponibles.';
      const [assistantMsg] = await withOrgContext(orgId, userId, async () => {
        return db
          .insert(nlqaMessages)
          .values({
            orgId,
            conversationId: activeConversationId!,
            role: 'assistant',
            content: fallback,
          })
          .returning({ id: nlqaMessages.id });
      });

      await audit(orgId, userId, 'nlqa.answer_generated', `message:${assistantMsg?.id ?? 'unknown'}`, {
        metadata: { hadSql: false, reasoning: sqlResult.reasoning ?? '' },
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

    // 8. Validate SQL (T3) before executing
    try {
      validateQuery({ kind: 'sql', sql: sqlResult.sql }, dataSourceType);
    } catch (err) {
      logger.warn({ sql: sqlResult.sql, error: err }, 'NLQA SQL failed validation');
      const message = 'La IA generó una query inválida. Reformulá tu pregunta.';
      await withOrgContext(orgId, userId, async () => {
        await db.insert(nlqaMessages).values({
          orgId,
          conversationId: activeConversationId!,
          role: 'assistant',
          content: message,
        });
      });
      return NextResponse.json({ error: 'sql_validation_failed', message }, { status: 422 });
    }

    // 9. Execute query via query-engine (with timeout + circuit breaker)
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

    // 10. Step 2: generate answer + chart suggestion
    const answerResult = await gateway.generateNLQAAnswer({
      question,
      sql: sqlResult.sql,
      result: { rows: result.rows, rowCount: result.rowCount },
      history,
    });

    // 11. Persist assistant message with metadata
    const [assistantMsg] = await withOrgContext(orgId, userId, async () => {
      return db
        .insert(nlqaMessages)
        .values({
          orgId,
          conversationId: activeConversationId!,
          role: 'assistant',
          content: answerResult.answer,
          generatedSql: sqlResult.sql,
          generatedChartType: answerResult.chartSuggestion?.type ?? null,
          generatedChartConfig: answerResult.chartSuggestion?.config ?? null,
          rowCount: result.rowCount,
          executionMs: execMs,
        })
        .returning({ id: nlqaMessages.id });
    });

    await audit(orgId, userId, 'nlqa.answer_generated', `message:${assistantMsg?.id ?? 'unknown'}`, {
      metadata: {
        hadSql: true,
        rowCount: result.rowCount,
        executionMs: execMs,
        chartType: answerResult.chartSuggestion?.type ?? null,
      },
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
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal error';
    const status = error instanceof Error && error.name === 'ForbiddenError' ? 403 : 500;
    logger.error({ error, orgId, userId }, 'NLQA ask failed');
    return NextResponse.json({ error: message }, { status });
  }
}

// GET /api/nlqa/ask?conversationId=...  → list messages
export async function GET(req: Request) {
  const url = new URL(req.url);
  const orgId = req.headers.get('x-org-id') || url.searchParams.get('orgId');
  const userId = req.headers.get('x-user-id');
  const conversationId = url.searchParams.get('conversationId');

  if (!orgId || !userId) {
    return NextResponse.json({ error: 'x-org-id and x-user-id headers required' }, { status: 400 });
  }
  if (!conversationId) {
    return NextResponse.json({ error: 'conversationId required' }, { status: 400 });
  }

  try {
    await requirePermission(userId, orgId, 'query.execute');

    const messages = await withOrgContext(orgId, userId, async () => {
      return db
        .select()
        .from(nlqaMessages)
        .where(eq(nlqaMessages.conversationId, conversationId))
        .orderBy(asc(nlqaMessages.createdAt));
    });

    return NextResponse.json({ conversationId, messages });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal error';
    const status = error instanceof Error && error.name === 'ForbiddenError' ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}