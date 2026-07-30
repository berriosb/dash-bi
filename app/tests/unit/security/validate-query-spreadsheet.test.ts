import { describe, it, expect } from 'vitest';
import {
  validateQuery,
  ValidationError,
} from '@/lib/security/validate-query';
import type { Query } from '@/lib/connectors/types';

describe('validateQuery — spreadsheet branch', () => {
  it('accepts SELECT query on a csv data source', () => {
    const q: Query = {
      kind: 'spreadsheet',
      fileId: 'file-1',
      sql: 'SELECT * FROM sheet1',
    };
    expect(() => validateQuery(q, 'csv')).not.toThrow();
  });

  it('accepts SELECT query on an excel data source', () => {
    const q: Query = {
      kind: 'spreadsheet',
      fileId: 'file-1',
      sql: 'SELECT col_a, SUM(col_b) FROM sheet1 GROUP BY col_a',
    };
    expect(() => validateQuery(q, 'excel')).not.toThrow();
  });

  it('accepts SELECT query on a spreadsheet data source', () => {
    const q: Query = {
      kind: 'spreadsheet',
      fileId: 'file-1',
      sql: 'SELECT id FROM sheet1',
    };
    expect(() => validateQuery(q, 'spreadsheet')).not.toThrow();
  });

  it('rejects a non-spreadsheet query kind on a spreadsheet data source', () => {
    const q: Query = { kind: 'sql', sql: 'SELECT 1' };
    expect(() => validateQuery(q, 'csv')).toThrow(ValidationError);
    expect(() => validateQuery(q, 'excel')).toThrow(ValidationError);
  });

  it('rejects INSERT statements', () => {
    const q: Query = {
      kind: 'spreadsheet',
      fileId: 'f',
      sql: 'INSERT INTO sheet1 VALUES (1)',
    };
    expect(() => validateQuery(q, 'csv')).toThrow(ValidationError);
  });

  it('rejects UPDATE statements', () => {
    const q: Query = {
      kind: 'spreadsheet',
      fileId: 'f',
      sql: 'UPDATE sheet1 SET x = 1',
    };
    expect(() => validateQuery(q, 'csv')).toThrow(ValidationError);
  });

  it('rejects DELETE statements', () => {
    const q: Query = {
      kind: 'spreadsheet',
      fileId: 'f',
      sql: 'DELETE FROM sheet1',
    };
    expect(() => validateQuery(q, 'csv')).toThrow(ValidationError);
  });

  it('rejects DROP statements', () => {
    const q: Query = {
      kind: 'spreadsheet',
      fileId: 'f',
      sql: 'DROP TABLE sheet1',
    };
    expect(() => validateQuery(q, 'csv')).toThrow(ValidationError);
  });

  it('rejects multi-statement queries', () => {
    const q: Query = {
      kind: 'spreadsheet',
      fileId: 'f',
      sql: 'SELECT 1; DROP TABLE sheet1',
    };
    expect(() => validateQuery(q, 'csv')).toThrow(/Multi-statement/);
  });

  it('auto-injects LIMIT 10000 when no LIMIT clause is present', () => {
    const q: Query = {
      kind: 'spreadsheet',
      fileId: 'f',
      sql: 'SELECT * FROM sheet1',
    };
    validateQuery(q, 'csv');
    expect(q.sql).toBe('SELECT * FROM sheet1 LIMIT 10000');
  });

  it('preserves an explicit LIMIT clause', () => {
    const q: Query = {
      kind: 'spreadsheet',
      fileId: 'f',
      sql: 'SELECT * FROM sheet1 LIMIT 50',
    };
    validateQuery(q, 'csv');
    expect(q.sql).toBe('SELECT * FROM sheet1 LIMIT 50');
  });

  it('strips trailing semicolons before injecting LIMIT', () => {
    const q: Query = {
      kind: 'spreadsheet',
      fileId: 'f',
      sql: 'SELECT * FROM sheet1;',
    };
    validateQuery(q, 'csv');
    expect(q.sql).toBe('SELECT * FROM sheet1 LIMIT 10000');
  });

  it('blocks the viewer role from accessing sensitive columns', () => {
    const q: Query = {
      kind: 'spreadsheet',
      fileId: 'f',
      sql: 'SELECT password FROM sheet1',
    };
    expect(() => validateQuery(q, 'csv', 'viewer')).toThrow(/PII/);
  });

  it('blocks the viewer role from accessing api_key columns', () => {
    const q: Query = {
      kind: 'spreadsheet',
      fileId: 'f',
      sql: 'SELECT email, api_key FROM sheet1',
    };
    expect(() => validateQuery(q, 'csv', 'viewer')).toThrow(/PII/);
  });

  it('allows the editor role to access sensitive columns', () => {
    const q: Query = {
      kind: 'spreadsheet',
      fileId: 'f',
      sql: 'SELECT password FROM sheet1',
    };
    expect(() => validateQuery(q, 'csv', 'editor')).not.toThrow();
  });

  it('allows the admin role to access sensitive columns', () => {
    const q: Query = {
      kind: 'spreadsheet',
      fileId: 'f',
      sql: 'SELECT password FROM sheet1',
    };
    expect(() => validateQuery(q, 'csv', 'admin')).not.toThrow();
  });

  it('accepts WITH (CTE) queries', () => {
    const q: Query = {
      kind: 'spreadsheet',
      fileId: 'f',
      sql: 'WITH t AS (SELECT 1 AS x) SELECT * FROM t',
    };
    expect(() => validateQuery(q, 'csv')).not.toThrow();
  });

  it('accepts EXPLAIN queries', () => {
    const q: Query = {
      kind: 'spreadsheet',
      fileId: 'f',
      sql: 'EXPLAIN SELECT * FROM sheet1',
    };
    expect(() => validateQuery(q, 'csv')).not.toThrow();
  });
});
