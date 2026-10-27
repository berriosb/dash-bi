/**
 * ODD task 5 (part A) — the shared client-IP helper.
 *
 * Nine call sites used to read the FIRST hop of `x-forwarded-for`:
 * `nlqa/ask`, `dashboards/generate`, `files/upload`, `data-sources`,
 * `data-sources/[id]/test`, `alert-rules/[id]/test-channel`,
 * `widgets/explain`, `lib/middleware/rate-limit` and `lib/audit/log`.
 *
 * The first hop is the client-controlled one: nginx appends the real peer at
 * the END of the list (`$proxy_add_x_forwarded_for`), so
 * `x-forwarded-for.split(',')[0]` is whatever the caller sent. Rotating the
 * header bypassed every IP bucket, and the forged value is what
 * `audit_log.ip` recorded.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// `audit()` runs its INSERT inside `withOrgContext`, so the tx is what has
// to be faked to observe the row it would have written.
const { mockTxInsert } = vi.hoisted(() => ({
  mockTxInsert: vi.fn(),
}));

vi.mock('@/db/client', () => ({
  withOrgContext: async (
    _orgId: string,
    _userId: string | null,
    fn: (tx: { insert: typeof mockTxInsert }) => unknown,
  ) => fn({ insert: mockTxInsert }),
}));

import { getClientIp } from '@/lib/http/client-ip';
import { audit } from '@/lib/audit/log';

function makeRequest(headers: Record<string, string>): Request {
  return new Request('http://localhost/api/whatever', { headers });
}

/** First values() payload of the last INSERT the audit helper performed. */
function getInsertPayload(): Record<string, unknown> {
  const lastResult = mockTxInsert.mock.results.at(-1);
  if (!lastResult) throw new Error('mockTxInsert was not called');
  const valuesFn = (lastResult.value as { values: ReturnType<typeof vi.fn> }).values;
  const lastCall = valuesFn.mock.calls.at(-1);
  if (!lastCall) throw new Error('values() was not called');
  return lastCall[0] as Record<string, unknown>;
}

describe('getClientIp', () => {
  it('returns the x-real-ip value when the header is present', () => {
    const req = makeRequest({ 'x-real-ip': '203.0.113.42' });
    expect(getClientIp(req)).toBe('203.0.113.42');
  });

  it('returns the LAST hop of x-forwarded-for, not the first', () => {
    // The first hop is whatever the caller wrote; the last one is the peer
    // the trusted proxy appended.
    const req = makeRequest({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8' });
    expect(getClientIp(req)).toBe('5.6.7.8');
  });

  it('returns the single hop when x-forwarded-for carries one entry', () => {
    const req = makeRequest({ 'x-forwarded-for': '1.2.3.4' });
    expect(getClientIp(req)).toBe('1.2.3.4');
  });

  it("returns 'unknown' when neither header is present", () => {
    const req = makeRequest({});
    expect(getClientIp(req)).toBe('unknown');
  });

  it('prefers x-real-ip over x-forwarded-for', () => {
    // nginx overwrites X-Real-IP with $remote_addr, so it is the value the
    // proxy vouched for — the forwarded list cannot override it.
    const req = makeRequest({
      'x-real-ip': '203.0.113.42',
      'x-forwarded-for': '1.2.3.4, 5.6.7.8',
    });
    expect(getClientIp(req)).toBe('203.0.113.42');
  });

  it("returns 'unknown' when the headers are present but carry no address", () => {
    const req = makeRequest({ 'x-real-ip': '   ', 'x-forwarded-for': ' , ' });
    expect(getClientIp(req)).toBe('unknown');
  });
});

describe('audit() — client IP resolution', () => {
  beforeEach(() => {
    mockTxInsert.mockReset();
    mockTxInsert.mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    });
  });

  it('records the resolved client IP, not the first hop of a spoofed header', async () => {
    const req = makeRequest({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8' });

    await audit('org-1', 'user-1', 'auth.login', undefined, { req });

    expect(getInsertPayload().ip).toBe('5.6.7.8');
  });

  it('records the proxy-vouched x-real-ip when it is present', async () => {
    const req = makeRequest({
      'x-real-ip': '203.0.113.42',
      'x-forwarded-for': '1.2.3.4, 5.6.7.8',
    });

    await audit('org-1', 'user-1', 'auth.login', undefined, { req });

    expect(getInsertPayload().ip).toBe('203.0.113.42');
  });
});
