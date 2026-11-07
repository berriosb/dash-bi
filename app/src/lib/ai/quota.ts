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
 * The env var that overrides a plan's budget.
 *
 * The caps are a COMMERCIAL decision (an enterprise contract may be
 * unlimited), so the operator has to be able to change them without a
 * code change. `0` keeps the "unlimited" meaning of the defaults.
 */
const BUDGET_ENV_VARS: Record<LLMPlan, string> = {
  free: 'LLM_BUDGET_FREE_USD',
  pro: 'LLM_BUDGET_PRO_USD',
  enterprise: 'LLM_BUDGET_ENTERPRISE_USD',
};

/**
 * Resolve the budget for a plan. An unrecognized plan falls back to the
 * `free` cap: a bad value must not silently disable the limit.
 *
 * The env var wins over the default. A malformed or negative override is
 * IGNORED (with a warning): a broken variable must never leave an org
 * without a cap.
 */
export function resolveBudgetUsd(plan: string): number {
  const key: LLMPlan = plan in PLAN_LLM_BUDGET_USD ? (plan as LLMPlan) : 'free';
  const raw = process.env[BUDGET_ENV_VARS[key]];

  if (raw !== undefined && raw.trim() !== '') {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
    logger.warn(
      { plan: key, envVar: BUDGET_ENV_VARS[key] },
      'llm-quota: invalid budget override, using the default',
    );
  }

  return PLAN_LLM_BUDGET_USD[key];
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
export async function getOrgMonthUsage(
  orgId: string,
  userId: string,
  now: Date = new Date(),
): Promise<{ spendUsd: number; requests: number }> {
  const since = monthStart(now);
  const until = now;

  const rows = await withOrgContext(orgId, userId, async (tx) =>
    tx.execute(
      sql`
        SELECT COALESCE(SUM(${llmUsage.costUsd}::numeric), 0)::text AS spend,
               COUNT(*)::int AS requests
        FROM ${llmUsage}
        WHERE ${llmUsage.orgId} = ${orgId}::uuid
          AND ${llmUsage.createdAt} >= ${since.toISOString()}::timestamptz
          AND ${llmUsage.createdAt} <= ${until.toISOString()}::timestamptz
      `,
    ),
  );

  const row = (rows as Array<{ spend?: string | null; requests?: number | null }>)[0];
  const parsed = Number(row?.spend ?? 0);
  const spendUsd = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  const requests = Number(row?.requests ?? 0);
  return { spendUsd, requests: Number.isFinite(requests) ? requests : 0 };
}

/**
 * Total USD this org has spent on LLM calls since the start of the
 * current month.
 */
export async function getOrgMonthSpendUsd(
  orgId: string,
  userId: string,
  now: Date = new Date(),
): Promise<number> {
  return (await getOrgMonthUsage(orgId, userId, now)).spendUsd;
}
