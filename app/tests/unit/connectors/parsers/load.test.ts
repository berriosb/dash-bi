import { describe, it, expect } from 'vitest';
import {
  buildCreateSchemaSQL,
  buildCreateTableSQL,
  buildDropTableSQL,
  buildIndexSQL,
  buildRLSPoliciesSQL,
} from '@/lib/connectors/parsers/load';
import type { InferredColumn } from '@/lib/connectors/parsers/infer-types';

const SAMPLE_COLUMNS: InferredColumn[] = [
  { name: 'id', type: 'number', nullable: false, samples: [] },
  { name: 'name', type: 'string', nullable: false, samples: [] },
  { name: 'created_at', type: 'date', nullable: true, samples: [] },
  { name: 'is_active', type: 'boolean', nullable: false, samples: [] },
];

describe('buildCreateSchemaSQL', () => {
  it('emits CREATE SCHEMA IF NOT EXISTS with a quoted identifier', () => {
    expect(buildCreateSchemaSQL('org_abc')).toBe(
      'CREATE SCHEMA IF NOT EXISTS "org_abc"',
    );
  });

  it('quotes the identifier to prevent injection', () => {
    const sql = buildCreateSchemaSQL('a"; DROP TABLE x; --');
    expect(sql).toContain('"a""; DROP TABLE x; --"');
  });
});

describe('buildCreateTableSQL', () => {
  it('emits CREATE TABLE with _row_id PK, org_id, and column defs', () => {
    const sql = buildCreateTableSQL('org_a.sales', SAMPLE_COLUMNS);
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "org_a"."sales"');
    expect(sql).toContain('"_row_id" BIGSERIAL PRIMARY KEY');
    expect(sql).toContain('"org_id" UUID NOT NULL');
    expect(sql).toContain('"id" BIGINT NOT NULL');
    expect(sql).toContain('"name" TEXT NOT NULL');
    expect(sql).toContain('"created_at" DATE');
    expect(sql).toContain('"is_active" BOOLEAN NOT NULL');
  });

  it('maps inferred types to Postgres types', () => {
    const cols: InferredColumn[] = [
      { name: 'a', type: 'number', nullable: false, samples: [] },
      { name: 'b', type: 'string', nullable: false, samples: [] },
      { name: 'c', type: 'date', nullable: false, samples: [] },
      { name: 'd', type: 'boolean', nullable: false, samples: [] },
      { name: 'e', type: 'json', nullable: false, samples: [] },
    ];
    const sql = buildCreateTableSQL('s.t', cols);
    expect(sql).toContain('"a" BIGINT NOT NULL');
    expect(sql).toContain('"b" TEXT NOT NULL');
    expect(sql).toContain('"c" DATE NOT NULL');
    expect(sql).toContain('"d" BOOLEAN NOT NULL');
    expect(sql).toContain('"e" JSONB NOT NULL');
  });

  it('throws on a non-schema-qualified target table', () => {
    expect(() => buildCreateTableSQL('sales', [])).toThrow(
      /schema-qualified/,
    );
  });

  it('normalizes column names through the header normalizer', () => {
    const cols: InferredColumn[] = [
      { name: 'Order Date', type: 'date', nullable: false, samples: [] },
    ];
    const sql = buildCreateTableSQL('s.t', cols);
    expect(sql).toContain('"order_date"');
  });
});

describe('buildRLSPoliciesSQL', () => {
  it('emits ENABLE ROW LEVEL SECURITY plus a USING policy', () => {
    const { enable, policy } = buildRLSPoliciesSQL('org_a.sales');
    expect(enable).toBe(
      'ALTER TABLE "org_a"."sales" ENABLE ROW LEVEL SECURITY',
    );
    expect(policy).toContain('DROP POLICY IF EXISTS "org_isolation_sales"');
    expect(policy).toContain(
      'CREATE POLICY "org_isolation_sales" ON "org_a"."sales"',
    );
    expect(policy).toContain('USING (org_id = app_current_org_id())');
  });

  it('throws on a non-schema-qualified target table', () => {
    expect(() => buildRLSPoliciesSQL('sales')).toThrow(/schema-qualified/);
  });
});

describe('buildIndexSQL', () => {
  it('emits indexes for date and string columns only', () => {
    const out = buildIndexSQL('org_a.sales', SAMPLE_COLUMNS);
    expect(out).toHaveLength(2);
    expect(out.some((s) => s.includes('"created_at"'))).toBe(true);
    expect(out.some((s) => s.includes('"name"'))).toBe(true);
    expect(out.some((s) => s.includes('"id"'))).toBe(false);
    expect(out.some((s) => s.includes('"is_active"'))).toBe(false);
  });

  it('limits to 5 indexes even if more date/string columns exist', () => {
    const cols: InferredColumn[] = [];
    for (let i = 0; i < 10; i++) {
      cols.push({ name: `col_${i}`, type: 'string', nullable: false, samples: [] });
    }
    const out = buildIndexSQL('s.t', cols);
    expect(out).toHaveLength(5);
  });

  it('uses CREATE INDEX IF NOT EXISTS', () => {
    const out = buildIndexSQL('s.t', [
      { name: 'name', type: 'string', nullable: false, samples: [] },
    ]);
    expect(out[0]).toMatch(/^CREATE INDEX IF NOT EXISTS/);
  });

  it('returns empty array for non-schema-qualified target tables', () => {
    expect(buildIndexSQL('sales', [])).toEqual([]);
  });
});

describe('buildDropTableSQL', () => {
  it('emits DROP TABLE IF EXISTS with CASCADE', () => {
    expect(buildDropTableSQL('org_a.sales')).toBe(
      'DROP TABLE IF EXISTS "org_a"."sales" CASCADE',
    );
  });

  it('throws on a non-schema-qualified target table', () => {
    expect(() => buildDropTableSQL('sales')).toThrow(/schema-qualified/);
  });
});
