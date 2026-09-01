import type { AlertCondition } from './types';

export interface ConditionResult {
  breached: boolean;
  value: number | string | null;
  threshold: number | string;
}

/**
 * Evaluate an alert condition against a numeric value.
 *
 * Pure function: no I/O, no side effects, deterministic.
 * Designed to be locked by unit tests at tests/unit/alerts/condition.test.ts.
 *
 * Behavior:
 * - `value === null` never breaches a threshold (data missing is handled
 *   separately via `missing_data` condition kind).
 * - Non-numeric strings throw (caller is responsible for type-checking).
 * - `missing_data` always returns breached: false here; the actual
 *   "no rows in last X minutes" check is done in the worker BEFORE
 *   calling this evaluator.
 */
export function evaluateCondition(
  condition: AlertCondition,
  value: number | string | null,
): ConditionResult {
  if (value === null) {
    return {
      breached: false,
      value,
      threshold: conditionThreshold(condition),
    };
  }

  const numValue = typeof value === 'string' ? parseFloat(value) : value;
  if (Number.isNaN(numValue)) {
    throw new Error(`Cannot evaluate condition on non-numeric value: ${String(value)}`);
  }

  switch (condition.kind) {
    case 'threshold_above':
      return {
        breached: numValue > condition.threshold,
        value,
        threshold: condition.threshold,
      };
    case 'threshold_below':
      return {
        breached: numValue < condition.threshold,
        value,
        threshold: condition.threshold,
      };
    case 'threshold_outside_range':
      return {
        breached: numValue < condition.min || numValue > condition.max,
        value,
        threshold: `${condition.min}..${condition.max}`,
      };
    case 'equals':
      return {
        breached: numValue === condition.value,
        value,
        threshold: condition.value,
      };
    case 'missing_data':
      // The actual data-freshness check happens in the worker.
      // This evaluator is never invoked for `missing_data` because the
      // worker short-circuits before calling evaluateCondition.
      return {
        breached: false,
        value,
        threshold: condition.windowMinutes,
      };
  }
}

/**
 * Return the human-readable threshold for a condition (used for
 * audit metadata and Slack message blocks).
 */
export function conditionThreshold(c: AlertCondition): number | string {
  switch (c.kind) {
    case 'threshold_above':
    case 'threshold_below':
      return c.threshold;
    case 'threshold_outside_range':
      return `${c.min}..${c.max}`;
    case 'equals':
      return c.value;
    case 'missing_data':
      return c.windowMinutes;
  }
}
