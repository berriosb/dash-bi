import { describe, it, expect, vi } from 'vitest';
import { loadRows } from '@/lib/connectors/parsers/load';
import { safeTableName } from '@/lib/connectors/parsers/normalize';
import {
  buildCreateTableSQL,
  buildDropTableSQL,
  buildRLSPoliciesSQL,
} from '@/lib/connectors/parsers/load';
import type { InferredColumn } from '@/lib/connectors/parsers/infer-types';
import type { Tx } from '@/db/client';

const ORG_ID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';

const COLUMNS: InferredColumn[] = [
  { name: 'Order Date', type: 'date', nullable: true, samples: [] },
  { name: 'Amount', type: 'number', nullable: false, samples: [] },
];

/** Pull the assembled statement out of the drizzle `SQL` object we were handed. */
function rawOf(q: unknown): string {
  const chunks = (q as { queryChunks?: Array<{ value?: unknown }> }).queryChunks ?? [];
  return chunks
    .map((c) =>
      Array.isArray(c.value)
        ? c.value.join('')
        : typeof c.value === 'string'
          ? c.value
          : '',
    )
    .join('');
}

function fakeTx() {
  const executed: string[] = [];
  const tx = {
    execute: vi.fn(async (q: unknown) => {
      executed.push(rawOf(q));
    }),
  };
  return { tx: tx as unknown as Tx, executed };
}

describe('loadRows — the INSERT sink must validate the target table', () => {
  it('quotes the target table instead of interpolating it raw', async () => {
    const { tx, executed } = fakeTx();
    const target = safeTableName('Customers Q1.csv', ORG_ID);

    await loadRows(tx, target, ORG_ID, COLUMNS, [{ 'Order Date': '2024-01-02', Amount: 10 }]);

    expect(executed).toHaveLength(1);
    expect(executed[0]).toMatch(/^INSERT INTO "org_[a-z0-9_]+"\."[a-z0-9_]+" \(/);
    expect(executed[0]).not.toMatch(/INSERT INTO org_/);
  });

  it('refuses to execute when the stored target table is hostile', async () => {
    const { tx, executed } = fakeTx();

    await expect(
      loadRows(
        tx,
        'org_a.sales"; DROP TABLE users; --',
        ORG_ID,
        COLUMNS,
        [{ 'Order Date': '2024-01-02', Amount: 10 }],
      ),
    ).rejects.toThrow();

    expect(executed).toEqual([]);
  });

  it('escapes row values that try to break out of the literal', async () => {
    const { tx, executed } = fakeTx();
    const target = safeTableName('Customers.csv', ORG_ID);

    await loadRows(
      tx,
      target,
      ORG_ID,
      [{ name: 'note', type: 'string', nullable: true, samples: [] }],
      [{ note: "o'brien'); DROP TABLE users; --" }],
    );

    expect(executed[0]).toContain("'o''brien''); DROP TABLE users; --'");
  });
});

describe('SEAM: the table name produced at upload is the one the DDL accepts', () => {
  // Regression lock for a real production break: `safeTableName` emitted an
  // undotted `org_<id>_<base>` while every DDL builder required `schema.table`
  // and threw `targetTable must be schema-qualified`. Each side had tests, so
  // unit coverage was green while `POST /api/files/commit` always failed.
  it('safeTableName output flows into every DDL builder', () => {
    const target = safeTableName('Customers Q1.csv', ORG_ID);

    expect(target).toMatch(/^org_[a-z0-9]+\.[a-z0-9_]+$/);
    expect(() => buildCreateTableSQL(target, COLUMNS)).not.toThrow();
    expect(() => buildRLSPoliciesSQL(target)).not.toThrow();
    expect(() => buildDropTableSQL(target)).not.toThrow();
  });

  it('keeps the org prefix so two orgs never share a schema', () => {
    const a = safeTableName('sales.csv', ORG_ID);
    const b = safeTableName('sales.csv', '00000000-0000-0000-0000-000000000001');
    expect(a.split('.')[0]).not.toBe(b.split('.')[0]);
  });
});
