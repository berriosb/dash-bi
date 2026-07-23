import { describe, it, expect } from 'vitest';
import { validateQuery } from '@/lib/security/validate-query';

describe('validateQuery - SQL injection prevention (T2)', () => {
  describe('Postgres queries', () => {
    it('accepts SELECT queries', () => {
      expect(() =>
        validateQuery(
          { kind: 'sql', sql: 'SELECT * FROM users' },
          'postgres',
        ),
      ).not.toThrow();
    });

    it('accepts WITH (CTE) queries', () => {
      expect(() =>
        validateQuery(
          { kind: 'sql', sql: 'WITH active AS (SELECT * FROM users WHERE active = true) SELECT * FROM active' },
          'postgres',
        ),
      ).not.toThrow();
    });

    it('accepts EXPLAIN queries', () => {
      expect(() =>
        validateQuery(
          { kind: 'sql', sql: 'EXPLAIN SELECT * FROM users' },
          'postgres',
        ),
      ).not.toThrow();
    });

    it('rejects DROP TABLE', () => {
      expect(() =>
        validateQuery(
          { kind: 'sql', sql: 'DROP TABLE users' },
          'postgres',
        ),
      ).toThrow('Only SELECT queries allowed');
    });

    it('rejects DELETE statements', () => {
      expect(() =>
        validateQuery(
          { kind: 'sql', sql: 'DELETE FROM users WHERE id = 1' },
          'postgres',
        ),
      ).toThrow('Only SELECT queries allowed');
    });

    it('rejects UPDATE statements', () => {
      expect(() =>
        validateQuery(
          { kind: 'sql', sql: 'UPDATE users SET active = false' },
          'postgres',
        ),
      ).toThrow('Only SELECT queries allowed');
    });

    it('rejects INSERT statements', () => {
      expect(() =>
        validateQuery(
          { kind: 'sql', sql: 'INSERT INTO users (email) VALUES (\'evil@x.com\')' },
          'postgres',
        ),
      ).toThrow('Only SELECT queries allowed');
    });

    it('rejects TRUNCATE', () => {
      expect(() =>
        validateQuery(
          { kind: 'sql', sql: 'TRUNCATE TABLE users' },
          'postgres',
        ),
      ).toThrow('Only SELECT queries allowed');
    });

    it('rejects ALTER TABLE', () => {
      expect(() =>
        validateQuery(
          { kind: 'sql', sql: 'ALTER TABLE users ADD COLUMN evil TEXT' },
          'postgres',
        ),
      ).toThrow('Only SELECT queries allowed');
    });

    it('rejects CREATE TABLE', () => {
      expect(() =>
        validateQuery(
          { kind: 'sql', sql: 'CREATE TABLE evil (id INT)' },
          'postgres',
        ),
      ).toThrow('Only SELECT queries allowed');
    });

    it('rejects GRANT', () => {
      expect(() =>
        validateQuery(
          { kind: 'sql', sql: 'GRANT ALL ON users TO public' },
          'postgres',
        ),
      ).toThrow('Only SELECT queries allowed');
    });

    it('rejects stacked queries (SQL injection vector)', () => {
      expect(() =>
        validateQuery(
          { kind: 'sql', sql: 'SELECT * FROM users; DROP TABLE users' },
          'postgres',
        ),
      ).toThrow('Multi-statement queries not allowed');
    });

    it('rejects comment-based injection', () => {
      expect(() =>
        validateQuery(
          { kind: 'sql', sql: 'SELECT 1; -- comment\nDROP TABLE users' },
          'postgres',
        ),
      ).toThrow('Multi-statement queries not allowed');
    });

    it('auto-injects LIMIT if missing', () => {
      const query: { kind: 'sql'; sql: string } = { kind: 'sql', sql: 'SELECT * FROM users' };
      validateQuery(query, 'postgres');
      expect(query.sql).toMatch(/LIMIT 10000/);
    });

    it('preserves existing LIMIT', () => {
      const query: { kind: 'sql'; sql: string } = { kind: 'sql', sql: 'SELECT * FROM users LIMIT 50' };
      validateQuery(query, 'postgres');
      expect(query.sql).toMatch(/LIMIT 50/);
      expect(query.sql).not.toMatch(/LIMIT 50[^0-9]/); // No "LIMIT 50000" appended
    });
  });

  describe('Non-Postgres connectors', () => {
    it('rejects SQL query for Stripe connector', () => {
      expect(() =>
        validateQuery({ kind: 'sql', sql: 'SELECT *' }, 'stripe'),
      ).toThrow('Stripe expects stripe operation');
    });

    it('rejects SQL query for Sheets connector', () => {
      expect(() =>
        validateQuery({ kind: 'sql', sql: 'SELECT *' }, 'sheets'),
      ).toThrow('Sheets expects sheet query');
    });
  });
});