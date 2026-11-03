import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * The quota module had TWO halves that never met: the enforcement
 * (`assertOrgCanSpendLlm`, in lib/ai/quota.ts) and the observability
 * (`evaluateLLMQuota`, in lib/observability/llm-quota.ts).
 *
 * The observability half had NO production caller: the Sentry breadcrumb
 * at 80% of the budget and the captureException at 100% — the "budget
 * alert" the threat model claimed — were never emitted. The threat model
 * even says the query engine calls it "after writing a request": it does
 * not.
 */
const mockEvaluateLLMQuota = vi.fn();
vi.mock('@/lib/observability/llm-quota', () => ({
  evaluateLLMQuota: (...args: unknown[]) => mockEvaluateLLMQuota(...args),
}));

const tx = { execute: vi.fn() };
vi.mock('@/db/client', () => ({
  withOrgContext: vi.fn(async (_orgId: string, _userId: string, fn: (t: unknown) => unknown) =>
    fn(tx),
  ),
}));

import { assertOrgCanSpendLlm, LLMBudgetExceededError } from '@/lib/ai/quota';

describe('assertOrgCanSpendLlm — señales de presupuesto', () => {
  beforeEach(() => {
    tx.execute.mockReset();
    mockEvaluateLLMQuota.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('consulta el estado del presupuesto (la señal existe)', async () => {
    tx.execute.mockResolvedValue([{ spend: '1.000000', requests: '3' }]);
    mockEvaluateLLMQuota.mockReturnValue({ status: 'ok', utilizationPct: 20 });

    await assertOrgCanSpendLlm('org-1', 'user-1', 'free');

    expect(mockEvaluateLLMQuota).toHaveBeenCalledTimes(1);
    const [snapshot, config] = mockEvaluateLLMQuota.mock.calls[0] as [
      { orgId: string; monthSpendUsd: number },
      { monthlyBudgetUsd: number },
    ];
    expect(snapshot.orgId).toBe('org-1');
    expect(snapshot.monthSpendUsd).toBe(1);
    expect(config.monthlyBudgetUsd).toBe(5);
  });

  it('avisa cuando se acerca al tope (warn) pero deja pasar', async () => {
    tx.execute.mockResolvedValue([{ spend: '4.200000', requests: '9' }]);
    mockEvaluateLLMQuota.mockReturnValue({ status: 'warn', utilizationPct: 84 });

    await expect(assertOrgCanSpendLlm('org-1', 'user-1', 'free')).resolves.toBeUndefined();
  });

  it('corta cuando el estado es block', async () => {
    tx.execute.mockResolvedValue([{ spend: '5.500000', requests: '12' }]);
    mockEvaluateLLMQuota.mockReturnValue({ status: 'block', utilizationPct: 110 });

    await expect(assertOrgCanSpendLlm('org-1', 'user-1', 'free')).rejects.toBeInstanceOf(
      LLMBudgetExceededError,
    );
  });

  it('no consulta nada para un plan sin tope (enterprise)', async () => {
    mockEvaluateLLMQuota.mockReturnValue({ status: 'ok', utilizationPct: 0 });

    await assertOrgCanSpendLlm('org-1', 'user-1', 'enterprise');

    expect(tx.execute).not.toHaveBeenCalled();
    expect(mockEvaluateLLMQuota).not.toHaveBeenCalled();
  });
});
