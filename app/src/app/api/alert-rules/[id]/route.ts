import { NextResponse } from 'next/server';
import { eq, and } from 'drizzle-orm';
import { withOrgContext } from '@/db/client';
import { alertRules } from '@/db/schema';
import { requireAuth } from '@/lib/auth/request';
import { audit } from '@/lib/audit/log';
import { getOrGenerateCorrelationId, toUserError } from '@/lib/errors/to-user-error';
import { statusFromCode } from '@/lib/errors/types';
import {
  UpdateAlertRuleSchema,
  ensureLimit,
  assertConditionInvariants,
} from '@/lib/alerts/schemas';
import { validateQuery } from '@/lib/security/validate-query';

/**
 * PATCH /api/alert-rules/[id] — update name/condition/channels/enabled.
 * DELETE /api/alert-rules/[id] — soft delete (sets enabled=false + audit).
 *
 * Spec: spec/alerts.md §4.5
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const correlationId = getOrGenerateCorrelationId(req);
  try {
    const { orgId, userId } = await requireAuth(req, 'dashboard.alert');

    const body = await req.json();
    const validated = UpdateAlertRuleSchema.parse(body);

    if (validated.condition) {
      assertConditionInvariants(validated.condition);
    }

    if (validated.querySql !== undefined) {
      const sqlWithLimit = ensureLimit(validated.querySql, 1);
      validateQuery({ kind: 'sql', sql: sqlWithLimit }, 'postgres');
      validated.querySql = sqlWithLimit;
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (validated.name !== undefined) updates.name = validated.name;
    if (validated.description !== undefined) updates.description = validated.description;
    if (validated.querySql !== undefined) updates.querySql = validated.querySql;
    if (validated.queryColumns !== undefined) updates.queryColumns = validated.queryColumns;
    if (validated.condition !== undefined) updates.condition = validated.condition;
    if (validated.evaluationIntervalMinutes !== undefined) {
      updates.evaluationIntervalMinutes = validated.evaluationIntervalMinutes;
    }
    if (validated.evaluationWindowMinutes !== undefined) {
      updates.evaluationWindowMinutes = validated.evaluationWindowMinutes;
    }
    if (validated.consecutiveBreachesToFire !== undefined) {
      updates.consecutiveBreachesToFire = validated.consecutiveBreachesToFire;
    }
    if (validated.channels !== undefined) updates.channels = validated.channels;
    if (validated.cooldownMinutes !== undefined) {
      updates.cooldownMinutes = validated.cooldownMinutes;
    }
    if (validated.enabled !== undefined) updates.enabled = validated.enabled;

    await withOrgContext(orgId, userId, async (tx) => {
      return tx
        .update(alertRules)
        .set(updates)
        .where(and(eq(alertRules.id, id), eq(alertRules.orgId, orgId)));
    });

    const eventName =
      validated.enabled === false
        ? 'alert.paused'
        : validated.enabled === true
          ? 'alert.resumed'
          : 'alert.updated';

    await audit(orgId, userId, eventName, `alert_rule:${id}`, {
      req,
      metadata: { correlationId },
    });

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const appError = toUserError(err, correlationId);
    return NextResponse.json(appError, { status: statusFromCode(appError.code) });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const correlationId = getOrGenerateCorrelationId(req);
  try {
    const { orgId, userId } = await requireAuth(req, 'dashboard.alert');

    // Soft delete: keep the row for audit trail, mark disabled.
    // Hard delete is reserved for admin tool / GDPR flows (Fase 2).
    await withOrgContext(orgId, userId, async (tx) => {
      return tx
        .update(alertRules)
        .set({ enabled: false, updatedAt: new Date() })
        .where(and(eq(alertRules.id, id), eq(alertRules.orgId, orgId)));
    });

    await audit(orgId, userId, 'alert.deleted', `alert_rule:${id}`, {
      req,
      metadata: { correlationId },
    });

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const appError = toUserError(err, correlationId);
    return NextResponse.json(appError, { status: statusFromCode(appError.code) });
  }
}
