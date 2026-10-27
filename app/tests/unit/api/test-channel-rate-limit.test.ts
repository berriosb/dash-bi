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
vi.mock('@/lib/audit/log', () => ({ audit: vi.fn().mockResolvedValue(undefined) }));

vi.mock('@/db/client', () => ({
  withOrgContext: mockWithOrgContext,
  db: {},
}));

import { POST } from '@/app/api/alert-rules/[id]/test-channel/route';
import { POST as uploadFile } from '@/app/api/files/upload/route';

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

  it('keys the IP bucket by the trusted hop, not the client-controlled one', async () => {
    // nginx appends the real peer at the END of the forwarded list, so the
    // first hop is whatever the caller wrote. Keying the bucket on it would
    // let a caller mint a fresh bucket per request.
    await POST(makeRequest('198.51.100.7, 203.0.113.9'), { params });
    const keys = mockCheckRateLimit.mock.calls.map((c) => (c[0] as { key: string }).key);
    expect(keys.some((k) => k.includes('203.0.113.9'))).toBe(true);
    expect(keys.some((k) => k.includes('198.51.100.7'))).toBe(false);
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

/**
 * ODD task 5 (part A) — the routes that used to key ONE bucket as
 * `org:<orgId>:ip:<ip>` gave every member of an org a personal allowance,
 * so the effective limit of the whole org scaled with the number of people
 * behind distinct IPs. `dashboards/generate` and `alert-rules/[id]/test-channel`
 * already check two independent buckets; this is the same contract for
 * `files/upload`, which is the route exercised here.
 */
describe('POST /api/files/upload — org bucket is enforced independently of the client IP', () => {
  /**
   * A token bucket that behaves like the real one in `@/lib/rate-limit`
   * (same capacity/refill arithmetic, keyed by the key the route asks for).
   * The real module is mocked in this file, and what is under test here is
   * WHICH key the route requests, not how the bucket refills.
   */
  function createFakeLimiter() {
    const buckets = new Map<string, { tokens: number; lastRefillAt: number }>();
    const check = vi.fn(
      (config: { capacity: number; refillPerSecond: number; key: string }) => {
        const now = Date.now();
        let bucket = buckets.get(config.key);
        if (!bucket) {
          bucket = { tokens: config.capacity, lastRefillAt: now };
          buckets.set(config.key, bucket);
        }
        const elapsedSeconds = (now - bucket.lastRefillAt) / 1000;
        bucket.tokens = Math.min(
          config.capacity,
          bucket.tokens + elapsedSeconds * config.refillPerSecond,
        );
        bucket.lastRefillAt = now;

        if (bucket.tokens >= 1) {
          bucket.tokens -= 1;
          return {
            allowed: true,
            retryAfterSeconds: 0,
            remainingTokens: Math.floor(bucket.tokens),
          };
        }
        const deficit = 1 - bucket.tokens;
        return {
          allowed: false,
          retryAfterSeconds: Math.ceil(deficit / config.refillPerSecond),
          remainingTokens: 0,
        };
      },
    );
    return { check, reset: () => buckets.clear() };
  }

  const fakeLimiter = createFakeLimiter();

  function makeUploadRequest(xff: string): Request {
    const boundary = '----RateLimitBoundary123';
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="sales.csv"',
      'Content-Type: text/csv',
      '',
      'name,age',
      'Alice,30',
      `--${boundary}--`,
      '',
    ].join('\r\n');
    return new Request('http://localhost/api/files/upload', {
      method: 'POST',
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
        'x-forwarded-for': xff,
      },
      body,
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    fakeLimiter.reset();
    mockCheckRateLimit.mockImplementation(fakeLimiter.check);
    mockRequireAuth.mockResolvedValue({
      session: { user: { id: 'user-123' } },
      orgId: 'org-1',
      userId: 'user-123',
      role: 'owner',
    });
    mockWithOrgContext.mockImplementation(
      async (...args: unknown[]) => {
        const fn = args[args.length - 1] as (tx: unknown) => Promise<unknown>;
        const fakeTx = {
          insert: () => ({
            values: () => ({
              returning: async () => [{ id: 'file-uuid-1' }],
            }),
          }),
        };
        return fn(fakeTx);
      },
    );
  });

  it('checks two independent buckets: one scoped to the org, one to the client IP', async () => {
    const res = await uploadFile(makeUploadRequest('198.51.100.7'));
    expect(res.status).toBe(201);

    const keys = mockCheckRateLimit.mock.calls.map((c) => (c[0] as { key: string }).key);
    expect(new Set(keys).size).toBe(2);
    // The org bucket does not mention the IP...
    expect(keys.some((k) => k.includes('org-1') && !k.includes('198.51.100.7'))).toBe(true);
    // ...and the IP bucket does not mention the org-scoped allowance.
    expect(keys.some((k) => k.includes('198.51.100.7'))).toBe(true);
  });

  it('still rejects a second IP in the same org once the org bucket is empty', async () => {
    // The route allows 5 uploads per bucket (capacity 5).
    for (let i = 0; i < 5; i++) {
      const res = await uploadFile(makeUploadRequest('198.51.100.7'));
      expect(res.status).toBe(201);
    }

    // A different client IP in the SAME org must not get a fresh allowance.
    const res = await uploadFile(makeUploadRequest('203.0.113.9'));

    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toBe('rate_limited');
    expect(body.scope).toBe('org');
    expect(res.headers.get('Retry-After')).toBeTruthy();
  });

  it('keys the IP bucket by the trusted hop, not the client-controlled one', async () => {
    await uploadFile(makeUploadRequest('198.51.100.7, 203.0.113.9'));

    const keys = mockCheckRateLimit.mock.calls.map((c) => (c[0] as { key: string }).key);
    expect(keys.some((k) => k.includes('203.0.113.9'))).toBe(true);
    expect(keys.some((k) => k.includes('198.51.100.7'))).toBe(false);
  });
});
