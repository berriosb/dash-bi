/**
 * T9 — `POST /api/alert-rules/[id]/test-channel` fired an outbound HTTP
 * request with no rate limit at all.
 *
 * The route decrypts the user's stored webhook and delivers to it, returning
 * the provider's response. `validateOutboundUrl` is in place (T6), so it is
 * not SSRF against private ranges — but it is an egress amplifier: one
 * authenticated user could drive unlimited requests at an arbitrary public
 * host from this app's infrastructure, and read the responses back. That is
 * enough to port-scan a third party's public ports, or to DDoS someone using
 * this box as the source.
 *
 * Rate limited on two axes, like `/api/dashboards/generate`: per org, so one
 * tenant cannot exhaust a shared allowance, and per IP, so a single account
 * with many members cannot sidestep the org bucket.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockRequireAuth, mockCheckRateLimit, mockDeliverToChannel, mockWithOrgContext } =
  vi.hoisted(() => ({
    mockRequireAuth: vi.fn(),
    mockCheckRateLimit: vi.fn(),
    mockDeliverToChannel: vi.fn(),
    mockWithOrgContext: vi.fn(),
  }));

vi.mock('@/lib/auth/request', () => ({ requireAuth: mockRequireAuth }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: mockCheckRateLimit }));
vi.mock('@/lib/alerts/channels', () => ({ deliverToChannel: mockDeliverToChannel }));

vi.mock('@/db/client', () => ({
  withOrgContext: mockWithOrgContext,
  db: {},
}));

import { POST } from '@/app/api/alert-rules/[id]/test-channel/route';

const RULE_ID = '00000000-0000-4000-a000-0000000000cc';

function makeRequest(ip = '203.0.113.9'): Request {
  return new Request(`http://localhost:3000/api/alert-rules/${RULE_ID}/test-channel`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({ channelIndex: 0 }),
  });
}

const params = Promise.resolve({ id: RULE_ID });

describe('POST /api/alert-rules/[id]/test-channel — rate limit (T9)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({
      session: { user: { id: 'user-123' } },
      orgId: '00000000-0000-4000-a000-000000000001',
      userId: 'user-123',
      role: 'owner',
    });
    mockCheckRateLimit.mockReturnValue({ allowed: true, retryAfterSeconds: 0 });
    mockDeliverToChannel.mockResolvedValue({ ok: true });
    mockWithOrgContext.mockImplementation(
      async (_orgId: string, _userId: string, fn: (tx: unknown) => Promise<unknown>) => {
        const fakeTx = {
          select: () => ({
            from: () => ({
              where: () => ({
                limit: () => [
                  {
                    id: RULE_ID,
                    name: 'Regla',
                    orgId: '00000000-0000-4000-a000-000000000001',
                    channels: [{ type: 'webhook', url: 'enc', headers: {} }],
                    condition: { metric: 'm', operator: 'gt', threshold: 1 },
                  },
                ],
              }),
            }),
          }),
        };
        return fn(fakeTx);
      },
    );
  });

  it('allows the first delivery through', async () => {
    const res = await POST(makeRequest(), { params });
    expect(res.status).toBe(200);
    expect(mockDeliverToChannel).toHaveBeenCalledTimes(1);
  });

  it('returns 429 and does NOT deliver when the org bucket is empty', async () => {
    mockCheckRateLimit.mockReturnValue({ allowed: false, retryAfterSeconds: 42 });

    const res = await POST(makeRequest(), { params });

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('42');
    // The important half: no outbound request may happen on a rejected call,
    // otherwise the limit only reduces the error responses, not the traffic.
    expect(mockDeliverToChannel).not.toHaveBeenCalled();
  });

  it('checks both an org bucket and an IP bucket', async () => {
    await POST(makeRequest(), { params });
    const keys = mockCheckRateLimit.mock.calls.map((c) => (c[0] as { key: string }).key);
    expect(keys.some((k) => k.startsWith('test-channel:org:'))).toBe(true);
    expect(keys.some((k) => k.startsWith('test-channel:ip:'))).toBe(true);
  });

  it('scopes the IP bucket to the forwarded client, not a shared default', async () => {
    await POST(makeRequest('198.51.100.7'), { params });
    const keys = mockCheckRateLimit.mock.calls.map((c) => (c[0] as { key: string }).key);
    expect(keys.some((k) => k.includes('198.51.100.7'))).toBe(true);
    expect(keys.some((k) => k.includes('unknown'))).toBe(false);
  });

  it('rate limits BEFORE decrypting the channel or touching the database', async () => {
    // Ordering matters as much as presence. If the check ran after the DB read
    // a throttled caller could still enumerate which rule ids exist in the org
    // from response timing.
    mockCheckRateLimit.mockReturnValue({ allowed: false, retryAfterSeconds: 5 });
    mockWithOrgContext.mockClear();

    await POST(makeRequest(), { params });

    expect(mockWithOrgContext).not.toHaveBeenCalled();
  });
});
