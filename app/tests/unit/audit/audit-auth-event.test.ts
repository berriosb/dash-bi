import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The auth events belong to a USER, not to a request: a login happens
 * before there is a request context, and `audit_log.org_id` is NOT NULL.
 *
 * So the helper resolves the org from the user's membership, and SKIPS the
 * event when there is none: an audit row filed under the wrong org would
 * be worse than no row.
 */
const { mockTxInsert, mockMemberRow } = vi.hoisted(() => ({
  mockTxInsert: vi.fn(),
  mockMemberRow: { value: null as unknown },
}));

vi.mock('@/db/client', () => ({
  db: {
    transaction: vi.fn(async (fn: (tx: unknown) => unknown) =>
      fn({
        execute: vi.fn().mockResolvedValue([]),
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue(mockMemberRow.value ? [mockMemberRow.value] : []),
            }),
          }),
        }),
        insert: mockTxInsert,
      }),
    ),
  },
  withOrgContext: async (
    _orgId: string,
    _userId: string | null,
    fn: (tx: { insert: typeof mockTxInsert }) => unknown,
  ) => fn({ insert: mockTxInsert }),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { auditAuthEvent } from '@/lib/audit/log';

function insertPayload(): Record<string, unknown> {
  const last = mockTxInsert.mock.results.at(-1);
  if (!last) throw new Error('mockTxInsert was not called');
  const valuesFn = last.value.values as { mock: { calls: unknown[][] } };
  return valuesFn.mock.calls[0]![0] as Record<string, unknown>;
}

describe('auditAuthEvent', () => {
  beforeEach(() => {
    mockTxInsert.mockClear();
    mockTxInsert.mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    });
    mockMemberRow.value = null;
  });

  it('escribe el evento en la org del usuario', async () => {
    mockMemberRow.value = { orgId: 'org-1' };

    await auditAuthEvent('user-1', 'auth.login');

    expect(mockTxInsert).toHaveBeenCalledTimes(1);
    expect(insertPayload()).toMatchObject({
      orgId: 'org-1',
      userId: 'user-1',
      action: 'auth.login',
    });
  });

  it('no escribe nada cuando el usuario no tiene org', async () => {
    // Sin org no hay dónde archivar el evento: `audit_log.org_id` es NOT
    // NULL y no existe una org de sistema.
    await auditAuthEvent('user-sin-org', 'auth.login');

    expect(mockTxInsert).not.toHaveBeenCalled();
  });

  it('no propaga el error si la org no se puede resolver', async () => {
    const { db } = await import('@/db/client');
    (db.transaction as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error('db down');
    });

    await expect(auditAuthEvent('user-1', 'auth.login')).resolves.toBeUndefined();
  });
});
