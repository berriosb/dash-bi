import { NextResponse } from 'next/server';
import { z } from 'zod';
import { sql, eq } from 'drizzle-orm';
import { withSystemContext, withOrgContext } from '@/db/client';
import { dataSources, uploadedFiles } from '@/db/schema';
import { requireAuth } from '@/lib/auth/request';
import { toUserError, getOrGenerateCorrelationId } from '@/lib/errors/to-user-error';
import { statusFromCode } from '@/lib/errors/types';
import { audit } from '@/lib/audit/log';
import { encryptApiKey } from '@/lib/security/encryption';
import { takeParsedForCommit } from '@/lib/connectors/parsers/commit-store';
import {
  buildCreateSchemaSQL,
  buildCreateTableSQL,
  buildIndexSQL,
  buildRLSPoliciesSQL,
  loadRows,
} from '@/lib/connectors/parsers/load';
import { type InferredColumn } from '@/lib/connectors/parsers/infer-types';

export const dynamic = 'force-dynamic';

const CommitBodySchema = z.object({
  fileId: z.string().uuid(),
  name: z.string().min(1).max(200),
  columns: z
    .array(
      z.object({
        name: z.string().min(1).max(63),
        type: z.enum(['number', 'string', 'date', 'boolean', 'json']),
        nullable: z.boolean(),
      }),
    )
    .min(1)
    .max(200),
});

function errorResponse(error: unknown, req: Request) {
  const correlationId = getOrGenerateCorrelationId(req);
  const appError = toUserError(error, correlationId);
  return NextResponse.json(appError, {
    status: statusFromCode(appError.code),
    headers: { 'x-correlation-id': correlationId },
  });
}

/**
 * POST /api/files/commit
 *
 * Body: { fileId, name, columns: [{name, type, nullable}] }
 *
 * Creates the target table, applies RLS + indexes, and loads the
 * previously-parsed rows. Also creates a `data_sources` row of type
 * `csv` / `excel` so the file shows up in the data-sources list and
 * can be queried via the spreadsheet connector.
 */
export async function POST(req: Request) {
  let body: z.infer<typeof CommitBodySchema>;
  try {
    body = CommitBodySchema.parse(await req.json());
  } catch (error) {
    return NextResponse.json(
      {
        code: 'validation.invalid_format',
        message: 'Body inválido',
        issues: error instanceof z.ZodError ? error.issues : undefined,
      },
      { status: 400 },
    );
  }

  try {
    const ctx = await requireAuth(req, 'datasource.create');

    const stored = takeParsedForCommit(body.fileId);
    if (!stored) {
      return NextResponse.json(
        {
          code: 'not_found',
          message:
            'La sesión de upload expiró. Por favor volvé a subir el archivo.',
        },
        { status: 410 },
      );
    }

    const inferredColumns: InferredColumn[] = body.columns.map((c) => ({
      name: c.name,
      type: c.type,
      nullable: c.nullable,
      samples: [],
    }));

    // We need to know the target table name. The file row was created
    // in the upload step; we re-read it here via the typed Drizzle
    // query (which is also RLS-scoped via the org context).
    const uploadedRow = await withOrgContext(
      ctx.orgId,
      ctx.userId,
      ctx.role,
      async (tx) => {
        const rows = await tx
          .select({ targetTable: uploadedFiles.targetTable })
          .from(uploadedFiles)
          .where(eq(uploadedFiles.id, body.fileId))
          .limit(1);
        return rows[0] ?? null;
      },
    );
    if (!uploadedRow) {
      return NextResponse.json(
        { code: 'not_found', message: 'Archivo no encontrado' },
        { status: 404 },
      );
    }
    const targetTable: string = uploadedRow.targetTable;

    // 1. DDL: create schema + table + RLS + indexes (table-owner).
    await withSystemContext(async (tx) => {
      const [schemaName] = targetTable.split('.');
      if (!schemaName) {
        throw new Error('targetTable inválido');
      }
      await tx.execute(sql.raw(buildCreateSchemaSQL(schemaName)));
      await tx.execute(sql.raw(buildCreateTableSQL(targetTable, inferredColumns)));
      const rls = buildRLSPoliciesSQL(targetTable);
      await tx.execute(sql.raw(rls.enable));
      await tx.execute(sql.raw(rls.policy));
      for (const idxSql of buildIndexSQL(targetTable, inferredColumns)) {
        await tx.execute(sql.raw(idxSql));
      }
    });

    // 2. INSERT the rows. The `dashbi` role owns the table and bypasses
    //    FORCE RLS, so we don't need GUCs.
    const inserted = await withSystemContext(
      async (tx) =>
        loadRows(
          tx as never,
          targetTable,
          ctx.orgId,
          inferredColumns,
          stored.rows,
        ),
    );

    // 3. Create the data_sources row so the file shows up in the
    //    dashboards UI. Encrypted config holds the fileId; the
    //    SpreadsheetConnector decodes it lazily.
    const [dataSource] = await withOrgContext(
      ctx.orgId,
      ctx.userId,
      ctx.role,
      async (tx) => {
        const configJson = JSON.stringify({ fileId: body.fileId });
        return tx
          .insert(dataSources)
          .values({
            orgId: ctx.orgId,
            type: stored.format === 'csv' ? 'csv' : 'excel',
            name: body.name,
            configEncrypted: encryptApiKey(configJson),
            schemaCache: {
              tables: [
                {
                  name: targetTable.split('.').pop(),
                  columns: inferredColumns.map((c) => ({
                    name: c.name,
                    type: c.type,
                    nullable: c.nullable,
                  })),
                },
              ],
            },
            schemaCachedAt: new Date(),
            lastTestedAt: new Date(),
            lastTestOk: true,
          })
          .returning({ id: dataSources.id });
      },
    );

    await audit(
      ctx.orgId,
      ctx.userId,
      'datasource.created',
      `data_source:${dataSource?.id}`,
      {
        metadata: {
          source: 'file-upload',
          fileId: body.fileId,
          targetTable,
          rowCount: inserted,
        },
        req,
      },
    );

    return NextResponse.json(
      { dataSourceId: dataSource?.id, rowCount: inserted },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error, req);
  }
}