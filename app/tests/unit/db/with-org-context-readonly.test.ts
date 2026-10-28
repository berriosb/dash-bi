import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The guard is only worth something if it runs on the path where
 * user-authored SQL runs. Every such path goes through
 * `withOrgContextReadOnly` (the spreadsheet connector and the alert
 * evaluator), so that is where the check has to live.
 */
const { fakeTx, transaction, contextState } = vi.hoisted(() => {
  const contextState = { org_id: 'org-a', user_id: '', user_role: 'editor' };
  const fakeTx = {
    execute: vi.fn(async (query: unknown) => {
      const chunks = (query as { queryChunks?: unknown[] }).queryChunks ?? [];
      const text = chunks
        .map((chunk) => {
          if (typeof chunk === 'string') return chunk;
          const value = (chunk as { value?: unknown }).value;
          if (value === undefined) return '?';
          if (Array.isArray(value)) return value.join('');
          return String(value);
        })
        .join(' ');
      if (text.includes('current_setting')) {
        return [{ ...contextState }];
      }
      return [];
    }),
  };
  const transaction = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(fakeTx));
  return { fakeTx, transaction, contextState };
});

vi.mock('drizzle-orm/postgres-js', () => ({
  drizzle: () => ({ transaction }),
}));
vi.mock('postgres', () => ({ default: () => ({}) }));

import { withOrgContextReadOnly } from '@/db/client';

describe('withOrgContextReadOnly — guard del contexto de tenant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) =>
      cb(fakeTx),
    );
  });

  it('deja pasar la consulta cuando el contexto sigue intacto', async () => {
    const result = await withOrgContextReadOnly('org-a', null, async () => ['ok']);

    expect(result).toEqual(['ok']);
  });

  it('corta la transacción cuando el contexto fue re-apuntado', async () => {
    // Simula lo que hace una sentencia del usuario:
    // `set_config('app.current_org_id', '<otra org>', ...)`.
    await expect(
      withOrgContextReadOnly('org-a', null, async () => {
        contextState.org_id = 'org-b';
        return ['datos-de-otra-org'];
      }),
    ).rejects.toMatchObject({ code: 'tenant.cross_tenant_access' });
  });

  it('corta la transacción cuando el rol fue re-apuntado', async () => {
    await expect(
      withOrgContextReadOnly('org-a', null, async () => {
        contextState.user_role = 'admin';
        return ['ok'];
      }),
    ).rejects.toMatchObject({ code: 'tenant.cross_tenant_access' });
  });
});
