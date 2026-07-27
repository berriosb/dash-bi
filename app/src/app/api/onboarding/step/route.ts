import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, withOrgContext } from '@/db/client';
import { users } from '@/db/schema';
import { requirePermission } from '@/lib/auth/context';

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
  const orgId = req.headers.get('x-org-id');
  const userId = req.headers.get('x-user-id');

  if (!orgId || !userId) {
    return NextResponse.json(
      { error: 'x-org-id and x-user-id headers required' },
      { status: 400 }
    );
  }

  try {
    await requirePermission(userId, orgId, 'dashboard.view');

    const body = await req.json().catch(() => ({}));
    const parsed = StepBodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid step', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { step, dataSourceId } = parsed.data;

    await withOrgContext(orgId, userId, async () => {
      const updates: { currentOnboardingStep: string; onboardingDataSourceId?: string } = {
        currentOnboardingStep: step,
      };
      if (dataSourceId) {
        updates.onboardingDataSourceId = dataSourceId;
      }
      await db.update(users).set(updates).where(eq(users.id, userId));
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const e = error as { message?: string; name?: string };
    return NextResponse.json(
      { error: e.message ?? 'Internal error' },
      { status: e.name === 'ForbiddenError' ? 403 : 500 }
    );
  }
}