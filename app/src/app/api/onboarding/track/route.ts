import { NextResponse } from 'next/server';
import { z } from 'zod';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const ONBOARDING_STEPS = [
  'welcome',
  'choose_source',
  'prompt',
  'generating',
  'success',
] as const;

const SOURCE_TYPES = ['postgres', 'stripe', 'sheets'] as const;

const EventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('step_completed'),
    step: z.enum(ONBOARDING_STEPS),
    sourceType: z.enum(SOURCE_TYPES).optional(),
    durationMs: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal('completed'),
    totalDurationMs: z.number().int().nonnegative(),
    dashboardGenerated: z.boolean(),
  }),
  z.object({
    type: z.literal('skipped'),
    fromStep: z.enum(ONBOARDING_STEPS),
  }),
  z.object({
    type: z.literal('generation_failed'),
    error: z.string().min(1),
    attempt: z.number().int().nonnegative(),
  }),
]);

/**
 * POST /api/onboarding/track
 *
 * Receives client-side onboarding analytics events and logs them
 * via Pino with structured fields.
 *
 * The endpoint is intentionally forgiving:
 * - 401 when x-user-id is missing (unauthenticated)
 * - 400 on malformed body
 * - 200 with structured log on valid event
 *
 * Failure mode: if logging itself fails, swallow (analytics must
 * never break UX). The caller already fire-and-forgets the fetch.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const userId = req.headers.get('x-user-id');
  if (!userId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const parsed = EventSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_event', issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const event = parsed.data;

  try {
    logger.info(
      {
        event: `onboarding:${event.type}`,
        userId,
        ...event,
      },
      `onboarding ${event.type}`
    );
  } catch {
    // Swallow logging errors — never break UX.
  }

  return NextResponse.json({ ok: true });
}