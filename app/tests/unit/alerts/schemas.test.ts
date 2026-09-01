/**
 * Tests for the Zod schemas + quota helpers + ensureLimit injection.
 */
import { describe, it, expect } from 'vitest';
import {
  AlertConditionSchema,
  AlertChannelConfigSchema,
  CreateAlertRuleSchema,
  ensureLimit,
  assertWithinQuota,
  assertConditionInvariants,
} from '@/lib/alerts/schemas';

describe('Alerts Zod schemas', () => {
  describe('AlertConditionSchema', () => {
    it('accepts all 5 condition kinds', () => {
      expect(AlertConditionSchema.safeParse({ kind: 'threshold_above', threshold: 100 }).success).toBe(true);
      expect(AlertConditionSchema.safeParse({ kind: 'threshold_below', threshold: 50 }).success).toBe(true);
      expect(AlertConditionSchema.safeParse({ kind: 'threshold_outside_range', min: 10, max: 100 }).success).toBe(true);
      expect(AlertConditionSchema.safeParse({ kind: 'equals', value: 0 }).success).toBe(true);
      expect(AlertConditionSchema.safeParse({ kind: 'missing_data', windowMinutes: 30 }).success).toBe(true);
    });

    it('rejects invalid min/max in threshold_outside_range', () => {
      const result = AlertConditionSchema.safeParse({ kind: 'threshold_outside_range', min: 100, max: 10 });
      // discriminatedUnion accepts the schema (no built-in min<max constraint);
      // the API route layer enforces min < max via assertConditionInvariants.
      expect(result.success).toBe(true);
      if (result.success) {
        expect(() => assertConditionInvariants(result.data as never)).toThrow(/min debe ser menor que max/);
      }
    });

    it('rejects unknown kind', () => {
      const result = AlertConditionSchema.safeParse({ kind: 'unknown', threshold: 100 });
      expect(result.success).toBe(false);
    });
  });

  describe('AlertChannelConfigSchema', () => {
    it('accepts Slack channel with hooks.slack.com URL', () => {
      expect(
        AlertChannelConfigSchema.safeParse({
          type: 'slack',
          webhookUrl: 'https://hooks.slack.com/services/T00/B00/abc',
          channelLabel: '#alerts',
        }).success,
      ).toBe(true);
    });

    it('rejects non-Slack webhook URL', () => {
      const result = AlertChannelConfigSchema.safeParse({
        type: 'slack',
        webhookUrl: 'https://evil.example.com/webhook',
        channelLabel: '#alerts',
      });
      expect(result.success).toBe(false);
    });

    it('accepts email channel with 1-10 recipients', () => {
      expect(
        AlertChannelConfigSchema.safeParse({
          type: 'email',
          recipients: ['a@example.com'],
          subject: 'Test',
        }).success,
      ).toBe(true);
    });

    it('rejects email with 0 or >10 recipients', () => {
      expect(
        AlertChannelConfigSchema.safeParse({
          type: 'email',
          recipients: [],
          subject: 'Test',
        }).success,
      ).toBe(false);
      expect(
        AlertChannelConfigSchema.safeParse({
          type: 'email',
          recipients: Array(11).fill('a@example.com'),
          subject: 'Test',
        }).success,
      ).toBe(false);
    });

    it('accepts custom webhook with optional headers', () => {
      expect(
        AlertChannelConfigSchema.safeParse({
          type: 'webhook',
          url: 'https://example.com/hook',
        }).success,
      ).toBe(true);
      expect(
        AlertChannelConfigSchema.safeParse({
          type: 'webhook',
          url: 'https://example.com/hook',
          headers: { Authorization: 'Bearer xxx' },
        }).success,
      ).toBe(true);
    });

    it('rejects invalid email addresses', () => {
      const result = AlertChannelConfigSchema.safeParse({
        type: 'email',
        recipients: ['not-an-email'],
        subject: 'Test',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('CreateAlertRuleSchema', () => {
    const validRule = {
      name: 'Revenue bajo',
      querySql: 'SELECT SUM(amount) AS revenue FROM orders',
      queryColumns: { value: 'revenue' },
      condition: { kind: 'threshold_below', threshold: 50000 },
      evaluationIntervalMinutes: 5,
      consecutiveBreachesToFire: 2,
      channels: [
        { type: 'slack', webhookUrl: 'https://hooks.slack.com/services/T00/B00/abc', channelLabel: '#alerts' },
      ],
      cooldownMinutes: 60,
    };

    it('accepts a fully-valid payload', () => {
      expect(CreateAlertRuleSchema.safeParse(validRule).success).toBe(true);
    });

    it('requires at least 1 channel', () => {
      const result = CreateAlertRuleSchema.safeParse({ ...validRule, channels: [] });
      expect(result.success).toBe(false);
    });

    it('rejects empty name', () => {
      const result = CreateAlertRuleSchema.safeParse({ ...validRule, name: '' });
      expect(result.success).toBe(false);
    });

    it('rejects evaluationIntervalMinutes outside 1-1440', () => {
      expect(
        CreateAlertRuleSchema.safeParse({ ...validRule, evaluationIntervalMinutes: 0 }).success,
      ).toBe(false);
      expect(
        CreateAlertRuleSchema.safeParse({ ...validRule, evaluationIntervalMinutes: 1441 }).success,
      ).toBe(false);
    });

    it('rejects consecutiveBreachesToFire outside 1-10', () => {
      expect(
        CreateAlertRuleSchema.safeParse({ ...validRule, consecutiveBreachesToFire: 0 }).success,
      ).toBe(false);
      expect(
        CreateAlertRuleSchema.safeParse({ ...validRule, consecutiveBreachesToFire: 11 }).success,
      ).toBe(false);
    });
  });

  describe('ensureLimit', () => {
    it('appends LIMIT 1 when missing', () => {
      expect(ensureLimit('SELECT 1')).toBe('SELECT 1 LIMIT 1');
      expect(ensureLimit('SELECT * FROM orders')).toBe('SELECT * FROM orders LIMIT 1');
    });

    it('does not modify queries that already have LIMIT', () => {
      expect(ensureLimit('SELECT * FROM orders LIMIT 5')).toBe('SELECT * FROM orders LIMIT 5');
      expect(ensureLimit('SELECT 1 LIMIT 1')).toBe('SELECT 1 LIMIT 1');
    });

    it('strips trailing semicolon before appending LIMIT', () => {
      expect(ensureLimit('SELECT 1;')).toBe('SELECT 1 LIMIT 1');
      expect(ensureLimit('SELECT * FROM t;  ')).toBe('SELECT * FROM t LIMIT 1');
    });
  });

  describe('assertWithinQuota', () => {
    it('allows when below limit', () => {
      expect(() => assertWithinQuota({ plan: 'free', currentRuleCount: 2 })).not.toThrow();
    });

    it('rejects when at free plan limit (3)', () => {
      expect(() => assertWithinQuota({ plan: 'free', currentRuleCount: 3 })).toThrow(/Máximo 3/);
      expect(() => assertWithinQuota({ plan: 'free', currentRuleCount: 5 })).toThrow(/Máximo 3/);
    });

    it('allows pro plan up to 30', () => {
      expect(() => assertWithinQuota({ plan: 'pro', currentRuleCount: 29 })).not.toThrow();
      expect(() => assertWithinQuota({ plan: 'pro', currentRuleCount: 30 })).toThrow(/Máximo 30/);
    });

    it('does not enforce limit on enterprise plan (-1 = unlimited)', () => {
      expect(() => assertWithinQuota({ plan: 'enterprise', currentRuleCount: 1000 })).not.toThrow();
    });
  });
});
