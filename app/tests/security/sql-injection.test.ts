import { describe, it, expect } from 'vitest';
import {
  validateQuery,
  assertRolePermissions,
  assertStripeRolePermissions,
  ValidationError,
} from '@/lib/security/validate-query';

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

  describe('Role-based permissions (Sprint 1 v0.2)', () => {
    describe('assertRolePermissions (Postgres PII masking)', () => {
      it('admin role can access sensitive columns', () => {
        expect(() =>
          assertRolePermissions('SELECT password FROM users', 'admin'),
        ).not.toThrow();
        expect(() =>
          assertRolePermissions('SELECT api_key FROM integrations', 'admin'),
        ).not.toThrow();
      });

      it('editor role can access sensitive columns', () => {
        expect(() =>
          assertRolePermissions('SELECT token FROM sessions', 'editor'),
        ).not.toThrow();
      });

      it('viewer role CANNOT access password column', () => {
        expect(() =>
          assertRolePermissions('SELECT password FROM users', 'viewer'),
        ).toThrow(ValidationError);
      });

      it('viewer role CANNOT access api_key column', () => {
        expect(() =>
          assertRolePermissions('SELECT api_key FROM integrations', 'viewer'),
        ).toThrow(ValidationError);
      });

      it('viewer role CANNOT access token column', () => {
        expect(() =>
          assertRolePermissions('SELECT token FROM sessions', 'viewer'),
        ).toThrow(ValidationError);
      });

      it('viewer role CANNOT access ssn column', () => {
        expect(() =>
          assertRolePermissions('SELECT ssn FROM customers', 'viewer'),
        ).toThrow(ValidationError);
      });

      it('viewer role CANNOT access credit_card column', () => {
        expect(() =>
          assertRolePermissions('SELECT credit_card FROM payments', 'viewer'),
        ).toThrow(ValidationError);
      });

      it('viewer role CAN access non-sensitive columns', () => {
        expect(() =>
          assertRolePermissions('SELECT name, email FROM customers', 'viewer'),
        ).not.toThrow();
      });

      it('column matching is case-insensitive', () => {
        expect(() =>
          assertRolePermissions('SELECT PASSWORD FROM users', 'viewer'),
        ).toThrow(ValidationError);
        expect(() =>
          assertRolePermissions('SELECT Api_Key FROM integrations', 'viewer'),
        ).toThrow(ValidationError);
      });
    });

    describe('assertStripeRolePermissions (Stripe PII protection)', () => {
      it('admin/editor can list customers', () => {
        expect(() => assertStripeRolePermissions('listCustomers', 'admin')).not.toThrow();
        expect(() => assertStripeRolePermissions('listCustomers', 'editor')).not.toThrow();
      });

      it('viewer CANNOT list customers (PII)', () => {
        expect(() => assertStripeRolePermissions('listCustomers', 'viewer')).toThrow(
          ValidationError,
        );
      });

      it('viewer can list charges and subscriptions', () => {
        expect(() => assertStripeRolePermissions('listCharges', 'viewer')).not.toThrow();
        expect(() => assertStripeRolePermissions('listSubscriptions', 'viewer')).not.toThrow();
        expect(() => assertStripeRolePermissions('listInvoices', 'viewer')).not.toThrow();
        expect(() => assertStripeRolePermissions('getRevenue', 'viewer')).not.toThrow();
      });
    });

    describe('validateQuery with role (integration)', () => {
      it('blocks viewer from accessing password in SQL query', () => {
        const query: { kind: 'sql'; sql: string } = {
          kind: 'sql',
          sql: 'SELECT password FROM users',
        };
        expect(() => validateQuery(query, 'postgres', 'viewer')).toThrow(ValidationError);
      });

      it('allows viewer to query non-PII columns', () => {
        const query: { kind: 'sql'; sql: string } = {
          kind: 'sql',
          sql: 'SELECT id, name FROM users',
        };
        expect(() => validateQuery(query, 'postgres', 'viewer')).not.toThrow();
      });

      it('blocks viewer from listing Stripe customers', () => {
        expect(() =>
          validateQuery(
            {
              kind: 'stripe',
              operation: { type: 'listCustomers', params: {} },
            },
            'stripe',
            'viewer',
          ),
        ).toThrow(ValidationError);
      });

      it('admin can list Stripe customers', () => {
        expect(() =>
          validateQuery(
            {
              kind: 'stripe',
              operation: { type: 'listCustomers', params: {} },
            },
            'stripe',
            'admin',
          ),
        ).not.toThrow();
      });
    });
  });
});