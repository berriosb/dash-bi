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
 *
 * Now the enforcement is a RESERVATION (lib/ai/budget-ledger.ts) instead
 * of a check, and the signal travels with it: the same evaluation that
 * decides to block is the one that emits the warning.
 */
const mockEvaluateLLMQuota = vi.fn();
vi.mock('@/lib/observability/llm-quota', () => ({
  evaluateLLMQuota: (...args: unknown[]) => mockEvaluateLLMQuota(...args),
}));

const inserted: Array<Record<string, unknown>> = [];
const updated: Array<Record<string, unknown>> = [];

const tx = {
  execute: vi.fn(),
  insert: vi.fn(() => ({
    values: vi.fn((values: Record<string, unknown>) => {
      inserted.push(values);
      return {
        returning: vi.fn(async () => [{ id: 'reservation-1' }]),
      };
    }),
  })),
  update: vi.fn(() => ({
    set: vi.fn((values: Record<string, unknown>) => {
      updated.push(values);
      return { where: vi.fn(async () => undefined) };
    }),
  })),
};

vi.mock('@/db/client', () => ({
  // `withOrgContext` has a 3-arg and a 4-arg (role) overload; the
  // callback is always last.
  withOrgContext: vi.fn(async (...args: unknown[]) => {
    const fn = args[args.length - 1] as (t: unknown) => unknown;
    return fn(tx);
  }),
}));

import { reserveLlmBudget, estimateReservationUsd } from '@/lib/ai/budget-ledger';
import { LLMBudgetExceededError } from '@/lib/ai/quota';

const RESERVE = {
  orgId: 'org-1',
  userId: 'user-1',
  plan: 'free',
  provider: 'openai',
  model: 'gpt-4o',
};

describe('ledger de presupuesto — señales y liquidación', () => {
  beforeEach(() => {
    tx.execute.mockReset();
    tx.insert.mockClear();
    tx.update.mockClear();
    inserted.length = 0;
    updated.length = 0;
    mockEvaluateLLMQuota.mockReset();
    tx.execute.mockResolvedValue([{ committed: '1.000000', requests: '3', budget: '5.000000' }]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('consulta el estado del presupuesto (la señal existe)', async () => {
    mockEvaluateLLMQuota.mockReturnValue({ status: 'ok', utilizationPct: 20 });

    await reserveLlmBudget(RESERVE);

    expect(mockEvaluateLLMQuota).toHaveBeenCalledTimes(1);
    const [snapshot, config] = mockEvaluateLLMQuota.mock.calls[0] as [
      { orgId: string; monthSpendUsd: number; monthRequests: number },
      { monthlyBudgetUsd: number },
    ];
    expect(snapshot.orgId).toBe('org-1');
    expect(snapshot.monthSpendUsd).toBe(1);
    expect(snapshot.monthRequests).toBe(3);
    expect(config.monthlyBudgetUsd).toBe(5);
  });

  it('avisa cuando se acerca al tope (warn) pero deja pasar', async () => {
    tx.execute.mockResolvedValue([{ committed: '4.200000', requests: '9', budget: '5.000000' }]);
    mockEvaluateLLMQuota.mockReturnValue({ status: 'warn', utilizationPct: 84 });

    await expect(reserveLlmBudget(RESERVE)).resolves.toBeDefined();
  });

  it('corta cuando el estado es block', async () => {
    tx.execute.mockResolvedValue([{ committed: '5.500000', requests: '12', budget: '5.000000' }]);
    mockEvaluateLLMQuota.mockReturnValue({ status: 'block', utilizationPct: 110 });

    await expect(reserveLlmBudget(RESERVE)).rejects.toBeInstanceOf(LLMBudgetExceededError);
    // Y no queda ninguna reserva colgando: la llamada ni empezó.
    expect(inserted).toHaveLength(0);
  });

  it('no consulta nada para un plan sin tope (enterprise)', async () => {
    mockEvaluateLLMQuota.mockReturnValue({ status: 'ok', utilizationPct: 0 });

    await reserveLlmBudget({ ...RESERVE, plan: 'enterprise' });

    expect(tx.execute).not.toHaveBeenCalled();
    expect(mockEvaluateLLMQuota).not.toHaveBeenCalled();
    expect(inserted).toHaveLength(0);
  });

  it('la reserva se inserta con lo que la llamada se supone que cuesta', async () => {
    mockEvaluateLLMQuota.mockReturnValue({ status: 'ok', utilizationPct: 20 });

    const reservation = await reserveLlmBudget(RESERVE);

    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      orgId: 'org-1',
      userId: 'user-1',
      model: 'gpt-4o',
    });
    expect(Number(inserted[0]?.reservedUsd)).toBeGreaterThan(0);
    expect(reservation.id).toBe('reservation-1');
  });

  it('la liquidación escribe el gasto real y cierra la reserva', async () => {
    mockEvaluateLLMQuota.mockReturnValue({ status: 'ok', utilizationPct: 20 });

    const reservation = await reserveLlmBudget(RESERVE);
    await reservation.settle(
      { promptTokens: 100, completionTokens: 50 },
      { latencyMs: 42, success: true },
    );

    // La reserva queda cerrada...
    expect(updated).toHaveLength(1);
    expect(updated[0]).toMatchObject({ status: 'settled' });
    expect(Number(updated[0]?.settledUsd)).toBeGreaterThan(0);

    // ...y el gasto real queda en `llm_usage`, en la MISMA transacción.
    const usageRows = inserted.filter((row) => 'promptTokens' in row);
    expect(usageRows).toHaveLength(1);
    expect(usageRows[0]).toMatchObject({
      promptTokens: 100,
      completionTokens: 50,
      success: true,
      latencyMs: 42,
    });
  });

  it('una llamada fallida cierra la reserva sin escribir gasto', async () => {
    mockEvaluateLLMQuota.mockReturnValue({ status: 'ok', utilizationPct: 20 });

    const reservation = await reserveLlmBudget(RESERVE);
    await reservation.settle(undefined, { success: false, error: 'boom' });

    expect(updated).toHaveLength(1);
    expect(updated[0]).toMatchObject({ status: 'settled' });
    expect(inserted.filter((row) => 'promptTokens' in row)).toHaveLength(0);
  });

  it('la estimación es un tope, no un promedio', () => {
    // La reserva tiene que ser un TECHO del costo real: si fuera menor,
    // un burst podría gastar más que el presupuesto. Con 4000 tokens de
    // prompt y 4000 de completion, la reserva de gpt-4o es de $0.05.
    expect(estimateReservationUsd('gpt-4o')).toBeGreaterThan(0);
    expect(estimateReservationUsd('gpt-4o')).toBeCloseTo(0.05, 6);
    // Un modelo más barato reserva menos.
    expect(estimateReservationUsd('gpt-4o-mini')).toBeLessThan(
      estimateReservationUsd('gpt-4o'),
    );
  });
});
