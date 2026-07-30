import { describe, it, expect, vi } from 'vitest';
import { requirePermission, ForbiddenError } from '@/lib/auth/context';
import type { OrgRole } from '@/lib/auth/permissions';

/**
 * `requirePermission` MUST be called with a transactional handle whose
 * GUCs (`app.current_user_id`, `app.current_org_id`) are set, otherwise
 * the `org_members_isolation` RLS policy will hide the membership row
 * (T1 from the threat model).
 *
 * Sprint 1.5: el helper ahora acepta `tx` explícitamente para forzar
 * que el caller pase el handle correcto.
 */

interface FakeTx {
  query: {
    orgMembers: {
      findFirst: (args: unknown) => Promise<{ role: OrgRole } | undefined>;
    };
  };
}

function makeTx(membership: { role: OrgRole } | null): FakeTx {
  return {
    query: {
      orgMembers: {
        findFirst: vi.fn().mockResolvedValue(membership),
      },
    },
  };
}

describe('requirePermission (Sprint 1.5 — tx-aware)', () => {
  it('returns the role when membership exists and action is allowed', async () => {
    const tx = makeTx({ role: 'admin' });
    const role = await requirePermission(tx as never, 'user-1', 'org-1', 'dashboard.create');
    expect(role).toBe('admin');
    expect(tx.query.orgMembers.findFirst).toHaveBeenCalledTimes(1);
  });

  it('throws ForbiddenError("Not a member") when membership is missing', async () => {
    const tx = makeTx(null);
    await expect(
      requirePermission(tx as never, 'user-1', 'org-1', 'dashboard.create'),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('throws ForbiddenError when role lacks the action', async () => {
    const tx = makeTx({ role: 'viewer' });
    await expect(
      requirePermission(tx as never, 'user-1', 'org-1', 'dashboard.create'),
    ).rejects.toThrow(/viewer.*cannot perform.*dashboard\.create/);
  });

  it('allows viewer to view dashboards', async () => {
    const tx = makeTx({ role: 'viewer' });
    const role = await requirePermission(tx as never, 'user-1', 'org-1', 'dashboard.view');
    expect(role).toBe('viewer');
  });

  it('does not silently leak data: re-queries on every call', async () => {
    const tx = makeTx({ role: 'admin' });
    await requirePermission(tx as never, 'user-1', 'org-1', 'dashboard.view');
    await requirePermission(tx as never, 'user-1', 'org-1', 'dashboard.view');
    expect(tx.query.orgMembers.findFirst).toHaveBeenCalledTimes(2);
  });
});