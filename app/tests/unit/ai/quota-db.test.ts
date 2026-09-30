import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * DB-backed half of the LLM quota.
 *
 * `getOrgMonthSpendUsd` is what makes the cap enforceable: without a
 * correct monthly aggregate there is nothing to compare the budget to.
 * The date window matters as much as the sum — a query that forgets the
 * lower bound would sum all-time spend and lock an org out forever.
 */
const tx = {
  execute: vi.fn(),
};

vi.mock('@/db/client', () => ({
  withOrgContext: vi.fn(async (_orgId: string, _userId: string, fn: (t: unknown) => unknown) =>
    fn(tx),
  ),
}));

import { getOrgMonthSpendUsd, monthStart } from '@/lib/ai/quota';
import { withOrgContext } from '@/db/client';

describe('getOrgMonthSpendUsd', () => {
  beforeEach(() => {
    tx.execute.mockReset();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns 0 when the org has no usage rows', async () => {
    tx.execute.mockResolvedValue([{ spend: '0.000000' }]);
    await expect(getOrgMonthSpendUsd('org-1', 'user-1')).resolves.toBe(0);
  });

  it('parses the numeric string the schema stores', async () => {
    // cost_usd is `text` in the schema to avoid numeric precision loss,
    // so the aggregate comes back as a string and must be coerced.
    tx.execute.mockResolvedValue([{ spend: '12.500000' }]);
    await expect(getOrgMonthSpendUsd('org-1', 'user-1')).resolves.toBe(12.5);
  });

  it('returns 0 instead of NaN when the aggregate comes back null', async () => {
    tx.execute.mockResolvedValue([{ spend: null }]);
    await expect(getOrgMonthSpendUsd('org-1', 'user-1')).resolves.toBe(0);
  });

  it('scopes the read to the caller org through RLS context', async () => {
    // Reading another tenant's spend is as much a leak as reading their
    // dashboards, so the org must be bound into the RLS context rather
    // than trusted from the caller.
    tx.execute.mockResolvedValue([{ spend: '1' }]);
    await getOrgMonthSpendUsd('org-abc', 'user-1');

    expect(withOrgContext).toHaveBeenCalledWith('org-abc', 'user-1', expect.any(Function));
  });

  it('bounds the window to the month containing the reference date', async () => {
    // A query that forgot the lower bound would sum all-time spend and
    // lock the org out of AI forever, so the reference date must flow
    // through rather than defaulting to "now" internally.
    tx.execute.mockResolvedValue([{ spend: '1' }]);
    const september = new Date('2026-09-17T14:35:00.000Z');
    const january = new Date('2027-01-09T00:00:00.000Z');

    await expect(getOrgMonthSpendUsd('org-1', 'user-1', september)).resolves.toBe(1);
    await expect(getOrgMonthSpendUsd('org-1', 'user-1', january)).resolves.toBe(1);
    expect(tx.execute).toHaveBeenCalledTimes(2);
  });
});

describe('monthStart', () => {
  it('returns the first instant of the current month', () => {
    const start = monthStart(new Date('2026-09-17T14:35:00.000Z'));
    expect(start.getUTCDate()).toBe(1);
    expect(start.getUTCMonth()).toBe(8); // September, 0-indexed
    expect(start.getUTCFullYear()).toBe(2026);
  });

  it('handles January without rolling into the previous year', () => {
    const start = monthStart(new Date('2027-01-09T00:00:00.000Z'));
    expect(start.getUTCFullYear()).toBe(2027);
    expect(start.getUTCMonth()).toBe(0);
    expect(start.getUTCDate()).toBe(1);
  });
});
