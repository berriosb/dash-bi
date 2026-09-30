import { describe, it, expect } from 'vitest';
import {
  assertRolePermissions,
  validateQuery,
  ValidationError,
} from '@/lib/security/validate-query';
import type { Query } from '@/lib/connectors/types';

/**
 * HIGH-1 — the PII filter was a naming-convention filter, and both of its
 * rules were evadable:
 *
 *  - `SENSITIVE_COLUMN_PATTERN` used `\b`, and `\b` does NOT exist between
 *    `_` and a word character. Every snake_case column sailed through:
 *    `user_password`, `customer_ssn`, `billing_tax_id`, `token_type`.
 *  - `WILDCARD_PROJECTION` required the star to be preceded by `[\s,(]`, so a
 *    comment wedged between SELECT and the star hid it (see the commented
 *    wildcard case below).
 *
 * The wildcard cases go through `validateQuery`, the entry point production
 * actually reaches, so they also cover the LIMIT auto-injection that runs
 * after the role check.
 */
describe('PII filter bypasses (HIGH-1)', () => {
  describe('blocks snake_case columns that \b let through', () => {
    it('rejects user_password', () => {
      expect(() => assertRolePermissions('SELECT user_password FROM users', 'viewer')).toThrow(
        ValidationError,
      );
    });

    it('rejects customer_ssn', () => {
      expect(() => assertRolePermissions('SELECT customer_ssn FROM customers', 'viewer')).toThrow(
        /PII/,
      );
    });

    it('rejects billing_tax_id', () => {
      expect(() =>
        assertRolePermissions('SELECT billing_tax_id FROM invoices', 'viewer'),
      ).toThrow(/PII/);
    });

    it('rejects token_type', () => {
      expect(() => assertRolePermissions('SELECT token_type FROM sessions', 'viewer')).toThrow(
        /PII/,
      );
    });

    it('rejects an upper-case sensitive column', () => {
      expect(() => assertRolePermissions('SELECT PASSWORD FROM users', 'viewer')).toThrow(
        /PII/,
      );
    });
  });

  describe('blocks a wildcard hidden behind a comment', () => {
    it('rejects SELECT/*x*/* via validateQuery', () => {
      const q: Query = { kind: 'sql', sql: 'SELECT/*x*/* FROM users' };
      expect(() => validateQuery(q, 'postgres', 'viewer')).toThrow(/wildcard projection/i);
    });

    it('rejects a wildcard mixed with an aggregate star', () => {
      const q: Query = { kind: 'sql', sql: 'SELECT count(*), u.* FROM users u' };
      expect(() => validateQuery(q, 'postgres', 'viewer')).toThrow(/wildcard projection/i);
    });
  });

  describe('still allows the shapes that are not a bypass', () => {
    it('allows a lowercase count(*)', () => {
      const q: Query = { kind: 'sql', sql: 'SELECT count(*) FROM orders' };
      expect(() => validateQuery(q, 'postgres', 'viewer')).not.toThrow();
    });

    it('allows an upper-case COUNT(*)', () => {
      const q: Query = { kind: 'sql', sql: 'SELECT COUNT(*) FROM orders' };
      expect(() => validateQuery(q, 'postgres', 'viewer')).not.toThrow();
    });

    it('allows an explicit projection with no sensitive column', () => {
      const q: Query = { kind: 'sql', sql: 'SELECT id, name, created_at FROM users' };
      expect(() => validateQuery(q, 'postgres', 'viewer')).not.toThrow();
    });

    it('allows tokenizer — a word that merely starts with "token"', () => {
      expect(() => assertRolePermissions('SELECT tokenizer FROM models', 'viewer')).not.toThrow();
    });
  });

  describe('aggregate stars stay exempt, and only those', () => {
    it.each(['avg(*)', 'min(*)', 'max(*)', 'array_agg(*)', 'json_agg(*)'])(
      'allows the %s aggregate star',
      (agg) => {
        const q: Query = { kind: 'sql', sql: `SELECT ${agg} FROM events` };
        expect(() => validateQuery(q, 'postgres', 'viewer')).not.toThrow();
      },
    );

    it('rejects a comment smuggled between the paren and the aggregate star', () => {
      // count(<comment>*<comment>) is not a valid aggregate to us, so the
      // star survives the mask and the query fails closed.
      const q: Query = { kind: 'sql', sql: 'SELECT count(/*x*/*) FROM events' };
      expect(() => validateQuery(q, 'postgres', 'viewer')).toThrow(/wildcard projection/i);
    });

    it('rejects a projection star that follows an exempt aggregate', () => {
      const q: Query = { kind: 'sql', sql: 'SELECT count(*), * FROM events' };
      expect(() => validateQuery(q, 'postgres', 'viewer')).toThrow(/wildcard projection/i);
    });
  });

  describe('known, accepted over-blocks (both fail closed)', () => {
    it('rejects password_reset_required_at — a non-PII column named like one', () => {
      expect(() =>
        assertRolePermissions('SELECT password_reset_required_at FROM users', 'viewer'),
      ).toThrow(/PII/);
    });

    it('rejects a star inside a LIKE pattern string', () => {
      const q: Query = { kind: 'sql', sql: "SELECT id FROM users WHERE email LIKE 'a*b'" };
      expect(() => validateQuery(q, 'postgres', 'viewer')).toThrow(/wildcard projection/i);
    });
  });

  describe('higher roles are untouched by the tightened patterns', () => {
    it('lets an admin read user_password', () => {
      expect(() => assertRolePermissions('SELECT user_password FROM users', 'admin')).not.toThrow();
    });

    it('lets an editor use a wildcard projection', () => {
      const q: Query = { kind: 'sql', sql: 'SELECT/*x*/* FROM users' };
      expect(() => validateQuery(q, 'postgres', 'editor')).not.toThrow();
    });
  });
});
