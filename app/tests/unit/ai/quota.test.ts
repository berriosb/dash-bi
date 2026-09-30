import { describe, it, expect } from 'vitest';
import {
  PLAN_LLM_BUDGET_USD,
  resolveBudgetUsd,
  isOverBudget,
  assertWithinLLMBudget,
  LLMBudgetExceededError,
} from '@/lib/ai/quota';

/**
 * Cuota de gasto de LLM por organización.
 *
 * Sin esto, un usuario autenticado puede generar costo ilimitado contra
 * la clave BYOK del operador: el rate limit acota la FRECUENCIA pero no
 * el GASTO, y una org con tráfico alto no tiene ningún freno.
 *
 * Pure functions only — la lectura del gasto mensual contra la DB va en
 * `getOrgMonthSpendUsd` y se prueba con el helper de org context.
 */
describe('LLM budget quota', () => {
  describe('PLAN_LLM_BUDGET_USD', () => {
    it('define a budget for every plan', () => {
      expect(Object.keys(PLAN_LLM_BUDGET_USD).sort()).toEqual([
        'enterprise',
        'free',
        'pro',
      ]);
    });

    it('uses 0 to mean unlimited, matching the evaluateLLMQuota convention', () => {
      // 0 is already treated as "unlimited" in lib/observability/llm-quota.ts
      // (self-hosted installs that do not enforce quotas). Reusing the
      // sentinel keeps the two modules consistent.
      expect(PLAN_LLM_BUDGET_USD.enterprise).toBe(0);
    });

    it('never lets a paid plan cost more than the tier below it', () => {
      expect(PLAN_LLM_BUDGET_USD.pro).toBeGreaterThan(PLAN_LLM_BUDGET_USD.free);
    });
  });

  describe('resolveBudgetUsd', () => {
    it('returns the plan budget', () => {
      expect(resolveBudgetUsd('free')).toBe(PLAN_LLM_BUDGET_USD.free);
      expect(resolveBudgetUsd('pro')).toBe(PLAN_LLM_BUDGET_USD.pro);
    });

    it('returns 0 (unlimited) for enterprise', () => {
      expect(resolveBudgetUsd('enterprise')).toBe(0);
    });

    it('falls back to the free budget for an unknown plan', () => {
      // A bad value must not silently disable the cap.
      expect(resolveBudgetUsd('platinum' as never)).toBe(PLAN_LLM_BUDGET_USD.free);
    });
  });

  describe('isOverBudget', () => {
    it('is false when spend is under the budget', () => {
      expect(isOverBudget(4.99, 5)).toBe(false);
    });

    it('is true once spend reaches the budget', () => {
      expect(isOverBudget(5, 5)).toBe(true);
    });

    it('is true when spend exceeds the budget', () => {
      expect(isOverBudget(12.4, 5)).toBe(true);
    });

    it('is never true for an unlimited budget', () => {
      expect(isOverBudget(1_000_000, 0)).toBe(false);
    });

    it('is never true for a negative budget (defensive: unlimited)', () => {
      expect(isOverBudget(500, -1)).toBe(false);
    });
  });

  describe('assertWithinLLMBudget', () => {
    it('does not throw while under the budget', () => {
      expect(() => assertWithinLLMBudget(1, 5)).not.toThrow();
    });

    it('throws LLMBudgetExceededError once over', () => {
      expect(() => assertWithinLLMBudget(6, 5)).toThrow(LLMBudgetExceededError);
    });

    it('never throws for an unlimited budget', () => {
      expect(() => assertWithinLLMBudget(999_999, 0)).not.toThrow();
    });

    it('reports the spend and the cap so the operator can act on it', () => {
      let message = '';
      try {
        assertWithinLLMBudget(6.25, 5);
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toContain('6.25');
      expect(message).toContain('5');
    });
  });
});
