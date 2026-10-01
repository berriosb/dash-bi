import { NextResponse } from 'next/server';
import { errorResponse } from '@/lib/errors/response';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth/request';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const ONBOARDING_STEPS = [
  'welcome',
  'choose_source',
  'prompt',
  'generating',
  'success',
] as const;

const SOURCE_TYPES = ['postgres', 'stripe', 'sheets', 'demo'] as const;

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

export async function POST(req: Request): Promise<NextResponse> {
  try {
    const ctx = await requireAuth(req, 'dashboard.view');

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
        { status: 400 },
      );
    }

    const event = parsed.data;

    try {
      logger.info(
        {
          event: `onboarding:${event.type}`,
          userId: ctx.userId,
          ...event,
        },
        `onboarding ${event.type}`,
      );
    } catch {
      // Swallow logging errors — never break UX.
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error, req);
  }
}