import { NextResponse } from 'next/server';
import { eq, and, desc } from 'drizzle-orm';
import { withOrgContext } from '@/db/client';
import { alertEvents } from '@/db/schema';
import { requireAuth } from '@/lib/auth/request';
import { getOrGenerateCorrelationId, toUserError } from '@/lib/errors/to-user-error';
import { statusFromCode } from '@/lib/errors/types';

/**
 * GET /api/alert-rules/[id]/events — history of fire events for an alert
 * rule, newest first. RLS-scoped via withOrgContext.
 *
 * Query params:
 *   - limit: number (default 50, max 200)
 *
 * Spec: spec/alerts.md §4.4
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const correlationId = getOrGenerateCorrelationId(req);
  try {
    const { orgId, userId } = await requireAuth(req, 'dashboard.viewAlerts');

    const limitParam = new URL(req.url).searchParams.get('limit');
    const limit = Math.min(200, Math.max(1, Number(limitParam ?? '50') || 50));

    const events = await withOrgContext(orgId, userId, async (tx) => {
      return tx
        .select()
        .from(alertEvents)
        .where(and(eq(alertEvents.alertRuleId, id), eq(alertEvents.orgId, orgId)))
        .orderBy(desc(alertEvents.firedAt))
        .limit(limit);
    });

    return NextResponse.json({ events });
  } catch (err: unknown) {
    const appError = toUserError(err, correlationId);
    return NextResponse.json(appError, { status: statusFromCode(appError.code) });
  }
}