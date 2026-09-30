import { describe, it, expect } from 'vitest';
import { assertRolePermissions } from '@/lib/security/validate-query';

/**
 * T2 — RBAC: un viewer no debe poder leer columnas PII.
 *
 * El filtro compara la query completa contra una lista de nombres de
 * columna. Eso solo funciona si la columna aparece LITERALMENTE. Una
 * consulta que proyecta la fila entera (`SELECT *` o `t.*`) no contiene
 * ningún nombre de columna y por lo tanto pasa el filtro — devolviendo
 * passwords, tokens y SSN al rol más bajo.
 */
describe('assertRolePermissions — viewer PII filter (T2)', () => {
  describe('still blocks explicit sensitive columns', () => {
    it('rejects a literal password column', () => {
      expect(() => assertRolePermissions('SELECT password FROM users', 'viewer')).toThrow();
    });

    it('rejects a literal api_key column', () => {
      expect(() => assertRolePermissions('SELECT api_key FROM integrations', 'viewer')).toThrow();
    });

    it('rejects a literal ssn column', () => {
      expect(() => assertRolePermissions('SELECT ssn FROM customers', 'viewer')).toThrow();
    });

    it('rejects a sensitive column selected among others', () => {
      expect(() =>
        assertRolePermissions('SELECT id, name, token FROM sessions', 'viewer'),
      ).toThrow();
    });
  });

  describe('blocks wildcard projection', () => {
    it('rejects SELECT * — it exposes every column including PII', () => {
      expect(() => assertRolePermissions('SELECT * FROM users', 'viewer')).toThrow();
    });

    it('rejects SELECT t.* with a table alias', () => {
      expect(() => assertRolePermissions('SELECT u.* FROM users u', 'viewer')).toThrow();
    });

    it('rejects a wildcard inside a CTE projection', () => {
      expect(() =>
        assertRolePermissions(
          'WITH recent AS (SELECT * FROM payments) SELECT amount FROM recent',
          'viewer',
        ),
      ).toThrow();
    });

    it('rejects an unqualified wildcard in a subquery', () => {
      expect(() =>
        assertRolePermissions(
          'SELECT id FROM users WHERE id IN (SELECT * FROM sessions)',
          'viewer',
        ),
      ).toThrow();
    });
  });

  describe('leaves non-viewer roles alone', () => {
    it('lets an admin use SELECT *', () => {
      expect(() => assertRolePermissions('SELECT * FROM users', 'admin')).not.toThrow();
    });

    it('lets an editor use SELECT *', () => {
      expect(() => assertRolePermissions('SELECT * FROM users', 'editor')).not.toThrow();
    });
  });

  describe('does not over-block', () => {
    it('allows an explicit projection with no sensitive column', () => {
      expect(() =>
        assertRolePermissions('SELECT id, name, created_at FROM users', 'viewer'),
      ).not.toThrow();
    });

    it('allows a COUNT aggregate', () => {
      expect(() =>
        assertRolePermissions('SELECT COUNT(*) FROM orders', 'viewer'),
      ).not.toThrow();
    });
  });
});
