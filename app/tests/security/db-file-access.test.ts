import { describe, it, expect } from 'vitest';
import { validateQuery, ValidationError } from '@/lib/security/validate-query';

/**
 * T7 — the read-only DB role must never be able to read server files.
 *
 * `app/scripts/postgres/init-readonly.sql` used to grant
 * `EXECUTE ON FUNCTION pg_read_file(text)` to `dashbi_readonly`, and
 * `validateQuery`'s forbidden list had no file-reading function in it, so
 * `SELECT pg_read_file('/etc/passwd')` passed validation and executed with
 * the AI-query role's privileges.
 *
 * The GRANT is removed. That init script is gone entirely now — it and its
 * root-level twin were both dead code that no compose file ever mounted, and
 * `scripts/postgres/init-roles.sh` replaced them.
 *
 * What actually enforces this at the database level is PostgreSQL itself.
 * Verified 2026-10-01 against PostgreSQL 16: `has_function_privilege('public',
 * 'pg_read_file(text)', 'EXECUTE')` is false, and running the read as
 * `dashbi_readonly` answers `permission denied for function pg_read_file`.
 * These functions are not granted to PUBLIC out of the box.
 *
 * This suite is therefore belt to that suspenders — it pins the blocklist so a
 * future edit cannot silently reopen the path, and so the guarantee does not
 * rest on a Postgres default nobody has written down.
 */

const FILE_READERS = [
  'pg_read_file',
  'pg_read_binary_file',
  'pg_ls_dir',
  'pg_stat_file',
  'lo_import',
  'lo_export',
  'load_file',
  'into outfile',
  'into dumpfile',
] as const;

const TIMING_AND_EGRESS = ['pg_sleep', 'dblink', 'dblink_connect', 'pg_connect_backend'] as const;

describe('T7 — server file read is blocked for AI-generated SQL', () => {
  describe.each(FILE_READERS)('blocks %s', (fn) => {
    it('postgres', () => {
      expect(() =>
        validateQuery({ kind: 'sql', sql: `SELECT ${fn}('/etc/passwd')` }, 'postgres'),
      ).toThrow(ValidationError);
    });
  });

  it('blocks a bare file read with no column list', () => {
    expect(() =>
      validateQuery({ kind: 'sql', sql: "SELECT pg_read_file('/etc/shadow') AS leak" }, 'postgres'),
    ).toThrow(ValidationError);
  });

  it('blocks it in the spreadsheet path, which also queries Postgres', () => {
    expect(() =>
      validateQuery({ kind: 'sql', sql: "SELECT pg_read_file('/etc/passwd')" }, 'spreadsheet'),
    ).toThrow(ValidationError);
  });

  it('blocks it in the csv alias of the spreadsheet path', () => {
    expect(() =>
      validateQuery({ kind: 'sql', sql: "SELECT pg_read_file('/etc/passwd')" }, 'csv'),
    ).toThrow(ValidationError);
  });

  it('blocks it regardless of case', () => {
    expect(() =>
      validateQuery({ kind: 'sql', sql: "SELECT PG_READ_FILE('/etc/passwd')" }, 'postgres'),
    ).toThrow(ValidationError);
  });

  it('blocks it with an intervening schema-qualified call', () => {
    expect(() =>
      validateQuery(
        { kind: 'sql', sql: "SELECT public.pg_read_file('/etc/passwd')" },
        'postgres',
      ),
    ).toThrow(ValidationError);
  });

  it('blocks it in a CTE, not just the projection', () => {
    expect(() =>
      validateQuery(
        { kind: 'sql', sql: "WITH x AS (SELECT pg_read_file('/etc/passwd') AS f) SELECT * FROM x" },
        'postgres',
      ),
    ).toThrow(ValidationError);
  });

  describe.each(TIMING_AND_EGRESS)('blocks %s', (fn) => {
    it('postgres', () => {
      expect(() =>
        validateQuery({ kind: 'sql', sql: `SELECT ${fn}('x')` }, 'postgres'),
      ).toThrow(ValidationError);
    });
  });
});

describe('T7 — legitimate queries are NOT over-blocked', () => {
  const ALLOWED = [
    "SELECT id, email FROM users",
    "SELECT COUNT(*) FROM orders",
    "SELECT SUM(total) FROM orders GROUP BY day",
    "SELECT name FROM products WHERE name LIKE '%a%'",
    // 'file' as a substring of a normal word must not trip the boundary
    "SELECT filename FROM documents",
    "SELECT * FROM files",
    "SELECT lo_id FROM large_objects",
    "SELECT token_count FROM metrics",
  ];

  it.each(ALLOWED)('allows %s', (sql) => {
    expect(() => validateQuery({ kind: 'sql', sql }, 'postgres')).not.toThrow();
  });
});
