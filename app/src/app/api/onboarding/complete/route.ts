import { NextResponse } from 'next/server';
import { errorResponse } from '@/lib/errors/response';
import { withSystemContext } from '@/db/client';
import { users } from '@/db/schema';
import { requireAuth } from '@/lib/auth/request';
import { eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const ctx = await requireAuth(req, 'dashboard.view');

    await withSystemContext(async (tx) =>
      tx.update(users).set({
        onboardingCompletedAt: new Date(),
        currentOnboardingStep: 'completed',
      }).where(eq(users.id, ctx.userId))
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error, req);
  }
}