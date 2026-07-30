import { NextResponse } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { withOrgContext } from '@/db/client';
import { dataSources } from '@/db/schema';
import { requireAuth } from '@/lib/auth/request';
import { encryptApiKey } from '@/lib/security/encryption';
import { validatePostgresHost } from '@/lib/security/validate-connection';
import { checkRateLimit } from '@/lib/rate-limit';
import { audit } from '@/lib/audit/log';
import { toUserError, getOrGenerateCorrelationId } from '@/lib/errors/to-user-error';
import { statusFromCode } from '@/lib/errors/types';

export const dynamic = 'force-dynamic';

const PostgresConfigSchema = z.object({
  host: z.string().min(1).max(253),
  port: z.number().int().positive().max(65535).default(5432),
  database: z.string().min(1).max(63),
  username: z.string().min(1).max(63),
  password: z.string().min(1).max(256),
  ssl: z.boolean().optional(),
});

const StripeConfigSchema = z.object({
  apiKey: z.string().regex(/^sk_(live|test)_[a-zA-Z0-9]{20,}$/, 'Formato de Stripe API key inválido'),
});

const SheetsConfigSchema = z.object({
  spreadsheetId: z.string().min(10).max(128),
  refreshTokenEncrypted: z.string().optional(),
  sheetNames: z.array(z.string()).optional(),
});

const CreateDataSourceSchema = z.object({
  name: z.string().min(1).max(200),
  type: z.enum(['postgres', 'stripe', 'sheets']),
  config: z.unknown(),
});

function errorResponse(error: unknown, req: Request) {
  const correlationId = getOrGenerateCorrelationId(req);
  const appError = toUserError(error, correlationId);
  return NextResponse.json(appError, {
    status: statusFromCode(appError.code),
    headers: { 'x-correlation-id': correlationId },
  });
}

export async function GET(req: Request) {
  try {
    const ctx = await requireAuth(req, 'datasource.view');

    const sources = await withOrgContext(ctx.orgId, ctx.userId, ctx.role, async (tx) =>
      tx.select({
        id: dataSources.id,
        orgId: dataSources.orgId,
        type: dataSources.type,
        name: dataSources.name,
        schemaCache: dataSources.schemaCache,
        schemaCachedAt: dataSources.schemaCachedAt,
        lastTestedAt: dataSources.lastTestedAt,
        lastTestOk: dataSources.lastTestOk,
        createdAt: dataSources.createdAt,
        updatedAt: dataSources.updatedAt,
      })
      .from(dataSources)
      .where(eq(dataSources.orgId, ctx.orgId))
    );

    return NextResponse.json({ dataSources: sources });
  } catch (error) {
    return errorResponse(error, req);
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await requireAuth(req, 'datasource.create');
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';

    const dsLimit = checkRateLimit({
      capacity: 30,
      refillPerSecond: 0.5,
      key: `ds-create:org:${ctx.orgId}:ip:${ip}`,
    });
    if (!dsLimit.allowed) {
      return NextResponse.json(
        { error: 'rate_limited', retryAfterSeconds: dsLimit.retryAfterSeconds },
        { status: 429, headers: { 'Retry-After': String(dsLimit.retryAfterSeconds) } },
      );
    }

    const rawBody = await req.json();
    const parsed = CreateDataSourceSchema.safeParse(rawBody);
    if (!parsed.success) {
      const correlationId = getOrGenerateCorrelationId(req);
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const path = issue.path.join('.') || 'root';
        if (!fieldErrors[path]) fieldErrors[path] = issue.message;
      }
      return NextResponse.json(
        {
          code: 'validation.invalid_format',
          message: 'Revisá los campos marcados.',
          correlationId,
          retryable: false,
          fieldErrors,
        },
        { status: 400, headers: { 'x-correlation-id': correlationId } },
      );
    }

    const { name, type, config } = parsed.data;

    let validatedConfig: Record<string, unknown>;
    if (type === 'postgres') {
      const result = PostgresConfigSchema.safeParse(config);
      if (!result.success) {
        const correlationId = getOrGenerateCorrelationId(req);
        return NextResponse.json(
          {
            code: 'validation.invalid_format',
            message: 'Revisá los campos marcados.',
            correlationId,
            retryable: false,
            fieldErrors: flattenZod(result.error),
          },
          { status: 400, headers: { 'x-correlation-id': correlationId } },
        );
      }
      try {
        validatePostgresHost(result.data.host);
      } catch (ssrfErr) {
        const correlationId = getOrGenerateCorrelationId(req);
        return NextResponse.json(
          {
            code: 'connector.ssrf_blocked',
            message: ssrfErr instanceof Error ? ssrfErr.message : 'Host bloqueado',
            correlationId,
            retryable: false,
          },
          { status: 400, headers: { 'x-correlation-id': correlationId } },
        );
      }
      validatedConfig = result.data as Record<string, unknown>;
    } else if (type === 'stripe') {
      const result = StripeConfigSchema.safeParse(config);
      if (!result.success) {
        const correlationId = getOrGenerateCorrelationId(req);
        return NextResponse.json(
          {
            code: 'validation.invalid_format',
            message: 'Revisá los campos marcados.',
            correlationId,
            retryable: false,
            fieldErrors: flattenZod(result.error),
          },
          { status: 400, headers: { 'x-correlation-id': correlationId } },
        );
      }
      validatedConfig = result.data as Record<string, unknown>;
    } else if (type === 'sheets') {
      const result = SheetsConfigSchema.safeParse(config);
      if (!result.success) {
        const correlationId = getOrGenerateCorrelationId(req);
        return NextResponse.json(
          {
            code: 'validation.invalid_format',
            message: 'Revisá los campos marcados.',
            correlationId,
            retryable: false,
            fieldErrors: flattenZod(result.error),
          },
          { status: 400, headers: { 'x-correlation-id': correlationId } },
        );
      }
      validatedConfig = result.data as Record<string, unknown>;
    } else {
      const correlationId = getOrGenerateCorrelationId(req);
      return NextResponse.json(
        {
          code: 'connector.unsupported_format',
          message: 'Tipo de conector no soportado',
          correlationId,
          retryable: false,
        },
        { status: 400, headers: { 'x-correlation-id': correlationId } },
      );
    }

    const configEncrypted = encryptApiKey(JSON.stringify(validatedConfig));

    const [created] = await withOrgContext(ctx.orgId, ctx.userId, ctx.role, async (tx) =>
      tx.insert(dataSources).values({
        orgId: ctx.orgId,
        type,
        name,
        configEncrypted,
      }).returning({
        id: dataSources.id,
        name: dataSources.name,
        type: dataSources.type,
        createdAt: dataSources.createdAt,
      })
    );

    if (!created) {
      return NextResponse.json({ error: 'Failed to create data source' }, { status: 500 });
    }

    await audit(ctx.orgId, ctx.userId, 'datasource.created', `datasource:${created.id}`, {
      metadata: { name, type },
      req,
    });

    return NextResponse.json({ dataSource: created }, { status: 201 });
  } catch (error) {
    return errorResponse(error, req);
  }
}

function flattenZod(err: z.ZodError): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of err.issues) {
    const path = issue.path.join('.') || 'root';
    if (!fieldErrors[path]) fieldErrors[path] = issue.message;
  }
  return fieldErrors;
}