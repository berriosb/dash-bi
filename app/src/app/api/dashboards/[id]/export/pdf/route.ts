import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/context';
import { enqueuePdfExport, getPdfJobStatus } from '@/lib/export/pdf-enqueue';
import { audit } from '@/lib/audit/log';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: dashboardId } = await params;
  const url = new URL(req.url);
  const orgId = req.headers.get('x-org-id') || url.searchParams.get('orgId');
  const userId = req.headers.get('x-user-id');

  if (!orgId || !userId) {
    return NextResponse.json(
      { error: 'x-org-id and x-user-id headers required' },
      { status: 400 }
    );
  }

  try {
    await requirePermission(userId, orgId, 'export.pdf');

    const body = await req.json().catch(() => ({}));
    const pageSize = body.pageSize === 'A4' ? 'A4' : 'Letter';

    const jobId = await enqueuePdfExport({ dashboardId, orgId, userId, pageSize });

    await audit(orgId, userId, 'export.pdf_requested', `dashboard:${dashboardId}`, {
      metadata: { jobId, pageSize },
    });

    return NextResponse.json({ jobId, status: 'queued' }, { status: 202 });
  } catch (error) {
    const e = error as { message?: string; name?: string };
    return NextResponse.json(
      { error: e.message ?? 'Internal error' },
      { status: e.name === 'ForbiddenError' ? 403 : 500 }
    );
  }
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: dashboardId } = await params;
  const url = new URL(req.url);
  const jobId = url.searchParams.get('jobId');
  const orgId = req.headers.get('x-org-id') || url.searchParams.get('orgId');
  const userId = req.headers.get('x-user-id');

  if (!orgId || !userId) {
    return NextResponse.json(
      { error: 'x-org-id and x-user-id headers required' },
      { status: 400 }
    );
  }

  if (!jobId) {
    return NextResponse.json(
      { error: 'jobId query param required' },
      { status: 400 }
    );
  }

  try {
    await requirePermission(userId, orgId, 'export.pdf');
    const result = await getPdfJobStatus(jobId);

    if (result.status === 'not_found') {
      return NextResponse.json({ status: 'not_found' }, { status: 404 });
    }

    if (result.status === 'failed') {
      await audit(orgId, userId, 'export.pdf_failed', `dashboard:${dashboardId}`, {
        metadata: { jobId, reason: result.reason ?? 'unknown' },
      });
      return NextResponse.json(
        { status: 'failed', reason: result.reason ?? 'unknown' },
        { status: 200 }
      );
    }

    if (result.status === 'completed') {
      await audit(orgId, userId, 'export.pdf_completed', `dashboard:${dashboardId}`, {
        metadata: { jobId, bytes: result.buffer.length },
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
    const e = error as { message?: string; name?: string };
    logger.error({ err: error, jobId }, 'pdf-export: GET failed');
    return NextResponse.json(
      { error: e.message ?? 'Internal error' },
      { status: e.name === 'ForbiddenError' ? 403 : 500 }
    );
  }
}