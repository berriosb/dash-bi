import { describe, it, expect } from 'vitest';
import {
  assertRolePermissions,
  assertStripeRolePermissions,
  validateQuery,
  ValidationError,
} from '@/lib/security/validate-query';

/**
 * Tests unitarios para los filtros role-based (defense in depth).
 *
 * Los tests de aislamiento multi-tenant completos con Postgres real
 * + RLS enforcement viven en la suite de integration (Sprint 5)
 * usando Testcontainers. Acá validamos la lógica del filtro.
 *
 * Threat model:
 * - T1: cross-tenant data leak (validado en integration tests con RLS)
 * - T2: SQL injection (sql-injection.test.ts + este archivo, filtros role)
 */

describe('withOrgContext - tenant isolation (T1) - logic layer', () => {
  describe('Role-based PII masking for Postgres', () => {
    it('admin can read all columns including sensitive ones', () => {
      expect(() => assertRolePermissions('SELECT password FROM users', 'admin')).not.toThrow();
      expect(() => assertRolePermissions('SELECT api_key, token FROM integrations', 'admin')).not.toThrow();
    });

    it('editor can read all columns including sensitive ones', () => {
      expect(() => assertRolePermissions('SELECT password FROM users', 'editor')).not.toThrow();
      expect(() => assertRolePermissions('SELECT ssn FROM customers', 'editor')).not.toThrow();
    });

    it('viewer cannot read password column', () => {
      expect(() => assertRolePermissions('SELECT password FROM users', 'viewer')).toThrow(
        ValidationError,
      );
    });

    it('viewer cannot read api_key column', () => {
      expect(() => assertRolePermissions('SELECT api_key FROM integrations', 'viewer')).toThrow(
        ValidationError,
      );
    });

    it('viewer cannot read token column', () => {
      expect(() => assertRolePermissions('SELECT token FROM sessions', 'viewer')).toThrow(
        ValidationError,
      );
    });

    it('viewer cannot read credit_card or cvv columns', () => {
      expect(() => assertRolePermissions('SELECT credit_card FROM payments', 'viewer')).toThrow(
        ValidationError,
      );
      expect(() => assertRolePermissions('SELECT cvv FROM payments', 'viewer')).toThrow(
        ValidationError,
      );
    });

    it('viewer can read non-sensitive columns', () => {
      expect(() => assertRolePermissions('SELECT name, email FROM customers', 'viewer')).not.toThrow();
      expect(() => assertRolePermissions('SELECT * FROM products', 'viewer')).not.toThrow();
    });

    it('column matching is case-insensitive (catches PASSWORD, Password, etc.)', () => {
      expect(() => assertRolePermissions('SELECT PASSWORD FROM users', 'viewer')).toThrow(
        ValidationError,
      );
      expect(() => assertRolePermissions('SELECT Api_Key FROM integrations', 'viewer')).toThrow(
        ValidationError,
      );
    });
  });

  describe('Role-based PII masking for Stripe', () => {
    it('admin/editor can list customers', () => {
      expect(() => assertStripeRolePermissions('listCustomers', 'admin')).not.toThrow();
      expect(() => assertStripeRolePermissions('listCustomers', 'editor')).not.toThrow();
    });

    it('viewer CANNOT list customers (PII: email, name)', () => {
      expect(() => assertStripeRolePermissions('listCustomers', 'viewer')).toThrow(
        ValidationError,
      );
    });

    it('viewer can list charges, subscriptions, invoices, getRevenue', () => {
      const allowed = ['listCharges', 'listSubscriptions', 'listInvoices', 'getRevenue'];
      for (const op of allowed) {
        expect(() => assertStripeRolePermissions(op, 'viewer')).not.toThrow();
      }
    });
  });

  describe('validateQuery integration with role parameter', () => {
    it('rejects viewer query that accesses PII column (Postgres)', () => {
      const query: { kind: 'sql'; sql: string } = {
        kind: 'sql',
        sql: 'SELECT id, password FROM users',
      };
      expect(() => validateQuery(query, 'postgres', 'viewer')).toThrow(ValidationError);
    });

    it('allows viewer query on non-PII columns (Postgres)', () => {
      const query: { kind: 'sql'; sql: string } = {
        kind: 'sql',
        sql: 'SELECT id, name FROM users',
      };
      expect(() => validateQuery(query, 'postgres', 'viewer')).not.toThrow();
    });

    it('admin query can include PII columns (Postgres)', () => {
      const query: { kind: 'sql'; sql: string } = {
        kind: 'sql',
        sql: 'SELECT id, password FROM users',
      };
      expect(() => validateQuery(query, 'postgres', 'admin')).not.toThrow();
    });

    it('rejects viewer listing Stripe customers', () => {
      expect(() =>
        validateQuery(
          { kind: 'stripe', operation: { type: 'listCustomers', params: {} } },
          'stripe',
          'viewer',
        ),
      ).toThrow(ValidationError);
    });

    it('admin can list Stripe customers', () => {
      expect(() =>
        validateQuery(
          { kind: 'stripe', operation: { type: 'listCustomers', params: {} } },
          'stripe',
          'admin',
        ),
      ).not.toThrow();
    });

    it('still applies DML/DDL validation alongside role filter', () => {
      const query: { kind: 'sql'; sql: string } = {
        kind: 'sql',
        sql: 'DROP TABLE users',
      };
      // Both 'Only SELECT queries allowed' and role check would apply
      expect(() => validateQuery(query, 'postgres', 'viewer')).toThrow();
      expect(() => validateQuery(query, 'postgres', 'admin')).toThrow();
    });

    it('still auto-injects LIMIT when role is provided', () => {
      const query: { kind: 'sql'; sql: string } = {
        kind: 'sql',
        sql: 'SELECT * FROM products',
      };
      validateQuery(query, 'postgres', 'viewer');
      expect(query.sql).toMatch(/LIMIT 10000/);
    });

    it('backward compatible: omitting role skips PII filtering', () => {
      const query: { kind: 'sql'; sql: string } = {
        kind: 'sql',
        sql: 'SELECT password FROM users',
      };
      // Without role, validateQuery accepts it (legacy behavior)
      expect(() => validateQuery(query, 'postgres')).not.toThrow();
    });
  });
});