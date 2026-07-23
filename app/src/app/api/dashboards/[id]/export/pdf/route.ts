import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/context';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(req.url);
  const orgId = req.headers.get('x-org-id') || url.searchParams.get('orgId');
  const userId = req.headers.get('x-user-id');

  if (!orgId || !userId) {
    return NextResponse.json({ error: 'x-org-id and x-user-id headers required' }, { status: 400 });
  }

  try {
    await requirePermission(userId, orgId, 'export.pdf');
    const body = await req.json().catch(() => ({}));
    const pageSize = body.pageSize ?? 'Letter';

    const jobId = `pdf_job_${id}_${Date.now()}`;

    return NextResponse.json({ jobId, status: 'queued', pageSize }, { status: 202 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: error.name === 'ForbiddenError' ? 403 : 500 });
  }
}
