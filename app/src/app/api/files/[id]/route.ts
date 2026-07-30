import { NextResponse } from 'next/server';
import { sql, eq, and, isNull } from 'drizzle-orm';
import { withOrgContext, withSystemContext } from '@/db/client';
import { uploadedFiles } from '@/db/schema';
import { requireAuth } from '@/lib/auth/request';
import { toUserError, getOrGenerateCorrelationId } from '@/lib/errors/to-user-error';
import { statusFromCode } from '@/lib/errors/types';
import { audit } from '@/lib/audit/log';
import { buildDropTableSQL } from '@/lib/connectors/parsers/load';

export const dynamic = 'force-dynamic';

function errorResponse(error: unknown, req: Request) {
  const correlationId = getOrGenerateCorrelationId(req);
  const appError = toUserError(error, correlationId);
  return NextResponse.json(appError, {
    status: statusFromCode(appError.code),
    headers: { 'x-correlation-id': correlationId },
  });
}

/**
 * GET /api/files/[id]
 *
 * Devuelve el metadata de un archivo subido. RLS filtra por org.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireAuth(req, 'datasource.view');
    const { id } = await params;

    const file = await withOrgContext(
      ctx.orgId,
      ctx.userId,
      ctx.role,
      async (tx) => {
        const rows = await tx
          .select()
          .from(uploadedFiles)
          .where(
            and(
              eq(uploadedFiles.id, id),
              eq(uploadedFiles.orgId, ctx.orgId),
              isNull(uploadedFiles.deletedAt),
            ),
          )
          .limit(1);
        return rows[0] ?? null;
      },
    );

    if (!file) {
      return NextResponse.json(
        { code: 'not_found', message: 'Archivo no encontrado' },
        { status: 404 },
      );
    }
    return NextResponse.json({ file });
  } catch (error) {
    return errorResponse(error, req);
  }
}

/**
 * DELETE /api/files/[id]
 *
 * Soft-delete: marca `deletedAt` y borra la tabla materializada.
 * RLS filtra por org. La limpieza de schema `org_<id>` queda para el
 * job de cron (Fase 2: cleanup tras 30 días).
 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireAuth(req, 'datasource.delete');
    const { id } = await params;

    // 1. Look up the file inside the org (RLS).
    const file = await withOrgContext(
      ctx.orgId,
      ctx.userId,
      ctx.role,
      async (tx) => {
        const rows = await tx
          .select()
          .from(uploadedFiles)
          .where(
            and(
              eq(uploadedFiles.id, id),
              eq(uploadedFiles.orgId, ctx.orgId),
              isNull(uploadedFiles.deletedAt),
            ),
          )
          .limit(1);
        return rows[0] ?? null;
      },
    );
    if (!file) {
      return NextResponse.json(
        { code: 'not_found', message: 'Archivo no encontrado' },
        { status: 404 },
      );
    }

    // 2. Drop the materialized table. This needs table-owner
    //    privileges which the `dashbi` role has. We use
    //    withSystemContext to bypass RLS only for the DDL (the file
    //    row was already verified to belong to the org above).
    await withSystemContext(async (tx) => {
      await tx.execute(sql.raw(buildDropTableSQL(file.targetTable)));
    });

    // 3. Mark the row as deleted (RLS UPDATE — same org check).
    await withOrgContext(
      ctx.orgId,
      ctx.userId,
      ctx.role,
      async (tx) => {
        await tx
          .update(uploadedFiles)
          .set({ deletedAt: new Date(), updatedAt: new Date() })
          .where(eq(uploadedFiles.id, id));
      },
    );

    await audit(ctx.orgId, ctx.userId, 'datasource.deleted', `uploaded_file:${id}`, {
      metadata: { name: file.name, targetTable: file.targetTable },
      req,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error, req);
  }
}