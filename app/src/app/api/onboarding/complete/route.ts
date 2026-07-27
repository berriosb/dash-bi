import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db, withOrgContext } from '@/db/client';
import { users } from '@/db/schema';
import { requirePermission } from '@/lib/auth/context';

export const dynamic = 'force-dynamic';

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

    await withOrgContext(orgId, userId, async () => {
      await db
        .update(users)
        .set({
          onboardingCompletedAt: new Date(),
          currentOnboardingStep: 'completed',
        })
        .where(eq(users.id, userId));
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