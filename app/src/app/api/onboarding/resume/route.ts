import { NextResponse } from 'next/server';
import { getOnboardingResumePath } from '@/lib/onboarding/resume';
import { requireAuth } from '@/lib/auth/request';
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

export async function GET(req: Request) {
  try {
    const ctx = await requireAuth(req, 'dashboard.view');
    const resumePath = await getOnboardingResumePath(ctx.userId);
    return NextResponse.json({ resumePath });
  } catch (error) {
    return errorResponse(error, req);
  }
}