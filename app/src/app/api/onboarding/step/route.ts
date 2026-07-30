import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { withSystemContext } from '@/db/client';
import { users } from '@/db/schema';
import { requireAuth } from '@/lib/auth/request';
import { toUserError, getOrGenerateCorrelationId } from '@/lib/errors/to-user-error';
import { statusFromCode } from '@/lib/errors/types';

export const dynamic = 'force-dynamic';

const VALID_STEPS = [
  'welcome',
  'choose_source',
  'prompt',
  'generating',
  'success',
] as const;

const StepBodySchema = z.object({
  step: z.enum(VALID_STEPS),
  dataSourceId: z.string().uuid().optional(),
});

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

    const body = await req.json().catch(() => ({}));
    const parsed = StepBodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid step', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { step, dataSourceId } = parsed.data;

    await withSystemContext(async (tx) => {
      const updates: { currentOnboardingStep: string; onboardingDataSourceId?: string } = {
        currentOnboardingStep: step,
      };
      if (dataSourceId) {
        updates.onboardingDataSourceId = dataSourceId;
      }
      await tx.update(users).set(updates).where(eq(users.id, ctx.userId));
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error, req);
  }
}