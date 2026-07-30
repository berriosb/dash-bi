import { NextResponse } from 'next/server';
import { z } from 'zod';
import { eq, and, isNull } from 'drizzle-orm';
import { withOrgContext } from '@/db/client';
import { uploadedFiles } from '@/db/schema';
import { requireAuth } from '@/lib/auth/request';
import { toUserError, getOrGenerateCorrelationId } from '@/lib/errors/to-user-error';
import { statusFromCode } from '@/lib/errors/types';

export const dynamic = 'force-dynamic';

const ListFilesQuerySchema = z.object({
  includeDeleted: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
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
 * GET /api/files
 *
 * Lista los archivos subidos por el usuario (de la org activa).
 * El parámetro `?includeDeleted=true` incluye los soft-deleted para
 * depuración.
 */
export async function GET(req: Request) {
  try {
    const ctx = await requireAuth(req, 'datasource.view');
    const url = new URL(req.url);
    const { includeDeleted } = ListFilesQuerySchema.parse(
      Object.fromEntries(url.searchParams.entries()),
    );

    const files = await withOrgContext(
      ctx.orgId,
      ctx.userId,
      ctx.role,
      async (tx) => {
        const conditions = includeDeleted
          ? eq(uploadedFiles.orgId, ctx.orgId)
          : and(eq(uploadedFiles.orgId, ctx.orgId), isNull(uploadedFiles.deletedAt));
        return tx
          .select({
            id: uploadedFiles.id,
            name: uploadedFiles.name,
            originalFilename: uploadedFiles.originalFilename,
            format: uploadedFiles.format,
            sizeBytes: uploadedFiles.sizeBytes,
            targetTable: uploadedFiles.targetTable,
            rowCount: uploadedFiles.rowCount,
            columns: uploadedFiles.columns,
            createdAt: uploadedFiles.createdAt,
            updatedAt: uploadedFiles.updatedAt,
            deletedAt: uploadedFiles.deletedAt,
          })
          .from(uploadedFiles)
          .where(conditions);
      },
    );

    return NextResponse.json({ files });
  } catch (error) {
    return errorResponse(error, req);
  }
}