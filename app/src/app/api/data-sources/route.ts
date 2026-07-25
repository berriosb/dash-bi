import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, withOrgContext } from '@/db/client';
import { dataSources, auditLog } from '@/db/schema';
import { requirePermission } from '@/lib/auth/context';
import { encryptApiKey } from '@/lib/security/encryption';
import { validatePostgresHost } from '@/lib/security/validate-connection';
import { audit } from '@/lib/audit/log';

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

export async function GET(req: Request) {
  const url = new URL(req.url);
  const orgId = req.headers.get('x-org-id') || url.searchParams.get('orgId');
  const userId = req.headers.get('x-user-id');

  if (!orgId || !userId) {
    return NextResponse.json({ error: 'x-org-id and x-user-id headers required' }, { status: 400 });
  }

  try {
    await requirePermission(userId, orgId, 'datasource.view');
    const sources = await withOrgContext(orgId, userId, async () => {
      return db.select({
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
      .where(eq(dataSources.orgId, orgId));
    });

    return NextResponse.json({ dataSources: sources });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal error';
    const status = error instanceof Error && error.name === 'ForbiddenError' ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const orgId = req.headers.get('x-org-id') || url.searchParams.get('orgId');
  const userId = req.headers.get('x-user-id');

  if (!orgId || !userId) {
    return NextResponse.json({ error: 'x-org-id and x-user-id headers required' }, { status: 400 });
  }

  try {
    await requirePermission(userId, orgId, 'datasource.create');

    const rawBody = await req.json();
    const parsed = CreateDataSourceSchema.safeParse(rawBody);
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const path = issue.path.join('.') || 'root';
        if (!fieldErrors[path]) fieldErrors[path] = issue.message;
      }
      return NextResponse.json(
        { error: 'validation.invalid_format', message: 'Revisá los campos marcados.', fieldErrors },
        { status: 400 },
      );
    }

    const { name, type, config } = parsed.data;

    let validatedConfig: Record<string, unknown>;
    if (type === 'postgres') {
      const result = PostgresConfigSchema.safeParse(config);
      if (!result.success) {
        return NextResponse.json(
          { error: 'validation.invalid_format', fieldErrors: flattenZod(result.error) },
          { status: 400 },
        );
      }
      try {
        validatePostgresHost(result.data.host);
      } catch (ssrfErr) {
        return NextResponse.json(
          { error: 'connector.ssrf_blocked', message: ssrfErr instanceof Error ? ssrfErr.message : 'Host bloqueado' },
          { status: 400 },
        );
      }
      validatedConfig = result.data as Record<string, unknown>;
    } else if (type === 'stripe') {
      const result = StripeConfigSchema.safeParse(config);
      if (!result.success) {
        return NextResponse.json(
          { error: 'validation.invalid_format', fieldErrors: flattenZod(result.error) },
          { status: 400 },
        );
      }
      validatedConfig = result.data as Record<string, unknown>;
    } else if (type === 'sheets') {
      const result = SheetsConfigSchema.safeParse(config);
      if (!result.success) {
        return NextResponse.json(
          { error: 'validation.invalid_format', fieldErrors: flattenZod(result.error) },
          { status: 400 },
        );
      }
      validatedConfig = result.data as Record<string, unknown>;
    } else {
      return NextResponse.json({ error: 'connector.unsupported_format' }, { status: 400 });
    }

    const configEncrypted = encryptApiKey(JSON.stringify(validatedConfig));

    const [created] = await withOrgContext(orgId, userId, async () => {
      return db.insert(dataSources).values({
        orgId,
        type,
        name,
        configEncrypted,
      }).returning({
        id: dataSources.id,
        name: dataSources.name,
        type: dataSources.type,
        createdAt: dataSources.createdAt,
      });
    });

    if (!created) {
      return NextResponse.json({ error: 'Failed to create data source' }, { status: 500 });
    }

    await audit(orgId, userId, 'datasource.created', `datasource:${created.id}`, {
      metadata: { name, type },
    });

    return NextResponse.json({ dataSource: created }, { status: 201 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal error';
    const status = error instanceof Error && error.name === 'ForbiddenError' ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
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
