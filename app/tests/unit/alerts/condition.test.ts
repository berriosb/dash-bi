import { describe, it, expect } from 'vitest';
import { evaluateCondition, conditionThreshold } from '@/lib/alerts/condition';

describe('Alerts Condition Evaluator', () => {
  describe('threshold_above', () => {
    const condition = { kind: 'threshold_above' as const, threshold: 100 };

    it('breaches when value > threshold', () => {
      expect(evaluateCondition(condition, 101).breached).toBe(true);
      expect(evaluateCondition(condition, 1000).breached).toBe(true);
    });

    it('does not breach when value === threshold', () => {
      expect(evaluateCondition(condition, 100).breached).toBe(false);
    });

    it('does not breach when value < threshold', () => {
      expect(evaluateCondition(condition, 99).breached).toBe(false);
      expect(evaluateCondition(condition, 0).breached).toBe(false);
      expect(evaluateCondition(condition, -50).breached).toBe(false);
    });

    it('accepts numeric strings', () => {
      expect(evaluateCondition(condition, '150').breached).toBe(true);
      expect(evaluateCondition(condition, '99').breached).toBe(false);
    });

    it('never breaches on null (missing data is handled elsewhere)', () => {
      expect(evaluateCondition(condition, null).breached).toBe(false);
    });

    it('throws on non-numeric strings', () => {
      expect(() => evaluateCondition(condition, 'abc')).toThrow(/non-numeric/);
    });

    it('reports threshold in result', () => {
      expect(evaluateCondition(condition, 200).threshold).toBe(100);
      expect(evaluateCondition(condition, 50).threshold).toBe(100);
    });
  });

  describe('threshold_below', () => {
    const condition = { kind: 'threshold_below' as const, threshold: 50000 };

    it('breaches when value < threshold', () => {
      expect(evaluateCondition(condition, 49999).breached).toBe(true);
      expect(evaluateCondition(condition, 0).breached).toBe(true);
    });

    it('does not breach when value >= threshold', () => {
      expect(evaluateCondition(condition, 50000).breached).toBe(false);
      expect(evaluateCondition(condition, 100000).breached).toBe(false);
    });

    it('never breaches on null', () => {
      expect(evaluateCondition(condition, null).breached).toBe(false);
    });
  });

  describe('threshold_outside_range', () => {
    const condition = {
      kind: 'threshold_outside_range' as const,
      min: 10,
      max: 100,
    };

    it('breaches when value < min', () => {
      expect(evaluateCondition(condition, 9).breached).toBe(true);
      expect(evaluateCondition(condition, -1).breached).toBe(true);
    });

    it('breaches when value > max', () => {
      expect(evaluateCondition(condition, 101).breached).toBe(true);
      expect(evaluateCondition(condition, 1_000_000).breached).toBe(true);
    });

    it('does not breach when min <= value <= max', () => {
      expect(evaluateCondition(condition, 10).breached).toBe(false);
      expect(evaluateCondition(condition, 55).breached).toBe(false);
      expect(evaluateCondition(condition, 100).breached).toBe(false);
    });

    it('reports threshold as formatted range', () => {
      expect(evaluateCondition(condition, 200).threshold).toBe('10..100');
    });
  });

  describe('equals', () => {
    const condition = { kind: 'equals' as const, value: 0 };

    it('breaches when value === condition value', () => {
      expect(evaluateCondition(condition, 0).breached).toBe(true);
    });

    it('does not breach on any other value (including 0.0)', () => {
      expect(evaluateCondition(condition, 1).breached).toBe(false);
      expect(evaluateCondition(condition, -1).breached).toBe(false);
      expect(evaluateCondition(condition, null).breached).toBe(false);
    });
  });

  describe('missing_data', () => {
    const condition = { kind: 'missing_data' as const, windowMinutes: 30 };

    it('always returns breached: false (handled by worker, not evaluator)', () => {
      expect(evaluateCondition(condition, 0).breached).toBe(false);
      expect(evaluateCondition(condition, 100).breached).toBe(false);
      expect(evaluateCondition(condition, null).breached).toBe(false);
    });

    it('reports windowMinutes as threshold', () => {
      expect(evaluateCondition(condition, 0).threshold).toBe(30);
    });
  });

  describe('conditionThreshold (helper)', () => {
    it('returns the numeric threshold for simple conditions', () => {
      expect(conditionThreshold({ kind: 'threshold_above', threshold: 100 })).toBe(100);
      expect(conditionThreshold({ kind: 'threshold_below', threshold: 50 })).toBe(50);
      expect(conditionThreshold({ kind: 'equals', value: 0 })).toBe(0);
      expect(conditionThreshold({ kind: 'missing_data', windowMinutes: 30 })).toBe(30);
    });

    it('formats ranges as "min..max"', () => {
      expect(
        conditionThreshold({ kind: 'threshold_outside_range', min: 10, max: 100 }),
      ).toBe('10..100');
    });
  });
});
