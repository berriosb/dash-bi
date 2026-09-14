// LLM quota / cost guardrail (T9 alerting).
//
// The `llm_usage` table records per-request token + cost. The
// query engine / AI gateway calls `evaluateLLMQuota(snapshot, config)`
// after writing a request to surface three states:
//
//   ok     — spend is well under budget; nothing to do
//   warn   — spend is at or above `warnAtPct` of `monthlyBudgetUsd`
//   block  — spend is at or above `blockAtPct` of `monthlyBudgetUsd`
//
// On `warn` we add a Sentry breadcrumb + Pino warn log so an operator
// notices without us having to wire up Sentry alerts. On `block` we
// additionally `captureException` so the budget breach shows up in the
// Sentry issues inbox like any other error.
//
// `monthlyBudgetUsd: 0` is treated as "unlimited" (e.g. self-hosted
// installs that don't enforce quotas). The helper never throws on the
// math path — only on malformed input.

import * as Sentry from '@sentry/nextjs';
import { logger } from '@/lib/logger';

export type LLMSpendSnapshot = {
  orgId: string;
  monthSpendUsd: number;
  monthRequests: number;
};

export type LLMQuotaConfig = {
  monthlyBudgetUsd: number;
  warnAtPct?: number;
  blockAtPct?: number;
};

export type LLMQuotaStatus = 'ok' | 'warn' | 'block';

export type LLMQuotaResult = {
  status: LLMQuotaStatus;
  utilizationPct: number;
};

const DEFAULT_WARN_AT_PCT = 80;
const DEFAULT_BLOCK_AT_PCT = 100;

export function evaluateLLMQuota(
  snapshot: LLMSpendSnapshot,
  config: LLMQuotaConfig,
): LLMQuotaResult {
  if (!snapshot || typeof snapshot.orgId !== 'string' || snapshot.orgId.length === 0) {
    throw new Error('evaluateLLMQuota: snapshot.orgId is required');
  }
  if (typeof snapshot.monthSpendUsd !== 'number' || !Number.isFinite(snapshot.monthSpendUsd)) {
    throw new Error('evaluateLLMQuota: snapshot.monthSpendUsd must be a finite number');
  }

  const warnAt = config.warnAtPct ?? DEFAULT_WARN_AT_PCT;
  const blockAt = config.blockAtPct ?? DEFAULT_BLOCK_AT_PCT;

  // Unlimited budget: short-circuit to ok without emitting signals.
  if (config.monthlyBudgetUsd <= 0) {
    return { status: 'ok', utilizationPct: 0 };
  }

  const utilizationPct = (snapshot.monthSpendUsd / config.monthlyBudgetUsd) * 100;

  if (utilizationPct >= blockAt) {
    Sentry.captureException(
      new Error(
        `LLM budget exceeded for org ${snapshot.orgId}: ` +
          `${snapshot.monthSpendUsd.toFixed(2)} / ${config.monthlyBudgetUsd.toFixed(2)} USD ` +
          `(${utilizationPct.toFixed(1)}% >= ${blockAt}% block threshold)`,
      ),
    );
    logger.warn(
      {
        orgId: snapshot.orgId,
        monthSpendUsd: snapshot.monthSpendUsd,
        monthRequests: snapshot.monthRequests,
        budgetUsd: config.monthlyBudgetUsd,
        utilizationPct,
        threshold: blockAt,
      },
      'llm-quota: budget exceeded',
    );
    return { status: 'block', utilizationPct };
  }

  if (utilizationPct >= warnAt) {
    Sentry.addBreadcrumb({
      category: 'llm.quota',
      level: 'warning',
      message: `LLM spend for ${snapshot.orgId} reached ${utilizationPct.toFixed(1)}% of monthly budget`,
      data: {
        orgId: snapshot.orgId,
        monthSpendUsd: snapshot.monthSpendUsd,
        monthRequests: snapshot.monthRequests,
        budgetUsd: config.monthlyBudgetUsd,
        utilizationPct,
        threshold: warnAt,
      },
    });
    logger.warn(
      {
        orgId: snapshot.orgId,
        monthSpendUsd: snapshot.monthSpendUsd,
        monthRequests: snapshot.monthRequests,
        budgetUsd: config.monthlyBudgetUsd,
        utilizationPct,
        threshold: warnAt,
      },
      'llm-quota: approaching budget',
    );
    return { status: 'warn', utilizationPct };
  }

  return { status: 'ok', utilizationPct };
}