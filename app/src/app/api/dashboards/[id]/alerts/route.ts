import { NextResponse } from 'next/server';
import { eq, and, desc, count } from 'drizzle-orm';
import { withOrgContext } from '@/db/client';
import { alertRules, orgs } from '@/db/schema';
import { requireAuth } from '@/lib/auth/request';
import { audit } from '@/lib/audit/log';
import { getOrGenerateCorrelationId, toUserError } from '@/lib/errors/to-user-error';
import { statusFromCode } from '@/lib/errors/types';
import {
  CreateAlertRuleSchema,
  ensureLimit,
  assertWithinQuota,
  assertConditionInvariants,
} from '@/lib/alerts/schemas';
import { validateQuery } from '@/lib/security/validate-query';
import { ALERT_LIMITS, type AlertPlan } from '@/lib/alerts/types';

/**
 * POST /api/dashboards/[id]/alerts — create a new alert rule on this dashboard.
 * GET  /api/dashboards/[id]/alerts — list alert rules for this dashboard.
 *
 * Spec: spec/alerts.md §4.1, §4.2
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: dashboardId } = await params;
  const correlationId = getOrGenerateCorrelationId(req);
  try {
    const { orgId, userId } = await requireAuth(req, 'dashboard.alert');

    const body = await req.json();
    const validated = CreateAlertRuleSchema.parse(body);
    assertConditionInvariants(validated.condition);

    // Enforce plan interval minimum
    const org = await withOrgContext(orgId, userId, async (tx) => {
      return tx.select().from(orgs).where(eq(orgs.id, orgId)).limit(1);
    });
    const plan = (org[0]?.plan ?? 'free') as AlertPlan;
    const limits = ALERT_LIMITS[plan];
    if (validated.evaluationIntervalMinutes < limits.minIntervalMinutes) {
      throw new Error(
        `Intervalo mínimo para plan ${plan}: cada ${limits.minIntervalMinutes} minutos.`,
      );
    }

    // Quota check
    const existing = await withOrgContext(orgId, userId, async (tx) => {
      return tx
        .select({ value: count() })
        .from(alertRules)
        .where(and(eq(alertRules.orgId, orgId), eq(alertRules.enabled, true)));
    });
    assertWithinQuota({
      plan,
      currentRuleCount: existing[0]?.value ?? 0,
    });

    // Validate SQL (SELECT-only + LIMIT injection)
    const sqlWithLimit = ensureLimit(validated.querySql, 1);
    validateQuery({ kind: 'sql', sql: sqlWithLimit }, 'postgres');

    const [rule] = await withOrgContext(orgId, userId, async (tx) => {
      return tx
        .insert(alertRules)
        .values({
          orgId,
          dashboardId,
          createdBy: userId,
          name: validated.name,
          description: validated.description ?? null,
          querySql: sqlWithLimit,
          queryColumns: validated.queryColumns,
          condition: validated.condition,
          evaluationIntervalMinutes: validated.evaluationIntervalMinutes,
          evaluationWindowMinutes: validated.evaluationWindowMinutes ?? 5,
          consecutiveBreachesToFire: validated.consecutiveBreachesToFire,
          channels: validated.channels,
          cooldownMinutes: validated.cooldownMinutes,
        })
        .returning();
    });

    if (!rule) {
      throw new Error('Insert returned no row');
    }

    await audit(orgId, userId, 'alert.created', `alert_rule:${rule.id}`, {
      req,
      metadata: { correlationId, name: rule.name, dashboardId },
    });

    return NextResponse.json({ rule }, { status: 201 });
  } catch (err: unknown) {
    const appError = toUserError(err, correlationId);
    return NextResponse.json(appError, { status: statusFromCode(appError.code) });
  }
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: dashboardId } = await params;
  const correlationId = getOrGenerateCorrelationId(req);
  try {
    const { orgId, userId } = await requireAuth(req, 'dashboard.viewAlerts');

    const rules = await withOrgContext(orgId, userId, async (tx) => {
      return tx
        .select()
        .from(alertRules)
        .where(eq(alertRules.dashboardId, dashboardId))
        .orderBy(desc(alertRules.createdAt));
    });

    // Channels are stored encrypted in DB; client should never see raw URLs.
    // Return them as-is (already encrypted) — the client renders a label
    // and "test channel" buttons that re-auth the send.
    return NextResponse.json({ rules });
  } catch (err: unknown) {
    const appError = toUserError(err, correlationId);
    return NextResponse.json(appError, { status: statusFromCode(appError.code) });
  }
}
