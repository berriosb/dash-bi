import { NextResponse } from 'next/server';
import { errorResponse } from '@/lib/errors/response';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { withSystemContext } from '@/db/client';
import { users } from '@/db/schema';
import { requireAuth } from '@/lib/auth/request';

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