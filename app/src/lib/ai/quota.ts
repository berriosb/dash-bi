/**
 * Cuota de gasto de LLM por organización.
 *
 * El rate limiter (`lib/rate-limit.ts`) acota la FRECUENCIA de llamadas,
 * no el GASTO. Un usuario autenticado puede emitir requests ilimitadas
 * dentro de su cuota y Miles de dólares se van contra la clave BYOK del
 * operador sin ningún freno. Esta tabla es ese freno.
 *
 * Convention: `0` significa "ilimitado", igual que en
 * `lib/observability/llm-quota.ts` (cuyas pruebas ya fijan esa
 * semántica). Se reutiliza el sentinel en vez de inventar otro, para que
 * los dos módulos no puedan discrepar.
 */
import { sql } from 'drizzle-orm';
import { withOrgContext } from '@/db/client';
import { llmUsage } from '@/db/schema';
import { logger } from '@/lib/logger';
import { calculateCostUsd, type LLMUsage } from '@/lib/ai/types';

/** Presupuesto mensual en USD por plan. 0 = ilimitado. */
export const PLAN_LLM_BUDGET_USD = {
  free: 5,
  pro: 50,
  enterprise: 0,
} as const satisfies Record<string, number>;

export type LLMPlan = keyof typeof PLAN_LLM_BUDGET_USD;

export class LLMBudgetExceededError extends Error {
  readonly code = 'llm.budget_exceeded';

  constructor(
    readonly spendUsd: number,
    readonly budgetUsd: number,
  ) {
    super(
      `Monthly LLM budget exceeded: spent $${spendUsd.toFixed(2)} of $${budgetUsd.toFixed(2)}`,
    );
    this.name = 'LLMBudgetExceededError';
  }
}

/**
 * Resolve the budget for a plan. An unrecognized plan falls back to the
 * `free` cap: a bad value must not silently disable the limit.
 */
export function resolveBudgetUsd(plan: string): number {
  if (plan in PLAN_LLM_BUDGET_USD) {
    return PLAN_LLM_BUDGET_USD[plan as LLMPlan];
  }
  return PLAN_LLM_BUDGET_USD.free;
}

/**
 * True when the month's spend has reached the cap.
 *
 * A budget of 0 (or negative) means unlimited — self-hosted installs
 * that deliberately opt out of quotas.
 */
export function isOverBudget(spendUsd: number, budgetUsd: number): boolean {
  if (!Number.isFinite(spendUsd) || spendUsd < 0) return false;
  if (!Number.isFinite(budgetUsd) || budgetUsd <= 0) return false;
  return spendUsd >= budgetUsd;
}

/** Throws `LLMBudgetExceededError` when the cap has been reached. */
export function assertWithinLLMBudget(spendUsd: number, budgetUsd: number): void {
  if (isOverBudget(spendUsd, budgetUsd)) {
    throw new LLMBudgetExceededError(spendUsd, budgetUsd);
  }
}

/** First instant of the month containing `reference`, in UTC. */
export function monthStart(reference: Date = new Date()): Date {
  return new Date(
    Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), 1, 0, 0, 0, 0),
  );
}

/**
 * Total USD this org has spent on LLM calls since the start of the
 * current month.
 *
 * Runs inside `withOrgContext` so the RLS policies scope the aggregate
 * to the caller's org — reading another tenant's spend is as much a leak
 * as reading their dashboards.
 */
export async function getOrgMonthSpendUsd(
  orgId: string,
  userId: string,
  now: Date = new Date(),
): Promise<number> {
  const since = monthStart(now);
  const until = now;

  const rows = await withOrgContext(orgId, userId, async (tx) =>
    tx.execute(
      sql`
        SELECT COALESCE(SUM(${llmUsage.costUsd}::numeric), 0)::text AS spend
        FROM ${llmUsage}
        WHERE ${llmUsage.orgId} = ${orgId}::uuid
          AND ${llmUsage.createdAt} >= ${since.toISOString()}::timestamptz
          AND ${llmUsage.createdAt} <= ${until.toISOString()}::timestamptz
      `,
    ),
  );

  const raw = (rows as Array<{ spend?: string | null }>)[0]?.spend;
  const parsed = Number(raw ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/**
 * Throw if the org has already exhausted its monthly budget. Call this
 * BEFORE invoking the model — once the tokens are spent, a warning is
 * worth nothing.
 */
export async function assertOrgCanSpendLlm(
  orgId: string,
  userId: string,
  plan: string,
  now: Date = new Date(),
): Promise<void> {
  const budget = resolveBudgetUsd(plan);
  // Unlimited plans skip the query entirely.
  if (budget <= 0) return;
  const spend = await getOrgMonthSpendUsd(orgId, userId, now);
  assertWithinLLMBudget(spend, budget);
}

export interface RecordLLMUsageInput {
  orgId: string;
  userId: string | null;
  provider: string;
  model: string;
  usage: LLMUsage | undefined;
  latencyMs?: number;
  success?: boolean;
  error?: string;
}

/**
 * Record one model call in `llm_usage` and raise the observability
 * signal for the org's budget state.
 *
 * Centralizing this means a new AI route cannot forget to bill: it only
 * has to call this. Recording is best-effort — a failure to write the
 * telemetry row must never fail the user's request, since the tokens
 * are already spent either way.
 */
export async function recordLLMUsage(input: RecordLLMUsageInput): Promise<void> {
  const { orgId, userId, provider, model, usage, latencyMs, success = true, error } = input;
  if (!usage) return;

  const costUsd = calculateCostUsd(model, usage.promptTokens, usage.completionTokens);

  try {
    await withOrgContext(orgId, userId, 'admin', async (tx) =>
      tx.insert(llmUsage).values({
        orgId,
        userId,
        provider: provider as never,
        model,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        costUsd,
        latencyMs: latencyMs ?? null,
        success,
        error: error ?? null,
      }),
    );
  } catch (writeError) {
    logger.warn(
      { orgId, model, reason: (writeError as Error).message },
      'llm_usage write failed; spend not recorded',
    );
  }
}
