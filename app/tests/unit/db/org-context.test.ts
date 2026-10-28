import { describe, it, expect, vi } from 'vitest';
import { assertOrgContextIntact } from '@/db/org-context';

/**
 * The guard that closes the `set_config` pivot.
 *
 * `app.current_org_id` is a plain GUC: ANY role can re-point it for its own
 * session, and every tenant-scoped RLS policy reads it through
 * `app_current_org_id()`. Verified against a real Postgres 16: a SINGLE
 * statement (`WITH x AS (SELECT set_config(...)) SELECT ... FROM other_org.uploads`)
 * returns another org's rows, and so does the session-level form
 * (`set_config(..., false)`), which even replaces the transaction-local value
 * the app set.
 *
 * The keyword blocklist in `validate-query.ts` is the first line of defense
 * and it holds for every SQL-backed connector. This guard is the second one:
 * it verifies the context AFTER the statement ran, before the rows can leave
 * the transaction.
 */
function sqlText(query: unknown): string {
  const chunks = (query as { queryChunks?: Array<{ value?: unknown }> }).queryChunks ?? [];
  return chunks
    .map((chunk) => {
      if (typeof chunk === 'string') return chunk;
      const value = (chunk as { value?: unknown }).value;
      if (value === undefined) return '?';
      if (Array.isArray(value)) return value.join('');
      return String(value);
    })
    .join(' ');
}

function fakeTx(rows: Array<Record<string, unknown>>) {
  const executed: string[] = [];
  const tx = {
    executed,
    execute: vi.fn(async (query: unknown) => {
      const text = sqlText(query);
      executed.push(text);
      if (text.includes('current_setting')) return rows;
      return [];
    }),
  };
  return tx;
}

const INTACT = { orgId: 'org-a', userId: null, role: 'editor' };

describe('assertOrgContextIntact', () => {
  it('no lanza cuando el contexto sigue intacto', async () => {
    const tx = fakeTx([{ org_id: 'org-a', user_id: '', user_role: 'editor' }]);

    await expect(assertOrgContextIntact(tx, INTACT)).resolves.toBeUndefined();
  });

  it('lanza cuando la organización fue re-apuntada', async () => {
    const tx = fakeTx([{ org_id: 'org-b', user_id: '', user_role: 'editor' }]);

    await expect(assertOrgContextIntact(tx, INTACT)).rejects.toMatchObject({
      code: 'tenant.cross_tenant_access',
    });
  });

  it('lanza cuando el usuario fue re-apuntado', async () => {
    const tx = fakeTx([
      { org_id: 'org-a', user_id: 'other-user', user_role: 'editor' },
    ]);

    await expect(assertOrgContextIntact(tx, INTACT)).rejects.toMatchObject({
      code: 'tenant.cross_tenant_access',
    });
  });

  it('lanza cuando el rol fue re-apuntado', async () => {
    const tx = fakeTx([{ org_id: 'org-a', user_id: '', user_role: 'admin' }]);

    await expect(assertOrgContextIntact(tx, INTACT)).rejects.toMatchObject({
      code: 'tenant.cross_tenant_access',
    });
  });

  it('trata el valor vacío como null (el app setea el usuario en NULL)', async () => {
    const tx = fakeTx([{ org_id: 'org-a', user_id: '', user_role: 'editor' }]);

    await expect(
      assertOrgContextIntact(tx, { orgId: 'org-a', userId: null, role: 'editor' }),
    ).resolves.toBeUndefined();
  });

  it('limpia los GUC de sesión cuando detecta la manipulación', async () => {
    // Un set_config de SESION sobrevive al rollback: sin esta limpieza la
    // conexión vuelve al pool con el org de otro tenant.
    const tx = fakeTx([{ org_id: 'org-b', user_id: '', user_role: 'editor' }]);

    await expect(assertOrgContextIntact(tx, INTACT)).rejects.toThrow();

    const cleanups = tx.executed.filter((text) => text.includes('set_config'));
    expect(cleanups.length).toBeGreaterThan(0);
    for (const guc of ['app.current_org_id', 'app.current_user_id', 'app.current_user_role']) {
      expect(
        cleanups.some((text) => text.includes(guc)),
        `esperaba limpiar ${guc}`,
      ).toBe(true);
    }
  });

  it('no limpia nada cuando el contexto está intacto', async () => {
    const tx = fakeTx([{ org_id: 'org-a', user_id: '', user_role: 'editor' }]);

    await assertOrgContextIntact(tx, INTACT);

    const cleanups = tx.executed.filter((text) => text.includes('set_config'));
    expect(cleanups).toHaveLength(0);
  });
});
