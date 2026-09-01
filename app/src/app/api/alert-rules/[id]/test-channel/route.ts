import { NextResponse } from 'next/server';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod';
import { withOrgContext } from '@/db/client';
import { alertRules } from '@/db/schema';
import { requireAuth } from '@/lib/auth/request';
import { getOrGenerateCorrelationId, toUserError } from '@/lib/errors/to-user-error';
import { statusFromCode } from '@/lib/errors/types';
import { decryptApiKey } from '@/lib/security/encryption';
import { deliverToChannel } from '@/lib/alerts/channels';
import type { AlertCondition, AlertChannelConfig } from '@/lib/alerts/types';

/**
 * POST /api/alert-rules/[id]/test-channel — manually trigger delivery
 * of an alert to a single channel. Useful for verifying webhook URLs
 * and Slack setup without waiting for the next eval cycle.
 *
 * Body: { channelIndex: number }
 *
 * Spec: spec/alerts.md §4.3
 */
const bodySchema = z.object({
  channelIndex: z.number().int().min(0),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const correlationId = getOrGenerateCorrelationId(req);
  try {
    const { orgId, userId } = await requireAuth(req, 'dashboard.alert');

    const body = await req.json();
    const { channelIndex } = bodySchema.parse(body);

    const rule = await withOrgContext(orgId, userId, async (tx) => {
      const rows = await tx
        .select()
        .from(alertRules)
        .where(and(eq(alertRules.id, id), eq(alertRules.orgId, orgId)))
        .limit(1);
      return rows[0];
    });

    if (!rule) {
      const err = new Error('Alert rule not found');
      (err as Error & { code: string }).code = 'alert.not_found';
      throw err;
    }

    const channels = rule.channels as AlertChannelConfig[];
    const channel = channels[channelIndex];
    if (!channel) {
      const err = new Error(`Channel index ${channelIndex} inválido`);
      (err as Error & { code: string }).code = 'validation.invalid_format';
      throw err;
    }

    const decrypted = decryptChannel(channel);

    // Send a synthetic test payload (value=42, threshold from condition)
    const result = await deliverToChannel({
      channel: decrypted,
      ruleName: `[TEST] ${rule.name}`,
      dashboardTitle: '(test delivery)',
      condition: rule.condition as AlertCondition,
      breachedValue: 42,
      correlationId: `test_${correlationId}`,
      firedAt: new Date(),
    });

    return NextResponse.json({ result });
  } catch (err: unknown) {
    const appError = toUserError(err, correlationId);
    return NextResponse.json(appError, { status: statusFromCode(appError.code) });
  }
}

function decryptChannel(channel: AlertChannelConfig): AlertChannelConfig {
  try {
    if (channel.type === 'slack') {
      return { ...channel, webhookUrl: decryptApiKey(channel.webhookUrl) };
    }
    if (channel.type === 'webhook') {
      return { ...channel, url: decryptApiKey(channel.url) };
    }
    return channel;
  } catch {
    // In dev/test data may not actually be encrypted; fall back.
    return channel;
  }
}