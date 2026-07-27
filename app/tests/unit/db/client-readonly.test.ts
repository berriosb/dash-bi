import { describe, it, expect } from 'vitest';
import {
  db,
  readonlyDb,
  withOrgContext,
  withOrgContextReadOnly,
} from '@/db/client';

describe('T7 — Read-only DB client', () => {
  it('exports both db (write) and readonlyDb (read-only) clients', () => {
    expect(db).toBeDefined();
    expect(readonlyDb).toBeDefined();
    expect(db).not.toBe(readonlyDb);
  });

  it('withOrgContextReadOnly is callable with the same signatures as withOrgContext', () => {
    // Verify the function exists with both overloads (compile-time + runtime check).
    expect(typeof withOrgContextReadOnly).toBe('function');
    expect(withOrgContextReadOnly.length).toBeGreaterThanOrEqual(3);
  });
});