import { describe, it, expect } from 'vitest';
import { validateQuery, ValidationError } from '@/lib/security/validate-query';
import type { ConnectorType, Query } from '@/lib/connectors/types';

/**
 * The shared blocklist (`buildForbiddenPattern`) is the layer that decides
 * what actually runs against a customer's database. It used to miss four
 * escapes that the threat model claims are closed:
 *
 *  - `set_config` / `current_setting`: every tenant-scoped RLS policy reads
 *    the org through `app_current_org_id()`, which reads the
 *    `app.current_org_id` GUC. A statement that calls `set_config` can
 *    re-point that GUC mid-statement, or set `role` on the customer's own
 *    database.
 *  - `INTO`: `SELECT * INTO evil FROM orders` is CTAS — it creates a table,
 *    i.e. DDL, in the customer's database.
 *  - `COPY` / `PROGRAM`: `COPY orders TO PROGRAM '...'` is command execution
 *    on MySQL, and `COPY` is DDL-ish on Postgres.
 *
 * The blocklist has to be the SAME for every SQL-backed connector. The
 * shopify branch used to check only the leading keyword, so a blocked token
 * walked straight through it.
 */

/** Connectors whose query kind is `sql`. */
const SQL_CONNECTORS: ConnectorType[] = [
  'postgres',
  'mysql',
  'hubspot',
  'snowflake',
  'shopify',
];

/** Connectors whose query kind is `spreadsheet` (csv/excel share it). */
const SPREADSHEET_CONNECTORS: ConnectorType[] = ['spreadsheet', 'csv', 'excel'];

function sqlQuery(sql: string): Query {
  return { kind: 'sql', sql, params: [] };
}

function spreadsheetQuery(sql: string): Query {
  return { kind: 'spreadsheet', fileId: 'file-1', sql };
}

function queryFor(connector: ConnectorType, sql: string): Query {
  return SPREADSHEET_CONNECTORS.includes(connector) ? spreadsheetQuery(sql) : sqlQuery(sql);
}

/**
 * Every blocked statement below STARTS with SELECT/WITH, so the leading
 * keyword check cannot be the thing that rejects them. That isolates the
 * shared blocklist: if the token were still missing from the list, the
 * statement would sail through and the test would fail.
 */
const BLOCKED_STATEMENTS: Array<{ name: string; sql: string }> = [
  {
    name: 'set_config re-points the tenant GUC',
    sql: "SELECT set_config('app.current_org_id', '11111111-1111-1111-1111-111111111111', true)",
  },
  {
    name: 'current_setting reads the tenant GUC',
    sql: "SELECT current_setting('app.current_user_role', true)",
  },
  {
    name: 'SELECT ... INTO is CTAS (DDL)',
    sql: 'SELECT * INTO evil FROM orders',
  },
  {
    name: 'COPY ... TO PROGRAM executes a command',
    sql: "WITH c AS (COPY orders TO PROGRAM 'sh -c id') SELECT * FROM c",
  },
  {
    name: 'pg_terminate_backend kills another session',
    sql: 'SELECT pg_terminate_backend(1234)',
  },
];

describe('validateQuery — blocked statements', () => {
  describe.each(SQL_CONNECTORS)('%s rejects the blocked tokens', (connector) => {
    it.each(BLOCKED_STATEMENTS)('$name', ({ sql }) => {
      expect(() => validateQuery(queryFor(connector, sql), connector)).toThrow(ValidationError);
    });

    it.each(BLOCKED_STATEMENTS)('$name — rejected by the blocklist, not by the leading keyword', ({ sql }) => {
      // "Only SELECT queries allowed" is the leading-keyword rejection; the
      // blocklist rejection is the "forbidden … not allowed" one. A statement
      // that starts with SELECT can only be stopped by the blocklist.
      expect(() => validateQuery(queryFor(connector, sql), connector)).toThrow(
        /forbidden|not allowed/i,
      );
    });
  });

  describe.each(SPREADSHEET_CONNECTORS)('%s rejects the blocked tokens', (connector) => {
    it.each(BLOCKED_STATEMENTS)('$name', ({ sql }) => {
      expect(() => validateQuery(queryFor(connector, sql), connector)).toThrow(ValidationError);
    });
  });

  it('rejects a bare COPY ... TO PROGRAM statement', () => {
    expect(() =>
      validateQuery(sqlQuery("COPY orders TO PROGRAM 'sh -c id'"), 'postgres'),
    ).toThrow(ValidationError);
  });

  it('rejects set_config in a mysql query', () => {
    expect(() =>
      validateQuery(
        sqlQuery("SELECT set_config('app.current_org_id', 'x', true)"),
        'mysql',
      ),
    ).toThrow(/forbidden|not allowed/i);
  });

  it('rejects set_config in a snowflake query', () => {
    expect(() =>
      validateQuery(
        sqlQuery("SELECT set_config('app.current_org_id', 'x', true)"),
        'snowflake',
      ),
    ).toThrow(/forbidden|not allowed/i);
  });

  it('rejects set_config in a hubspot query', () => {
    expect(() =>
      validateQuery(
        sqlQuery("SELECT set_config('app.current_org_id', 'x', true)"),
        'hubspot',
      ),
    ).toThrow(/forbidden|not allowed/i);
  });

  it('rejects set_config in a spreadsheet query', () => {
    expect(() =>
      validateQuery(
        spreadsheetQuery("SELECT set_config('app.current_org_id', 'x', true)"),
        'spreadsheet',
      ),
    ).toThrow(/forbidden|not allowed/i);
  });
});

describe('validateQuery — the shopify branch uses the shared blocklist', () => {
  it('rejects a blocked token', () => {
    expect(() =>
      validateQuery(sqlQuery("SELECT set_config('app.current_org_id', 'x', true)"), 'shopify'),
    ).toThrow(/forbidden|not allowed/i);
  });

  it('rejects a multi-statement query', () => {
    expect(() =>
      validateQuery(sqlQuery('SELECT 1; DROP TABLE users'), 'shopify'),
    ).toThrow(/Multi-statement/);
  });

  it('still accepts a plain SELECT and returns the statement unchanged', () => {
    const query = sqlQuery('SELECT id FROM orders');
    expect(() => validateQuery(query, 'shopify')).not.toThrow();
    // The shopify branch does not normalize a LIMIT — the connector only
    // reads the SQL to pick a REST resource.
    expect(validateQuery(query, 'shopify')).toBe('SELECT id FROM orders');
  });
});

describe('validateQuery — ordinary reads still pass', () => {
  it('accepts a plain SELECT with an explicit LIMIT', () => {
    const query = sqlQuery('SELECT id FROM orders LIMIT 10');
    expect(() => validateQuery(query, 'postgres')).not.toThrow();
    expect(validateQuery(query, 'postgres')).toBe('SELECT id FROM orders LIMIT 10');
  });

  it('accepts a CTE', () => {
    expect(() =>
      validateQuery(sqlQuery('WITH recent AS (SELECT id FROM orders) SELECT * FROM recent'), 'postgres'),
    ).not.toThrow();
  });

  it('accepts a column named into_count — the blocklist is word-bounded', () => {
    // `\b` is not a boundary between `_` and a word character, so a
    // snake_case column that merely CONTAINS a blocked word is not a
    // blocked word.
    expect(() => validateQuery(sqlQuery('SELECT into_count FROM orders'), 'postgres')).not.toThrow();
  });

  it('accepts a column named copy_count for the same reason', () => {
    expect(() => validateQuery(sqlQuery('SELECT copy_count FROM orders'), 'postgres')).not.toThrow();
  });

  it('still injects the LIMIT when the statement is accepted', () => {
    expect(validateQuery(sqlQuery('SELECT id FROM orders'), 'postgres')).toBe(
      'SELECT id FROM orders LIMIT 10000',
    );
  });
});

describe('validateQuery — known, accepted over-blocks (both fail closed)', () => {
  // These are the false positives the blocklist accepts on purpose. They
  // are locked here so a future "narrow the list" change has to come with
  // a decision, not by accident.
  it('rejects a column literally named copy', () => {
    expect(() => validateQuery(sqlQuery('SELECT copy FROM orders'), 'postgres')).toThrow(
      /forbidden|not allowed/i,
    );
  });

  it('rejects a string literal containing the word into', () => {
    expect(() =>
      validateQuery(sqlQuery("SELECT 'copied into the archive' AS note"), 'postgres'),
    ).toThrow(/forbidden|not allowed/i);
  });
});
