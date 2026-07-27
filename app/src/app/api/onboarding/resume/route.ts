import { NextResponse } from 'next/server';
import { getOnboardingResumePath } from '@/lib/onboarding/resume';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const userId = req.headers.get('x-user-id');
  if (!userId) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const resumePath = await getOnboardingResumePath(userId);
  return NextResponse.json({ resumePath });
}