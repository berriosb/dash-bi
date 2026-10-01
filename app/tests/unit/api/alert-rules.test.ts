/**
 * CRITICAL-2 — cross-tenant isolation for alert rules.
 *
 * `alert_rules` has no RLS policies, so the route handler is the only
 * isolation boundary between tenants. These tests drive the real handlers
 * with a drizzle stand-in that behaves like Postgres: it records the WHERE
 * clause the handler emitted and only returns the rows that clause matches.
 * A missing `org_id` predicate therefore leaks another tenant's rows
 * (querySql, condition, encrypted channel URLs) in the response body.
 *
 * Route: /api/dashboards/[id]/alerts (GET + POST)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import type { SQL } from 'drizzle-orm';
import { alertRules, dashboards, orgs } from '@/db/schema';
import { db } from '@/db/client';
import { GET, POST } from '@/app/api/dashboards/[id]/alerts/route';

const ORG_ID = '00000000-0000-4000-a000-000000000001';
const OTHER_ORG_ID = '00000000-0000-4000-a000-0000000f00f';
const USER_ID = 'user-123';
const DASH_ID = '00000000-0000-4000-a000-0000000000aa';
const RULE_ID = '00000000-0000-4000-a000-0000000000cc';

vi.mock('@/lib/auth/request', () => ({
  requireAuth: vi.fn().mockResolvedValue({
    session: { user: { id: 'user-123', email: 'admin@dash-bi.local' } },
    orgId: '00000000-0000-4000-a000-000000000001',
    userId: 'user-123',
    role: 'owner',
  }),
}));

vi.mock('@/db/client', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  withOrgContext: vi.fn((orgId, userId, fn) => fn(db)),
}));

// ─────────────────────────────────────────────────────────────────────
// Drizzle stand-in
// ─────────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;
type RenderedWhere = { sql: string; params: unknown[] };
type RecordedSelect = { table: unknown; where: RenderedWhere | null };
type RecordedInsert = { table: unknown; values: Row };

type QueryBuilder = {
  from: (table: unknown) => QueryBuilder;
  where: (condition: unknown) => QueryBuilder;
  orderBy: (...args: unknown[]) => QueryBuilder;
  limit: (...args: unknown[]) => QueryBuilder;
  then: <TResolved = Row[], TRejected = never>(
    onFulfilled?: ((value: Row[]) => TResolved | PromiseLike<TResolved>) | null,
    onRejected?: ((reason: unknown) => TRejected | PromiseLike<TRejected>) | null,
  ) => Promise<TResolved | TRejected>;
};

type InsertBuilder = {
  values: (values: Row) => InsertBuilder;
  returning: () => Promise<Row[]>;
};

const QUERY_CONFIG = {
  casing: {
    get: (column: { name: string }) => column.name,
    getColumnCasing: (column: { name: string }) => column.name,
  },
  escapeName: (name: string) => `"${name}"`,
  escapeParam: (index: number) => `$${index}`,
  escapeString: (value: string) => `'${value}'`,
} as unknown as Parameters<SQL['toQuery']>[0];

/** Compile a drizzle condition so tests can assert on sql text and params. */
function renderWhere(condition: unknown): RenderedWhere {
  const { sql, params } = (condition as SQL).toQuery(QUERY_CONFIG);
  return { sql, params: [...params] };
}

function toCamelCase(column: string): string {
  return column.replace(/_([a-z])/g, (_match, char: string) => char.toUpperCase());
}

/**
 * Minimal row filter: applies every `"table"."column" = $n` predicate of the
 * recorded WHERE clause. A handler that forgets the org predicate gets rows
 * it should not see — exactly like a Postgres without RLS.
 */
function rowsMatchingWhere(rows: Row[], where: RenderedWhere): Row[] {
  const columns = [...where.sql.matchAll(/"[a-z_]+"\."([a-z_]+)"\s*=/g)].map((match) =>
    toCamelCase(match[1] as string),
  );
  if (columns.length === 0) return rows;
  return rows.filter((row) =>
    columns.every((column, index) => row[column] === where.params[index]),
  );
}

let dashboardRows: Row[] = [];
let alertRuleRows: Row[] = [];
let insertResult: Row[] = [];
let selects: RecordedSelect[] = [];
let inserts: RecordedInsert[] = [];

function rowsForTable(table: unknown): Row[] {
  if (table === orgs) return [{ id: ORG_ID, plan: 'pro' }];
  if (table === dashboards) return dashboardRows;
  if (table === alertRules) return alertRuleRows;
  return [];
}

function recordedSelect(table: unknown): RecordedSelect | undefined {
  return selects.find((entry) => entry.table === table);
}

function recordedAlertRuleInserts(): RecordedInsert[] {
  return inserts.filter((entry) => entry.table === alertRules);
}

function alertRulePayload(overrides: Row = {}): Row {
  return {
    name: 'Ingresos fuera de rango',
    description: 'Avisa cuando los ingresos caen',
    querySql: 'SELECT revenue FROM revenue_daily LIMIT 1',
    queryColumns: { value: 'revenue' },
    condition: { kind: 'threshold_above', threshold: 1000 },
    evaluationIntervalMinutes: 5,
    evaluationWindowMinutes: 5,
    consecutiveBreachesToFire: 1,
    channels: [{ type: 'email', recipients: ['ops@empresa.com'], subject: 'Ingresos' }],
    cooldownMinutes: 60,
    ...overrides,
  };
}

function getRequest(dashboardId: string): Request {
  return new Request(`http://localhost:3000/api/dashboards/${dashboardId}/alerts`);
}

function postRequest(dashboardId: string, body: Row): Request {
  return new Request(`http://localhost:3000/api/dashboards/${dashboardId}/alerts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  selects = [];
  inserts = [];
  dashboardRows = [{ id: DASH_ID, orgId: ORG_ID, title: 'Revenue' }];
  alertRuleRows = [];
  insertResult = [
    { id: RULE_ID, orgId: ORG_ID, dashboardId: DASH_ID, name: 'Ingresos fuera de rango' },
  ];

  (db.select as Mock).mockImplementation(() => {
    const record: RecordedSelect = { table: undefined, where: null };
    selects.push(record);

    const builder: QueryBuilder = {
      from(table: unknown) {
        record.table = table;
        return builder;
      },
      where(condition: unknown) {
        record.where = renderWhere(condition);
        return builder;
      },
      orderBy() {
        return builder;
      },
      limit() {
        return builder;
      },
      then(onFulfilled, onRejected) {
        const rows = rowsForTable(record.table);
        const matched = record.where ? rowsMatchingWhere(rows, record.where) : rows;
        return Promise.resolve(matched).then(onFulfilled, onRejected);
      },
    };

    return builder;
  });

  (db.insert as Mock).mockImplementation((table: unknown) => {
    const record: RecordedInsert = { table, values: {} };
    inserts.push(record);

    const builder: InsertBuilder = {
      values(values: Row) {
        record.values = values;
        return builder;
      },
      returning() {
        return Promise.resolve(table === alertRules ? insertResult : []);
      },
    };

    return builder;
  });
});

describe('GET /api/dashboards/[id]/alerts — cross-tenant isolation', () => {
  it('scopes the query to the caller org and never returns another tenant rule on the same dashboard', async () => {
    alertRuleRows = [
      {
        id: RULE_ID,
        orgId: ORG_ID,
        dashboardId: DASH_ID,
        name: 'Ingresos fuera de rango',
        querySql: 'SELECT revenue FROM revenue_daily LIMIT 1',
        channels: [{ type: 'email', recipients: ['ops@empresa.com'], subject: 'Ingresos' }],
      },
      {
        id: '00000000-0000-4000-a000-0000000f00f',
        orgId: OTHER_ORG_ID,
        dashboardId: DASH_ID,
        name: 'Secretos de otra org',
        querySql: 'SELECT ssn FROM customers LIMIT 1',
        channels: [{ type: 'webhook', url: 'https://hooks.example.com/other-org' }],
      },
    ];

    const res = await GET(getRequest(DASH_ID), { params: Promise.resolve({ id: DASH_ID }) });

    expect(res.status).toBe(200);

    const emitted = recordedSelect(alertRules)?.where;
    expect(emitted?.sql).toContain('"alert_rules"."org_id"');
    expect(emitted?.params).toEqual([DASH_ID, ORG_ID]);

    const json = await res.json();
    expect(json.rules).toHaveLength(1);
    expect(json.rules[0].orgId).toBe(ORG_ID);
  });

  it('returns the org own rules for a dashboard it owns', async () => {
    alertRuleRows = [
      {
        id: RULE_ID,
        orgId: ORG_ID,
        dashboardId: DASH_ID,
        name: 'Ingresos fuera de rango',
      },
    ];

    const res = await GET(getRequest(DASH_ID), { params: Promise.resolve({ id: DASH_ID }) });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.rules).toHaveLength(1);
    expect(json.rules[0]).toMatchObject({ id: RULE_ID, orgId: ORG_ID, dashboardId: DASH_ID });
  });
});

describe('POST /api/dashboards/[id]/alerts — cross-tenant isolation', () => {
  it('rejects a dashboard owned by another org without inserting a rule', async () => {
    // The dashboard exists — but in another tenant.
    dashboardRows = [{ id: DASH_ID, orgId: OTHER_ORG_ID, title: 'Revenue (otra org)' }];

    const res = await POST(
      postRequest(DASH_ID, alertRulePayload()),
      { params: Promise.resolve({ id: DASH_ID }) },
    );

    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('not_found');
    expect(recordedAlertRuleInserts()).toHaveLength(0);
  });

  it('checks dashboard ownership scoped to the caller org before inserting', async () => {
    dashboardRows = [{ id: DASH_ID, orgId: OTHER_ORG_ID, title: 'Revenue (otra org)' }];

    await POST(postRequest(DASH_ID, alertRulePayload()), {
      params: Promise.resolve({ id: DASH_ID }),
    });

    const lookup = recordedSelect(dashboards)?.where;
    expect(lookup).toBeDefined();
    expect(lookup?.params).toEqual([DASH_ID, ORG_ID]);
    expect(lookup?.sql).toContain('"dashboards"."org_id"');
  });

  it('creates the rule when the dashboard belongs to the caller org', async () => {
    dashboardRows = [{ id: DASH_ID, orgId: ORG_ID, title: 'Revenue' }];

    const res = await POST(postRequest(DASH_ID, alertRulePayload()), {
      params: Promise.resolve({ id: DASH_ID }),
    });

    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.rule).toMatchObject({ id: RULE_ID, orgId: ORG_ID, dashboardId: DASH_ID });

    const inserts_ = recordedAlertRuleInserts();
    expect(inserts_).toHaveLength(1);
    expect(inserts_[0]?.values).toMatchObject({
      orgId: ORG_ID,
      dashboardId: DASH_ID,
      createdBy: USER_ID,
    });
  });
});
