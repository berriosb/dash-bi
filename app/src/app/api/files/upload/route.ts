import { NextResponse } from 'next/server';
import { withSystemContext } from '@/db/client';
import { uploadedFiles } from '@/db/schema';
import { requireAuth } from '@/lib/auth/request';
import { toUserError, getOrGenerateCorrelationId } from '@/lib/errors/to-user-error';
import { statusFromCode } from '@/lib/errors/types';
import { audit } from '@/lib/audit/log';
import { parseCSV } from '@/lib/connectors/parsers/csv';
import { parseExcel } from '@/lib/connectors/parsers/excel';
import { inferColumns } from '@/lib/connectors/parsers/infer-types';
import { safeTableName } from '@/lib/connectors/parsers/normalize';
import { checkRateLimit } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { storeParsedForCommit } from '@/lib/connectors/parsers/commit-store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024; // 100MB
const MAX_ROWS = 1_000_000;

function errorResponse(error: unknown, req: Request) {
  const correlationId = getOrGenerateCorrelationId(req);
  const appError = toUserError(error, correlationId);
  return NextResponse.json(appError, {
    status: statusFromCode(appError.code),
    headers: { 'x-correlation-id': correlationId },
  });
}

function detectFormat(filename: string, mime: string): 'csv' | 'xlsx' | 'xls' {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.xlsx')) return 'xlsx';
  if (lower.endsWith('.xls')) return 'xls';
  if (
    mime === 'text/csv' ||
    mime === 'application/csv' ||
    lower.endsWith('.csv') ||
    lower.endsWith('.tsv') ||
    lower.endsWith('.txt')
  ) {
    return 'csv';
  }
  return 'csv';
}

interface InMemoryUpload {
  filename: string;
  mime: string;
  buffer: Buffer;
}

/**
 * Naive multipart parser. Acceptable for the 100MB Sprint 1.5 cap;
 * the worker streaming path is tracked for Fase 2.
 */
async function readMultipart(req: Request): Promise<InMemoryUpload> {
  const contentType = req.headers.get('content-type') ?? '';
  const match = contentType.match(/boundary=(.+)$/);
  if (!match) {
    throw new Error('Missing multipart boundary');
  }
  const boundary = `--${match[1]!.replace(/^"|"$/g, '')}`;
  const body = Buffer.from(await req.arrayBuffer());

  const boundaryBuf = Buffer.from(boundary);
  let cursor = 0;
  while (cursor < body.length) {
    const partStart = body.indexOf(boundaryBuf, cursor);
    if (partStart < 0) break;
    const headerEnd = body.indexOf(Buffer.from('\r\n\r\n'), partStart);
    if (headerEnd < 0) {
      cursor = partStart + boundaryBuf.length;
      continue;
    }
    const headers = body
      .slice(partStart + boundaryBuf.length, headerEnd)
      .toString('utf8');
    let bodyStart = headerEnd + 4;
    const nextBoundary = body.indexOf(boundaryBuf, bodyStart);
    const partEnd = nextBoundary > 0 ? nextBoundary - 2 : body.length;
    if (headers.toLowerCase().includes('content-disposition: form-data')) {
      const filenameMatch = headers.match(/filename="([^"]+)"/);
      const typeMatch = headers.match(/Content-Type:\s*([^\r\n]+)/i);
      if (filenameMatch) {
        const buffer = body.slice(bodyStart, partEnd);
        return {
          filename: filenameMatch[1]!,
          mime: typeMatch?.[1]?.trim() ?? 'application/octet-stream',
          buffer,
        };
      }
    }
    cursor = partEnd + 2;
  }
  throw new Error('No file part in multipart body');
}

/**
 * POST /api/files/upload (multipart)
 *
 * 1. Read the uploaded file.
 * 2. Parse CSV/Excel.
 * 3. Infer column types.
 * 4. Return a preview + the proposed target table name.
 *
 * The parsed rows are stashed in an in-memory cache keyed by fileId
 * so the subsequent /api/files/commit call can re-insert them
 * without re-uploading the file. See `parsers/commit-store.ts`.
 */
export async function POST(req: Request) {
  try {
    const ctx = await requireAuth(req, 'datasource.create');
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';

    const limit = checkRateLimit({
      capacity: 5,
      refillPerSecond: 0.05, // 1 upload per 20s
      key: `file-upload:org:${ctx.orgId}:ip:${ip}`,
    });
    if (!limit.allowed) {
      return NextResponse.json(
        { error: 'rate_limited', retryAfterSeconds: limit.retryAfterSeconds },
        { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
      );
    }

    let upload: InMemoryUpload;
    try {
      upload = await readMultipart(req);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return NextResponse.json(
        {
          code: 'connector.invalid_multipart',
          message: `No se pudo leer el archivo: ${message}`,
        },
        { status: 400 },
      );
    }
    if (upload.buffer.length > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json(
        {
          code: 'connector.file_too_large',
          message: `El archivo excede el límite de ${MAX_FILE_SIZE_BYTES / 1024 / 1024}MB.`,
        },
        { status: 413 },
      );
    }

    const format = detectFormat(upload.filename, upload.mime);
    const parsed =
      format === 'csv'
        ? parseCSV(upload.buffer, { maxRows: MAX_ROWS })
        : parseExcel(upload.buffer, { maxRows: MAX_ROWS });
    if (parsed.errors.length > 0) {
      logger.warn(
        { errors: parsed.errors, filename: upload.filename },
        'file-upload: parser reported errors',
      );
    }
    if (parsed.rows.length === 0) {
      return NextResponse.json(
        {
          code: 'connector.unsupported_format',
          message: 'El archivo no contiene filas.',
        },
        { status: 400 },
      );
    }

    const inferred = inferColumns(parsed.rows);
    const proposedTable = safeTableName(upload.filename, ctx.orgId);

    // Insert the file row in withSystemContext (bypasses RLS only
    // for the metadata row; the materialized table is created later
    // in withSystemContext too, and the rows go in via withOrgContext
    // so RLS approves them). Sprint 1.5 MVP.
    const fileId = await withSystemContext(async (tx) => {
      const [row] = await tx
        .insert(uploadedFiles)
        .values({
          orgId: ctx.orgId,
          name: upload.filename.replace(/\.(csv|tsv|txt|xlsx|xls)$/i, ''),
          originalFilename: upload.filename,
          format,
          sizeBytes: upload.buffer.length,
          targetTable: proposedTable,
          rowCount: parsed.rows.length,
          columns: inferred,
          createdBy: ctx.userId,
        })
        .returning({ id: uploadedFiles.id });
      return row?.id;
    });

    if (!fileId) {
      throw new Error('Failed to insert uploaded_files row');
    }

    // Stash parsed rows for the commit step. The store is in-memory
    // (dev only); production should use Redis or a temp file path.
    storeParsedForCommit(fileId, parsed.rows, format);

    await audit(ctx.orgId, ctx.userId, 'datasource.created', `uploaded_file:${fileId}`, {
      metadata: {
        name: upload.filename,
        format,
        sizeBytes: upload.buffer.length,
        rowCount: parsed.rows.length,
      },
      req,
    });

    return NextResponse.json(
      {
        fileId,
        name: upload.filename,
        format,
        sizeBytes: upload.buffer.length,
        proposedTargetTable: proposedTable,
        inferredColumns: inferred,
        previewRows: parsed.rows.slice(0, 10),
        totalRows: parsed.rows.length,
      },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error, req);
  }
}