import { describe, it, expect } from 'vitest';
import { hasPermission } from '@/lib/auth/permissions';

/**
 * Tests de la matriz RBAC. Verifica que cada permiso esté asignado al rol correcto
 * según `specs/multi-tenant.md §4.1`.
 */
describe('RBAC permissions matrix', () => {
  describe('admin role', () => {
    it('can invite members', () => {
      expect(hasPermission('admin', 'org.invite')).toBe(true);
    });
    it('can configure LLM', () => {
      expect(hasPermission('admin', 'org.updateLLMConfig')).toBe(true);
    });
    it('can connect data sources', () => {
      expect(hasPermission('admin', 'datasource.create')).toBe(true);
    });
    it('can create dashboards', () => {
      expect(hasPermission('admin', 'dashboard.create')).toBe(true);
    });
    it('can generate with AI', () => {
      // Implicit via dashboard.create + query.execute
      expect(hasPermission('admin', 'query.execute')).toBe(true);
    });
    it('can export', () => {
      expect(hasPermission('admin', 'export.pdf')).toBe(true);
    });
    it('can share public link', () => {
      expect(hasPermission('admin', 'dashboard.sharePublic')).toBe(true);
    });
    it('can create embed tokens', () => {
      expect(hasPermission('admin', 'dashboard.embed')).toBe(true);
    });
  });

  describe('editor role', () => {
    it('CANNOT invite members (admin-only)', () => {
      expect(hasPermission('editor', 'org.invite')).toBe(false);
    });
    it('CANNOT configure LLM (admin-only)', () => {
      expect(hasPermission('editor', 'org.updateLLMConfig')).toBe(false);
    });
    it('CAN connect data sources', () => {
      expect(hasPermission('editor', 'datasource.create')).toBe(true);
    });
    it('CAN create dashboards', () => {
      expect(hasPermission('editor', 'dashboard.create')).toBe(true);
    });
    it('CAN edit dashboards', () => {
      expect(hasPermission('editor', 'dashboard.edit')).toBe(true);
    });
    it('CAN execute queries', () => {
      expect(hasPermission('editor', 'query.execute')).toBe(true);
    });
    it('CAN export', () => {
      expect(hasPermission('editor', 'export.pdf')).toBe(true);
    });
    it('CAN share public link', () => {
      expect(hasPermission('editor', 'dashboard.sharePublic')).toBe(true);
    });
    it('CAN create embed tokens', () => {
      expect(hasPermission('editor', 'dashboard.embed')).toBe(true);
    });
  });

  describe('viewer role', () => {
    it('CANNOT invite members', () => {
      expect(hasPermission('viewer', 'org.invite')).toBe(false);
    });
    it('CANNOT create embed tokens', () => {
      expect(hasPermission('viewer', 'dashboard.embed')).toBe(false);
    });
    it('CANNOT connect data sources', () => {
      expect(hasPermission('viewer', 'datasource.create')).toBe(false);
    });
    it('CANNOT create dashboards', () => {
      expect(hasPermission('viewer', 'dashboard.create')).toBe(false);
    });
    it('CANNOT edit dashboards', () => {
      expect(hasPermission('viewer', 'dashboard.edit')).toBe(false);
    });
    it('CAN view dashboards', () => {
      expect(hasPermission('viewer', 'dashboard.view')).toBe(true);
    });
    it('CAN execute queries (read-only)', () => {
      expect(hasPermission('viewer', 'query.execute')).toBe(true);
    });
    it('CAN export (PDF/PNG)', () => {
      expect(hasPermission('viewer', 'export.pdf')).toBe(true);
    });
    it('CANNOT share public link', () => {
      expect(hasPermission('viewer', 'dashboard.sharePublic')).toBe(false);
    });
  });

  describe('unknown permissions', () => {
    it('returns false for unknown action', () => {
      expect(hasPermission('admin', 'unknown.action')).toBe(false);
    });

    it('returns false for unknown role', () => {
      // @ts-expect-error — testing runtime behavior with invalid role
      expect(hasPermission('superadmin', 'dashboard.view')).toBe(false);
    });
  });

  describe('all 3 roles can view dashboards and execute queries', () => {
    for (const role of ['admin', 'editor', 'viewer'] as const) {
      it(`${role} can view dashboards`, () => {
        expect(hasPermission(role, 'dashboard.view')).toBe(true);
      });
      it(`${role} can execute queries`, () => {
        expect(hasPermission(role, 'query.execute')).toBe(true);
      });
      it(`${role} can export`, () => {
        expect(hasPermission(role, 'export.pdf')).toBe(true);
      });
    }
  });
});