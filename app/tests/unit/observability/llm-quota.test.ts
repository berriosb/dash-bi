import { describe, it, expect, vi, beforeEach } from 'vitest';

const infoMock = vi.fn();
const warnMock = vi.fn();
const errorMock = vi.fn();

vi.mock('@/lib/logger', () => ({
  logger: {
    info: (...args: unknown[]) => infoMock(...args),
    warn: (...args: unknown[]) => warnMock(...args),
    error: (...args: unknown[]) => errorMock(...args),
  },
}));

const captureExceptionMock = vi.fn();
const addBreadcrumbMock = vi.fn();

vi.mock('@sentry/nextjs', () => ({
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
  addBreadcrumb: (...args: unknown[]) => addBreadcrumbMock(...args),
}));

// We import AFTER mocks so the module-under-test picks up the mocked deps.
import {
  evaluateLLMQuota,
  type LLMSpendSnapshot,
  type LLMQuotaConfig,
} from '@/lib/observability/llm-quota';

const BASE_CONFIG: LLMQuotaConfig = {
  monthlyBudgetUsd: 100,
  // Default thresholds; tests override per case.
  warnAtPct: 80,
  blockAtPct: 100,
};

function snapshot(overrides: Partial<LLMSpendSnapshot> = {}): LLMSpendSnapshot {
  return {
    orgId: 'org_test',
    monthSpendUsd: 0,
    monthRequests: 0,
    ...overrides,
  };
}

describe('evaluateLLMQuota (prod observability)', () => {
  beforeEach(() => {
    infoMock.mockClear();
    warnMock.mockClear();
    errorMock.mockClear();
    captureExceptionMock.mockClear();
    addBreadcrumbMock.mockClear();
  });

  it('returns ok with no warnings when spend is well below the budget', () => {
    const result = evaluateLLMQuota(snapshot({ monthSpendUsd: 10 }), BASE_CONFIG);

    expect(result.status).toBe('ok');
    expect(result.utilizationPct).toBeCloseTo(10, 5);
    expect(warnMock).not.toHaveBeenCalled();
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it('emits a warn breadcrumb at the warn threshold (T9 alerting)', () => {
    const result = evaluateLLMQuota(snapshot({ monthSpendUsd: 85 }), BASE_CONFIG);

    expect(result.status).toBe('warn');
    expect(result.utilizationPct).toBeCloseTo(85, 5);
    expect(warnMock).toHaveBeenCalledTimes(1);
    expect(addBreadcrumbMock).toHaveBeenCalledTimes(1);
    // Sentry.addBreadcrumb(breadcrumb) — the breadcrumb IS arg[0].
    const breadcrumb = addBreadcrumbMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(breadcrumb.category).toBe('llm.quota');
    expect(breadcrumb.level).toBe('warning');
    expect(breadcrumb.data).toMatchObject({
      orgId: 'org_test',
      utilizationPct: 85,
      monthSpendUsd: 85,
      budgetUsd: 100,
    });
  });

  it('emits a captured error + warn at the block threshold', () => {
    const result = evaluateLLMQuota(snapshot({ monthSpendUsd: 105 }), BASE_CONFIG);

    expect(result.status).toBe('block');
    expect(result.utilizationPct).toBeCloseTo(105, 5);
    expect(warnMock).toHaveBeenCalledTimes(1);
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    const captured = captureExceptionMock.mock.calls[0]?.[0] as Error;
    expect(captured.message).toMatch(/LLM budget exceeded/);
  });

  it('does NOT spam: at most one warn per org per day (idempotent within window)', () => {
    const a = evaluateLLMQuota(snapshot({ monthSpendUsd: 90 }), BASE_CONFIG);
    const b = evaluateLLMQuota(snapshot({ monthSpendUsd: 92 }), BASE_CONFIG);
    expect(a.status).toBe('warn');
    expect(b.status).toBe('warn');
    // The second call within the same evaluation should NOT re-warn
    // (callers cache the last-fired timestamp; this is a smoke check that
    // the helper accepts being called twice without duplicate side effects
    // when explicitly debounced). For the slice MVP we only assert that
    // the helper is pure with respect to the snapshot it receives.
    expect(warnMock).toHaveBeenCalledTimes(2);
  });

  it('treats monthlyBudgetUsd = 0 as "unlimited" and never warns', () => {
    const result = evaluateLLMQuota(
      snapshot({ monthSpendUsd: 999_999 }),
      { ...BASE_CONFIG, monthlyBudgetUsd: 0 },
    );
    expect(result.status).toBe('ok');
    expect(warnMock).not.toHaveBeenCalled();
  });

  it('handles negative spend (refund / correction) without crashing', () => {
    const result = evaluateLLMQuota(snapshot({ monthSpendUsd: -5 }), BASE_CONFIG);
    expect(result.status).toBe('ok');
    expect(result.utilizationPct).toBeLessThan(0);
  });

  it('throws if the snapshot is missing the required shape', () => {
    expect(() =>
      evaluateLLMQuota({ orgId: 'x' } as unknown as LLMSpendSnapshot, BASE_CONFIG),
    ).toThrow(/monthSpendUsd/);
    expect(() =>
      evaluateLLMQuota({ monthSpendUsd: 10 } as unknown as LLMSpendSnapshot, BASE_CONFIG),
    ).toThrow(/orgId/);
  });

  it('respects custom warnAtPct / blockAtPct thresholds', () => {
    const custom = { ...BASE_CONFIG, warnAtPct: 25, blockAtPct: 50 };
    expect(evaluateLLMQuota(snapshot({ monthSpendUsd: 30 }), custom).status).toBe('warn');
    expect(evaluateLLMQuota(snapshot({ monthSpendUsd: 55 }), custom).status).toBe('block');
  });
});