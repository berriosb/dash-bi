import { sql } from 'drizzle-orm';
import { eq } from 'drizzle-orm';
import { withOrgContext } from '@/db/client';
import { llmBudgetReservations, llmUsage } from '@/db/schema';
import { logger } from '@/lib/logger';
import { calculateCostUsd, type LLMUsage } from '@/lib/ai/types';
import { LLMBudgetExceededError, monthStart, resolveBudgetUsd } from '@/lib/ai/quota';
import { evaluateLLMQuota } from '@/lib/observability/llm-quota';

/**
 * The budget LEDGER.
 *
 * The gate used to be a CHECK: it read the month's spend, compared it
 * with the cap and returned. The spend was recorded AFTER the model
 * call, so N calls that started at the same time all read the SAME
 * spend, all passed, and all spent. Between the check and the record
 * was the whole burst — the check-then-spend gap.
 *
 * A RESERVATION is what a call commits before it starts. The next
 * caller sees it, so the burst has something to run into. When the call
 * finishes, the reservation is settled with the real cost, and the real
 * cost lands in `llm_usage` in the SAME transaction: the money is never
 * counted twice, and the estimate only exists while the call is in
 * flight.
 *
 * The check and the reservation are one atomic step. Without that, two
 * transactions could both read "spend = 0" and both reserve. The
 * advisory lock per org is what serializes them.
 */
export interface LlmBudgetReservation {
  /** The reservation row. Empty for a plan with no limit: there is nothing to reserve. */
  readonly id: string;
  /**
   * Close the reservation with the real cost, and record the spend.
   *
   * Best-effort: the tokens are already spent, so a failure to write
   * must not fail the user's request. A reservation that is never
   * settled stops counting on its own after `RESERVATION_TTL_MINUTES`.
   */
  settle(
    usage: LLMUsage | undefined,
    meta: { latencyMs?: number; success: boolean; error?: string },
  ): Promise<void>;
}

/**
 * What a call is assumed to cost while it is in flight.
 *
 * The estimate has to be an UPPER BOUND for the burst to be bounded: if
 * it were lower than the real cost, the org could spend more than its
 * cap by spending many calls at once.
 *
 * The gateway's outputs are structured (a Zod schema), so their size is
 * bounded by the schema and not by the model's whim. These two numbers
 * are the worst case for the shapes the app generates: a schema plus a
 * prompt on the way in, a dashboard or an answer on the way out.
 *
 * They are deliberately generous: over-reserving blocks a burst a
 * little early, under-reserving lets the burst through. The error is
 * paid by the burst, not by the steady state — a settled call costs
 * what it actually cost.
 */
export const RESERVATION_PROMPT_TOKENS = 4000;
export const RESERVATION_COMPLETION_TOKENS = 4000;

/**
 * How long a reservation counts if the call never settles.
 *
 * A call that dies without settling (the process is killed, the
 * provider hangs) would otherwise hold its estimate forever. The
 * estimate is an upper bound, so releasing it late is the safe
 * direction: the money was not spent, or it was spent and the spend
 * was recorded anyway.
 *
 * It has to be comfortably longer than a model call: a reservation that
 * expires while its call is still running would let the burst through.
 */
export const RESERVATION_TTL_MINUTES = 15;

/** What a call is assumed to cost, in USD. */
export function estimateReservationUsd(model: string): number {
  return Number(
    calculateCostUsd(model, RESERVATION_PROMPT_TOKENS, RESERVATION_COMPLETION_TOKENS),
  );
}

/**
 * Reserve the budget for one model call.
 *
 * Throws `LLMBudgetExceededError` when the call does not fit in what is
 * left of the monthly budget.
 *
 * The caller MUST settle the reservation when the call finishes.
 */
export async function reserveLlmBudget(input: {
  orgId: string;
  userId: string | null;
  plan: string;
  provider: string;
  model: string;
}): Promise<LlmBudgetReservation> {
  const budget = resolveBudgetUsd(input.plan);
  const reservedUsd = calculateCostUsd(
    input.model,
    RESERVATION_PROMPT_TOKENS,
    RESERVATION_COMPLETION_TOKENS,
  );

  let reservationId: string | null = null;

  // A plan with no limit has nothing to reserve. The spend is still
  // recorded — the usage panel shows the consumption of every plan.
  if (budget > 0) {
    const since = monthStart();
    // A reservation that stopped counting: the call it belonged to is
    // gone, and holding its estimate forever would lock the org out.
    const expiryCutoff = new Date(Date.now() - RESERVATION_TTL_MINUTES * 60_000);

    reservationId = await withOrgContext(input.orgId, input.userId, 'admin', async (tx) => {
      // Serializes the check and the reservation for this org. Without
      // it, two transactions can both read "spend = 0" and both
      // reserve: the check-then-spend gap, with extra steps.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${input.orgId}))`);

      const rows = await tx.execute(sql`
        WITH settled AS (
          SELECT COALESCE(SUM(${llmUsage.costUsd}::numeric), 0) AS usd,
                 COUNT(*)::int AS requests
          FROM ${llmUsage}
          WHERE ${llmUsage.orgId} = ${input.orgId}::uuid
            AND ${llmUsage.createdAt} >= ${since.toISOString()}::timestamptz
        ),
        inflight AS (
          SELECT COALESCE(SUM(${llmBudgetReservations.reservedUsd}::numeric), 0) AS usd,
                 COUNT(*)::int AS requests
          FROM ${llmBudgetReservations}
          WHERE ${llmBudgetReservations.orgId} = ${input.orgId}::uuid
            AND ${llmBudgetReservations.status} = 'pending'
            AND ${llmBudgetReservations.createdAt} >= ${since.toISOString()}::timestamptz
            AND ${llmBudgetReservations.createdAt} > ${expiryCutoff.toISOString()}::timestamptz
        )
        SELECT
          (SELECT usd FROM settled) + (SELECT usd FROM inflight) + ${reservedUsd}::numeric AS committed,
          (SELECT requests FROM settled) + (SELECT requests FROM inflight) AS requests,
          ${budget.toString()}::numeric AS budget
      `);

      const row = (rows as Array<{ committed?: string; requests?: number; budget?: string }>)[0];
      const committedUsd = Number(row?.committed ?? 0);
      const requests = Number(row?.requests ?? 0);
      const budgetUsd = Number(row?.budget ?? budget);

      // The SAME evaluation that decides to block also emits the signal:
      // a Sentry breadcrumb at 80% of the budget and a
      // captureException at 100%. The number it gets is the COMMITTED
      // total — what is spent plus what is in flight plus this call's
      // estimate — because that is what the org is actually exposed to.
      const verdict = evaluateLLMQuota(
        { orgId: input.orgId, monthSpendUsd: committedUsd, monthRequests: requests },
        { monthlyBudgetUsd: budgetUsd },
      );

      if (verdict.status === 'block') {
        throw new LLMBudgetExceededError(committedUsd, budgetUsd);
      }

      const [created] = await tx
        .insert(llmBudgetReservations)
        .values({
          orgId: input.orgId,
          userId: input.userId,
          provider: input.provider as never,
          model: input.model,
          reservedUsd,
        })
        .returning({ id: llmBudgetReservations.id });

      if (!created) throw new Error('llm budget reservation was not created');
      return created.id;
    });
  }

  return {
    id: reservationId ?? '',
    settle: async (usage, meta) => {
      const actualUsd = usage
        ? calculateCostUsd(input.model, usage.promptTokens, usage.completionTokens)
        : null;

      try {
        await withOrgContext(input.orgId, input.userId, 'admin', async (tx) => {
          // Settling the reservation and recording the spend in ONE
          // transaction: there is never a moment where both are counted
          // (the money would be counted twice) or neither (the money
          // would not be counted at all).
          if (reservationId) {
            await tx
              .update(llmBudgetReservations)
              .set({
                status: 'settled',
                settledUsd: actualUsd ?? reservedUsd,
                settledAt: new Date(),
              })
              .where(eq(llmBudgetReservations.id, reservationId));
          }

          if (usage) {
            await tx.insert(llmUsage).values({
              orgId: input.orgId,
              userId: input.userId,
              provider: input.provider as never,
              model: input.model,
              promptTokens: usage.promptTokens,
              completionTokens: usage.completionTokens,
              costUsd: actualUsd!,
              latencyMs: meta.latencyMs ?? null,
              success: meta.success,
              error: meta.error ?? null,
            });
          }
        });
      } catch (writeError) {
        // The tokens are already spent: a failed write must not fail the
        // request. The reservation stops counting on its own after the
        // TTL, so the budget is not held hostage by a failed write.
        logger.warn(
          { orgId: input.orgId, model: input.model, reason: (writeError as Error).message },
          'llm budget settlement failed; spend not recorded',
        );
      }
    },
  };
}
