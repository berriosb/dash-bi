import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { users, uploadedFiles } from '@/db/schema';
import { validateQuery } from '@/lib/security/validate-query';

const APP_ROOT = resolve(__dirname, '../../..');

describe('Bloque 1 — RLS, schema sync & internal function blocklist', () => {
  describe('validateQuery blocks internal SECURITY DEFINER functions', () => {
    const internalFunctions = [
      'dashbi_due_alert_rules',
      'dashbi_count_enabled_alert_rules',
      'dashbi_load_alert_rule',
      'dashbi_resolve_public_link',
      'dashbi_user_belongs_to_org',
      'dashbi_slug_is_taken',
      'dashbi_due_scheduled_reports',
    ];

    it.each(internalFunctions)('rejects %s in postgres queries', (fnName) => {
      expect(() =>
        validateQuery({ kind: 'sql', sql: `SELECT * FROM ${fnName}()` }, 'postgres'),
      ).toThrow(/forbidden|not allowed/i);
    });

    it.each(internalFunctions)('rejects %s in spreadsheet queries', (fnName) => {
      expect(() =>
        validateQuery(
          { kind: 'spreadsheet', fileId: 'f1', sql: `SELECT * FROM ${fnName}()` },
          'spreadsheet',
        ),
      ).toThrow(/forbidden|not allowed/i);
    });
  });

  describe('Drizzle schema.ts matches SQL migrations', () => {
    it('declares users_current_onboarding_step_idx on users', () => {
      const config = getTableConfig(users);
      const indexNames = config.indexes.map((idx) => idx.config.name);
      expect(indexNames).toContain('users_current_onboarding_step_idx');
    });

    it('declares uploaded_files_target_table_idx and uploaded_files_org_target_uniq on uploadedFiles', () => {
      const config = getTableConfig(uploadedFiles);
      const indexNames = config.indexes.map((idx) => idx.config.name);
      expect(indexNames).toContain('uploaded_files_target_table_idx');
      expect(indexNames).toContain('uploaded_files_org_target_uniq');
    });

    it('sets onDelete restrict on uploadedFiles.createdBy foreign key', () => {
      const config = getTableConfig(uploadedFiles);
      const createdByFk = config.foreignKeys.find((fk) =>
        fk.reference().columns.some((c) => c.name === 'created_by'),
      );
      expect(createdByFk?.onDelete).toBe('restrict');
    });
  });

  describe('setup-rls.ts and src/db/rls.ts stay aligned with null-safe migrations', () => {
    const setupRls = readFileSync(resolve(APP_ROOT, 'scripts/setup-rls.ts'), 'utf8');
    const dbRls = readFileSync(resolve(APP_ROOT, 'src/db/rls.ts'), 'utf8');

    it('setup-rls.ts uses app_current_org_id() and dashbi_user_belongs_to_org()', () => {
      expect(setupRls).toContain('app_current_org_id()');
      expect(setupRls).toContain('dashbi_user_belongs_to_org(id)');
      expect(setupRls).toContain('scheduled_reports');
      expect(setupRls).toContain('uploaded_files');
    });

    it('src/db/rls.ts uses app_current_org_id() and dashbi_user_belongs_to_org()', () => {
      expect(dbRls).toContain('app_current_org_id()');
      expect(dbRls).toContain('dashbi_user_belongs_to_org(id)');
      expect(dbRls).toContain('scheduled_reports');
      expect(dbRls).toContain('uploaded_files');
    });
  });

  describe('Migration 0017 hardens org_members, scheduled_reports helper, and dashbi_readonly', () => {
    const journal = JSON.parse(
      readFileSync(resolve(APP_ROOT, 'drizzle/migrations/meta/_journal.json'), 'utf8'),
    ) as { entries: Array<{ idx: number; tag: string }> };

    it('registers migration 0017 in _journal.json', () => {
      const entry = journal.entries.find((e) => e.idx === 17);
      expect(entry?.tag).toBe('0017_production_rls_and_readonly_hardening');
    });

    it('defines org_members_isolation with org_id = app_current_org_id() and WITH CHECK, dashbi_due_scheduled_reports, and revokes sensitive tables from dashbi_readonly', () => {
      const sql0017 = readFileSync(
        resolve(
          APP_ROOT,
          'drizzle/migrations/0017_production_rls_and_readonly_hardening.sql',
        ),
        'utf8',
      );
      expect(sql0017).toContain('CREATE POLICY "org_members_isolation" ON "org_members"');
      expect(sql0017).toContain('OR org_id = app_current_org_id()');
      expect(sql0017).toContain('WITH CHECK');
      expect(sql0017).toContain('dashbi_due_scheduled_reports');
      expect(sql0017).toContain("'sessions'");
      expect(sql0017).toContain('REVOKE ALL ON TABLE public.%I FROM dashbi_readonly');
    });
  });
});
