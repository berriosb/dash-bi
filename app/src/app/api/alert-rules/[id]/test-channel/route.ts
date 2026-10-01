import { NextResponse } from 'next/server';
import { errorResponse } from '@/lib/errors/response';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod';
import { withOrgContext } from '@/db/client';
import { alertRules } from '@/db/schema';
import { requireAuth } from '@/lib/auth/request';
import { getOrGenerateCorrelationId } from '@/lib/errors/to-user-error';
import { checkRateLimit } from '@/lib/rate-limit';
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

/**
 * T9: this route makes an outbound HTTP request, so it is rate limited on two
 * axes. Per org, so one tenant cannot spend a shared allowance; per IP, so a
 * single org with many members cannot route around the org bucket.
 *
 * The numbers are deliberately tighter than the AI routes. An AI call costs
 * money and returns JSON; this one opens a connection to an arbitrary public
 * host chosen by the caller and hands back whatever comes back, which makes it
 * usable as a port scanner and as a DoS reflector. 5/min per org, 15/min per IP.
 */
const TEST_CHANNEL_PER_ORG = { capacity: 5, refillPerSecond: 5 / 60 };
const TEST_CHANNEL_PER_IP = { capacity: 15, refillPerSecond: 15 / 60 };

function getClientIp(req: Request): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const correlationId = getOrGenerateCorrelationId(req);
  try {
    const { orgId, userId } = await requireAuth(req, 'dashboard.alert');

    // Before the DB read, not after: if the check ran later, a throttled
    // caller could still probe which rule ids exist in the org by timing.
    const orgLimit = checkRateLimit({ ...TEST_CHANNEL_PER_ORG, key: `test-channel:org:${orgId}` });
    if (!orgLimit.allowed) {
      return NextResponse.json(
        { error: 'rate_limited', scope: 'org', retryAfterSeconds: orgLimit.retryAfterSeconds },
        { status: 429, headers: { 'Retry-After': String(orgLimit.retryAfterSeconds) } },
      );
    }

    const ipLimit = checkRateLimit({
      ...TEST_CHANNEL_PER_IP,
      key: `test-channel:ip:${getClientIp(req)}`,
    });
    if (!ipLimit.allowed) {
      return NextResponse.json(
        { error: 'rate_limited', scope: 'ip', retryAfterSeconds: ipLimit.retryAfterSeconds },
        { status: 429, headers: { 'Retry-After': String(ipLimit.retryAfterSeconds) } },
      );
    }

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
    return errorResponse(err, req);
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