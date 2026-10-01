import { describe, it, expect } from 'vitest';
import {
  parseQualifiedIdent,
  quoteIdent,
  UnsafeIdentifierError,
} from '@/lib/connectors/parsers/sql-ident';

describe('parseQualifiedIdent — accepts what the app actually produces', () => {
  it('splits a schema-qualified name and quotes both parts', () => {
    const parsed = parseQualifiedIdent('org_abc123.sales');
    expect(parsed.schema).toBe('org_abc123');
    expect(parsed.table).toBe('sales');
    expect(parsed.sql).toBe('"org_abc123"."sales"');
  });

  it('accepts underscores, digits and a leading underscore', () => {
    expect(parseQualifiedIdent('org_a1._row_2').sql).toBe('"org_a1"."_row_2"');
  });

  it('accepts a 63-char identifier on each side (Postgres limit)', () => {
    const long = 'a'.repeat(63);
    expect(parseQualifiedIdent(`${long}.${long}`).sql).toBe(`"${long}"."${long}"`);
  });

  it('rejects a 64-char identifier instead of emitting broken SQL', () => {
    expect(() => parseQualifiedIdent(`org.${'a'.repeat(64)}`)).toThrow(
      UnsafeIdentifierError,
    );
  });
});

describe('parseQualifiedIdent — rejects anything that is not a bare identifier', () => {
  const HOSTILE = [
    ['statement terminator', 'org_a.sales; DROP TABLE users; --'],
    ['embedded quote', 'org_a.sal"es'],
    ['parenthesis call', 'org_a.sales()'],
    ['sub-select', 'org_a.(SELECT 1)'],
    ['whitespace', 'org_a.sales sales2'],
    ['newline', 'org_a.sal\nes'],
    ['comment', 'org_a.sales--'],
    ['comma separated list', 'org_a.sales,org_b.orders'],
    ['three parts', 'public.org_a.sales'],
    ['missing schema', 'sales'],
    ['empty schema', '.sales'],
    ['empty table', 'org_a.'],
    ['empty input', ''],
    ['leading digit', 'org_a.1sales'],
    ['uppercase', 'org_a.Sales'],
    ['hyphen', 'org_a.my-sales'],
    ['unicode homoglyph', 'org_a.sаles'],
    ['dollar sign', 'org_a.sales$1'],
  ] as const;

  for (const [label, hostile] of HOSTILE) {
    it(`rejects ${label}: ${JSON.stringify(hostile)}`, () => {
      expect(() => parseQualifiedIdent(hostile)).toThrow(UnsafeIdentifierError);
    });
  }
});

describe('quoteIdent', () => {
  it('double-quotes an internal quote (defense in depth, not the gate)', () => {
    expect(quoteIdent('a"b')).toBe('"a""b"');
  });

  it('is not the validation boundary — parseQualifiedIdent is', () => {
    // Documents why callers must not reach for quoteIdent on user-ish input:
    // it produces syntactically valid SQL for an identifier we never intended.
    expect(quoteIdent('sales; DROP TABLE users; --')).toBe(
      '"sales; DROP TABLE users; --"',
    );
  });
});
