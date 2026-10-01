import { NextResponse } from 'next/server';
import { errorResponse } from '@/lib/errors/response';
import { getOnboardingResumePath } from '@/lib/onboarding/resume';
import { requireAuth } from '@/lib/auth/request';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const ctx = await requireAuth(req, 'dashboard.view');
    const resumePath = await getOnboardingResumePath(ctx.userId);
    return NextResponse.json({ resumePath });
  } catch (error) {
    return errorResponse(error, req);
  }
}