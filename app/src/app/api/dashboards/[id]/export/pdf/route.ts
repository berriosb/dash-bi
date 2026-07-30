import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/request';
import { enqueuePdfExport, getPdfJobStatus } from '@/lib/export/pdf-enqueue';
import { audit } from '@/lib/audit/log';
import { logger } from '@/lib/logger';
import { toUserError, getOrGenerateCorrelationId } from '@/lib/errors/to-user-error';
import { statusFromCode } from '@/lib/errors/types';

export const dynamic = 'force-dynamic';

function errorResponse(error: unknown, req: Request) {
  const correlationId = getOrGenerateCorrelationId(req);
  const appError = toUserError(error, correlationId);
  return NextResponse.json(appError, {
    status: statusFromCode(appError.code),
    headers: { 'x-correlation-id': correlationId },
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: dashboardId } = await params;

  try {
    const ctx = await requireAuth(req, 'export.pdf');

    const body = await req.json().catch(() => ({}));
    const pageSize = body.pageSize === 'A4' ? 'A4' : 'Letter';

    const jobId = await enqueuePdfExport({ dashboardId, orgId: ctx.orgId, userId: ctx.userId, pageSize });

    await audit(ctx.orgId, ctx.userId, 'export.pdf_requested', `dashboard:${dashboardId}`, {
      metadata: { jobId, pageSize },
      req,
    });

    return NextResponse.json({ jobId, status: 'queued' }, { status: 202 });
  } catch (error) {
    return errorResponse(error, req);
  }
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: dashboardId } = await params;
  const url = new URL(req.url);
  const jobId = url.searchParams.get('jobId');

  try {
    const ctx = await requireAuth(req, 'export.pdf');
    if (!jobId) {
      return NextResponse.json({ error: 'jobId query param required' }, { status: 400 });
    }

    const result = await getPdfJobStatus(jobId);

    if (result.status === 'not_found') {
      return NextResponse.json({ status: 'not_found' }, { status: 404 });
    }

    if (result.status === 'failed') {
      await audit(ctx.orgId, ctx.userId, 'export.pdf_failed', `dashboard:${dashboardId}`, {
        metadata: { jobId, reason: result.reason ?? 'unknown' },
        req,
      });
      return NextResponse.json({ status: 'failed', reason: result.reason ?? 'unknown' }, { status: 200 });
    }

    if (result.status === 'completed') {
      await audit(ctx.orgId, ctx.userId, 'export.pdf_completed', `dashboard:${dashboardId}`, {
        metadata: { jobId, bytes: result.buffer.length },
        req,
      });
      return new Response(result.buffer as unknown as BodyInit, {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="dashboard-${dashboardId}.pdf"`,
        },
      });
    }

    return NextResponse.json({ status: result.status }, { status: 200 });
  } catch (error) {
    logger.error({ err: error }, 'pdf-export: GET failed');
    return errorResponse(error, req);
  }
}