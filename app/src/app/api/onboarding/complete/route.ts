import { NextResponse } from 'next/server';
import { withSystemContext } from '@/db/client';
import { users } from '@/db/schema';
import { requireAuth } from '@/lib/auth/request';
import { eq } from 'drizzle-orm';
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