/**
 * ODD task 5 (part B) — the routes that had NO rate limit at all.
 *
 * Seven routes reached an expensive or a privileged effect with no throttle
 * whatsoever:
 *
 * - `dashboards/[id]/export/pdf` (POST) enqueues a Puppeteer render. The
 *   worker's BullMQ limiter is GLOBAL, so one tenant starves every other
 *   tenant.
 * - `files/commit` (POST) runs DDL (CREATE SCHEMA/TABLE, policies, indexes)
 *   and bulk-inserts up to 1M rows.
 * - `dashboards/[id]/share` (POST) mints a public bearer token.
 * - `dashboards/[id]/embed` (POST) mints an embed token.
 * - `scheduled-reports` (POST) creates a recurring job whose EVERY firing
 *   renders a PDF, so it amplifies into the PDF worker.
 * - `organizations/members` (POST) creates user rows and memberships for
 *   arbitrary emails.
 * - `organizations/llm-key` (PUT/DELETE) writes or removes the tenant's LLM
 *   credential.
 *
 * Each one now checks the same TWO independent buckets the rest of the API
 * uses: an org bucket (`<prefix>:org:<orgId>`) and an IP bucket
 * (`<prefix>:ip:<ip>`). The org bucket is the guarantee the threat model
 * asks for ("rate limit per org"); the IP bucket blunts a single noisy
 * client. A single key carrying both would give every member of the org a
 * personal allowance, so the effective org limit would scale with the
 * number of members.
 *
 * The second half of this file pins the INVARIANT: every route under
 * `src/app/api/**` that reaches an LLM, an outbound HTTP call, a credential
 * write or a PDF export must carry a rate limit. That is what stops the
 * next route from shipping without one.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, globSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ForbiddenError, UnauthorizedError } from '@/lib/auth/context';
import { hasPermission, type OrgRole } from '@/lib/auth/permissions';

const {
  mockRequireAuth,
  mockCheckRateLimit,
  mockWithOrgContext,
  mockAudit,
  mockEnqueuePdfExport,
  mockGeneratePublicToken,
  mockGenerateEmbedToken,
  mockTakeParsedForCommit,
} = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockCheckRateLimit: vi.fn(),
  mockWithOrgContext: vi.fn(),
  mockAudit: vi.fn().mockResolvedValue(undefined),
  mockEnqueuePdfExport: vi.fn().mockResolvedValue('job-1'),
  mockGeneratePublicToken: vi.fn().mockReturnValue('public-token'),
  mockGenerateEmbedToken: vi.fn().mockResolvedValue({ token: 'embed-token' }),
  mockTakeParsedForCommit: vi
    .fn()
    .mockReturnValue({ rows: [{ id: 1, name: 'Alice' }], format: 'csv' }),
}));

vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: mockCheckRateLimit }));

vi.mock('@/lib/auth/request', () => ({ requireAuth: mockRequireAuth }));

vi.mock('@/db/client', () => ({ withOrgContext: mockWithOrgContext, db: {} }));

vi.mock('@/lib/audit/log', () => ({ audit: mockAudit }));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/export/pdf-enqueue', () => ({
  enqueuePdfExport: mockEnqueuePdfExport,
  getPdfJobStatus: vi.fn(),
}));

vi.mock('@/lib/sharing/token', () => ({ generatePublicToken: mockGeneratePublicToken }));

vi.mock('@/lib/embed/token', () => ({
  generateEmbedToken: mockGenerateEmbedToken,
  buildIframeSnippet: vi.fn().mockReturnValue('<iframe></iframe>'),
}));

vi.mock('@/lib/security/encryption', () => ({
  encryptApiKey: vi.fn((value: string) => `enc(${value})`),
}));

vi.mock('@/lib/connectors/parsers/commit-store', () => ({
  takeParsedForCommit: mockTakeParsedForCommit,
}));

vi.mock('@/lib/connectors/parsers/load', () => ({
  buildCreateSchemaSQL: vi.fn(() => 'CREATE SCHEMA'),
  buildCreateTableSQL: vi.fn(() => 'CREATE TABLE'),
  buildIndexSQL: vi.fn(() => []),
  buildRLSPoliciesSQL: vi.fn(() => ({ enable: 'ENABLE', force: 'FORCE', policy: 'POLICY' })),
  buildReadOnlyGrantsSQL: vi.fn(() => 'GRANT'),
  loadRows: vi.fn(async () => 1),
}));

import { POST as exportPdfPost } from '@/app/api/dashboards/[id]/export/pdf/route';
import { POST as commitFiles } from '@/app/api/files/commit/route';
import { POST as shareDashboard } from '@/app/api/dashboards/[id]/share/route';
import { POST as embedDashboard } from '@/app/api/dashboards/[id]/embed/route';
import { POST as createScheduledReport } from '@/app/api/scheduled-reports/route';
import { POST as inviteMember } from '@/app/api/organizations/members/route';
import { PUT as putLlmKey, DELETE as deleteLlmKey } from '@/app/api/organizations/llm-key/route';

/* -------------------------------------------------------------------------- */
/* Harness                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * A token bucket with the same arithmetic as the real one in
 * `@/lib/rate-limit`, keyed by the key the route asks for.
 *
 * The real module is mocked in this file, so what is under test here is
 * WHICH key the route requests and what it answers when that key is empty —
 * not how a bucket refills.
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

/** The authenticated context `requireAuth` resolves to. */
const authContext = {
  userId: 'user-1',
  email: 'user@example.com',
  orgId: 'org-1',
  role: 'admin' as OrgRole,
};

/** Rows the fake `select()` returns; each route needs a different answer. */
let selectRows: Record<string, unknown>[] = [];

function makeTx() {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => selectRows,
          orderBy: async () => selectRows,
        }),
      }),
    }),
    query: {
      dashboards: {
        findFirst: async () => selectRows[0] ?? null,
      },
    },
    insert: () => ({
      values: (values: Record<string, unknown>) => ({
        returning: async () => [{ id: 'created-1', ...values }],
      }),
    }),
    update: () => ({
      set: () => ({ where: async () => undefined }),
    }),
    execute: async () => [],
  };
}

function jsonRequest(url: string, method: string, body: unknown, ip: string): Request {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  });
}

const DASHBOARD_PARAMS = { params: Promise.resolve({ id: 'dash-1' }) };
const DASHBOARD_ID = '11111111-1111-4111-a111-111111111111';

type RouteCase = {
  label: string;
  /** Documented capacity of the org bucket. */
  orgCapacity: number;
  /** Documented capacity of the IP bucket. */
  ipCapacity: number;
  /** Status the route answers when nothing is throttled. */
  successStatus: number;
  /** Rows the fake `select()` returns for this route. */
  selectRows: Record<string, unknown>[];
  request: (ip: string) => Request;
  invoke: (req: Request) => Promise<Response>;
};

const ROUTES: RouteCase[] = [
  {
    label: 'POST /api/dashboards/[id]/export/pdf',
    orgCapacity: 10,
    ipCapacity: 20,
    successStatus: 202,
    selectRows: [],
    request: (ip) =>
      jsonRequest('http://localhost/api/dashboards/dash-1/export/pdf', 'POST', {}, ip),
    invoke: (req) => exportPdfPost(req, DASHBOARD_PARAMS),
  },
  {
    label: 'POST /api/files/commit',
    orgCapacity: 10,
    ipCapacity: 20,
    successStatus: 201,
    selectRows: [{ id: 'file-1', targetTable: 'org_o1.sales' }],
    request: (ip) =>
      jsonRequest(
        'http://localhost/api/files/commit',
        'POST',
        {
          fileId: DASHBOARD_ID,
          name: 'Sales Q1',
          columns: [{ name: 'id', type: 'number', nullable: false }],
        },
        ip,
      ),
    invoke: (req) => commitFiles(req),
  },
  {
    label: 'POST /api/dashboards/[id]/share',
    orgCapacity: 20,
    ipCapacity: 50,
    successStatus: 201,
    selectRows: [{ id: 'dash-1' }],
    request: (ip) => jsonRequest('http://localhost/api/dashboards/dash-1/share', 'POST', {}, ip),
    invoke: (req) => shareDashboard(req, DASHBOARD_PARAMS),
  },
  {
    label: 'POST /api/dashboards/[id]/embed',
    orgCapacity: 20,
    ipCapacity: 50,
    successStatus: 201,
    selectRows: [{ id: 'dash-1' }],
    request: (ip) => jsonRequest('http://localhost/api/dashboards/dash-1/embed', 'POST', {}, ip),
    invoke: (req) => embedDashboard(req, DASHBOARD_PARAMS),
  },
  {
    label: 'POST /api/scheduled-reports',
    orgCapacity: 10,
    ipCapacity: 20,
    successStatus: 201,
    selectRows: [{ id: 'dash-1' }],
    request: (ip) =>
      jsonRequest(
        'http://localhost/api/scheduled-reports',
        'POST',
        {
          dashboardId: DASHBOARD_ID,
          cron: '0 9 * * 1',
          recipients: [{ email: 'cfo@corp.com' }],
        },
        ip,
      ),
    invoke: (req) => createScheduledReport(req),
  },
  {
    label: 'POST /api/organizations/members',
    orgCapacity: 30,
    ipCapacity: 50,
    successStatus: 201,
    selectRows: [],
    request: (ip) =>
      jsonRequest(
        'http://localhost/api/organizations/members',
        'POST',
        { email: 'newcomer@example.com', role: 'viewer' },
        ip,
      ),
    invoke: (req) => inviteMember(req),
  },
  {
    label: 'PUT /api/organizations/llm-key',
    orgCapacity: 5,
    ipCapacity: 10,
    successStatus: 200,
    selectRows: [],
    request: (ip) =>
      jsonRequest(
        'http://localhost/api/organizations/llm-key',
        'PUT',
        { provider: 'openai', model: 'gpt-4o', apiKey: 'sk-test-key' },
        ip,
      ),
    invoke: (req) => putLlmKey(req),
  },
  {
    label: 'DELETE /api/organizations/llm-key',
    orgCapacity: 5,
    ipCapacity: 10,
    successStatus: 200,
    selectRows: [],
    request: (ip) =>
      new Request('http://localhost/api/organizations/llm-key', {
        method: 'DELETE',
        headers: { 'x-forwarded-for': ip },
      }),
    invoke: (req) => deleteLlmKey(req),
  },
];

/** The keys the route asked the limiter for, in call order. */
function limiterKeys(): string[] {
  return mockCheckRateLimit.mock.calls.map((call) => (call[0] as { key: string }).key);
}

function limiterConfigs(): { capacity: number; key: string }[] {
  return mockCheckRateLimit.mock.calls.map((call) => call[0] as { capacity: number; key: string });
}

beforeEach(() => {
  vi.clearAllMocks();
  fakeLimiter.reset();
  mockCheckRateLimit.mockImplementation(fakeLimiter.check);
  mockAudit.mockResolvedValue(undefined);
  mockEnqueuePdfExport.mockResolvedValue('job-1');
  mockGeneratePublicToken.mockReturnValue('public-token');
  mockGenerateEmbedToken.mockResolvedValue({ token: 'embed-token' });
  mockTakeParsedForCommit.mockReturnValue({
    rows: [{ id: 1, name: 'Alice' }],
    format: 'csv',
  });

  authContext.userId = 'user-1';
  authContext.email = 'user@example.com';
  authContext.orgId = 'org-1';
  authContext.role = 'admin';

  selectRows = [];

  // `requireAuth` is mocked, but the PERMISSION MATRIX is the real one: a
  // route that asks for a permission the caller's role does not have must
  // answer 403 exactly as it does in production.
  mockRequireAuth.mockImplementation(async (_req: Request, action: string) => {
    if (!hasPermission(authContext.role, action)) {
      throw new ForbiddenError(`Role '${authContext.role}' cannot perform '${action}'`);
    }
    return { ...authContext };
  });

  mockWithOrgContext.mockImplementation(async (...args: unknown[]) => {
    const fn = args[args.length - 1] as (tx: unknown) => Promise<unknown>;
    return fn(makeTx());
  });
});

/* -------------------------------------------------------------------------- */
/* Per-route contract                                                         */
/* -------------------------------------------------------------------------- */

describe.each(ROUTES)('$label — two-bucket rate limit', (route) => {
  beforeEach(() => {
    selectRows = route.selectRows;
  });

  it('lets the first request through', async () => {
    const res = await route.invoke(route.request('198.51.100.7'));
    expect(res.status).toBe(route.successStatus);
  });

  it('checks an org bucket and an IP bucket, with the documented capacities', async () => {
    await route.invoke(route.request('198.51.100.7'));

    const configs = limiterConfigs();
    const orgConfig = configs.find((c) => c.key.includes('org-1'));
    const ipConfig = configs.find((c) => c.key.includes('198.51.100.7'));

    expect(configs).toHaveLength(2);
    expect(orgConfig?.capacity).toBe(route.orgCapacity);
    expect(ipConfig?.capacity).toBe(route.ipCapacity);
    // Two independent keys: the org bucket does not carry the IP, and the IP
    // bucket does not carry the org-scoped allowance.
    expect(orgConfig?.key).not.toContain('198.51.100.7');
    expect(ipConfig?.key).not.toContain('org-1');
  });

  it('answers 429 with scope "org" once the org bucket is exhausted', async () => {
    for (let i = 0; i < route.orgCapacity; i++) {
      const res = await route.invoke(route.request('198.51.100.7'));
      expect(res.status).toBe(route.successStatus);
    }

    const res = await route.invoke(route.request('198.51.100.7'));

    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toBe('rate_limited');
    expect(body.scope).toBe('org');
    expect(res.headers.get('Retry-After')).toBeTruthy();
  });

  it('answers 429 with scope "ip" once the IP bucket is exhausted', async () => {
    // The IP bucket is shared by every org, the org bucket is not. So the IP
    // allowance is drained across several orgs, and the request that proves
    // the failure comes from an org whose OWN bucket is still fresh — that
    // is what makes the reported scope attributable to the IP bucket.
    const orgIds = ['org-a', 'org-b', 'org-c', 'org-d', 'org-e'];
    let ipUsed = 0;
    let orgIndex = 0;

    while (ipUsed < route.ipCapacity) {
      authContext.orgId = orgIds[orgIndex] ?? `org-${orgIndex}`;
      orgIndex += 1;
      const chunk = Math.min(route.orgCapacity, route.ipCapacity - ipUsed);
      for (let n = 0; n < chunk; n++) {
        const res = await route.invoke(route.request('198.51.100.7'));
        expect(res.status).toBe(route.successStatus);
      }
      ipUsed += chunk;
    }

    authContext.orgId = orgIds[orgIndex] ?? `org-${orgIndex}`;
    const res = await route.invoke(route.request('198.51.100.7'));

    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toBe('rate_limited');
    expect(body.scope).toBe('ip');
    expect(res.headers.get('Retry-After')).toBeTruthy();
  });

  it('limits a second client IP in the same org through the org bucket', async () => {
    for (let i = 0; i < route.orgCapacity; i++) {
      const res = await route.invoke(route.request('198.51.100.7'));
      expect(res.status).toBe(route.successStatus);
    }

    // A different client IP in the SAME org must not get a fresh allowance.
    const res = await route.invoke(route.request('203.0.113.9'));

    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toBe('rate_limited');
    expect(body.scope).toBe('org');
  });

  it('keys the IP bucket by the trusted hop, not the client-controlled one', async () => {
    await route.invoke(route.request('198.51.100.7, 203.0.113.9'));

    const keys = limiterKeys();
    expect(keys.some((k) => k.includes('203.0.113.9'))).toBe(true);
    expect(keys.some((k) => k.includes('198.51.100.7'))).toBe(false);
  });

  it('does not consume a bucket for an unauthenticated request', async () => {
    mockRequireAuth.mockRejectedValueOnce(new UnauthorizedError());

    const res = await route.invoke(route.request('198.51.100.7'));

    expect(res.status).toBe(401);
    expect(mockCheckRateLimit).not.toHaveBeenCalled();
  });
});

describe('POST /api/dashboards/[id]/export/pdf — the permission stays narrowed', () => {
  it('refuses a viewer: exporting is an editor capability', async () => {
    // `export.pdf` was narrowed to ["admin", "editor"] in part A because the
    // PDF worker's BullMQ limiter is global. The route must keep answering
    // 403 to a read-only account, and it must do so BEFORE the bucket.
    authContext.role = 'viewer';

    const res = await exportPdfPost(
      jsonRequest('http://localhost/api/dashboards/dash-1/export/pdf', 'POST', {}, '198.51.100.7'),
      DASHBOARD_PARAMS,
    );

    expect(res.status).toBe(403);
    expect(mockEnqueuePdfExport).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- */
/* The invariant                                                              */
/* -------------------------------------------------------------------------- */

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/**
 * What makes a route "sensitive" — the effect it reaches that a throttle
 * has to protect.
 *
 * The patterns are deliberately narrow: they must match the CALL, not the
 * prose around it, or a comment would classify a harmless route.
 */
const SENSITIVE_MARKERS: ReadonlyArray<{ category: string; pattern: RegExp }> = [
  { category: 'llm', pattern: /new\s+AiGateway\(|@\/lib\/ai\/gateway/ },
  { category: 'outbound-http', pattern: /deliverToChannel\(|\.testConnection\(|\bfetch\(/ },
  {
    category: 'credential-write',
    pattern: /encryptApiKey\(|generatePublicToken\(|generateEmbedToken\(/,
  },
  { category: 'pdf-export', pattern: /enqueuePdfExport\(/ },
  { category: 'bulk-ddl', pattern: /buildCreateTableSQL\(|loadRows\(/ },
  { category: 'account-creation', pattern: /\.insert\(\s*users\s*\)/ },
  { category: 'recurring-export-job', pattern: /\.insert\(\s*scheduledReports\s*\)/ },
];

/**
 * The routes the classifier is expected to find.
 *
 * Pinned on purpose: without it the classifier could silently degrade to
 * "found nothing" and the invariant would pass without checking anything.
 * A new sensitive route shows up here as a diff, and the assertion below
 * tells you to give it a rate limit.
 */
const EXPECTED_SENSITIVE_ROUTES = [
  'src/app/api/alert-rules/[id]/test-channel/route.ts',
  'src/app/api/dashboards/[id]/embed/route.ts',
  'src/app/api/dashboards/[id]/export/pdf/route.ts',
  'src/app/api/dashboards/[id]/share/route.ts',
  'src/app/api/dashboards/generate/route.ts',
  'src/app/api/data-sources/[id]/test/route.ts',
  'src/app/api/data-sources/route.ts',
  'src/app/api/files/commit/route.ts',
  'src/app/api/nlqa/ask/route.ts',
  'src/app/api/organizations/llm-key/route.ts',
  'src/app/api/organizations/members/route.ts',
  'src/app/api/scheduled-reports/route.ts',
  'src/app/api/widgets/explain/route.ts',
];

function categoriesOf(source: string): string[] {
  return SENSITIVE_MARKERS.filter((marker) => marker.pattern.test(source)).map(
    (marker) => marker.category,
  );
}

describe('invariant: every sensitive API route carries a rate limit', () => {
  const routes = globSync('src/app/api/**/route.ts', { cwd: APP_DIR }).sort();

  it('discovers the API routes', () => {
    expect(routes.length).toBeGreaterThan(30);
  });

  it('classifies exactly the routes that reach a sensitive effect', () => {
    const classified = routes.filter(
      (route) => categoriesOf(readFileSync(path.join(APP_DIR, route), 'utf8')).length > 0,
    );
    expect(classified).toEqual(EXPECTED_SENSITIVE_ROUTES);
  });

  it.each(routes.filter((route) =>
    categoriesOf(readFileSync(path.join(APP_DIR, route), 'utf8')).length > 0,
  ))('%s has a rate limit', (route) => {
    const source = readFileSync(path.join(APP_DIR, route), 'utf8');
    const categories = categoriesOf(source).join(', ');

    expect(
      source.includes('checkRateLimit'),
      `${route} reaches ${categories} but declares no rate limit — add the two-bucket check`,
    ).toBe(true);
  });
});
