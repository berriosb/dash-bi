import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SRC = resolve(__dirname, '../../../src');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : full;
  });
}

/**
 * withSystemContext() used to be `db.transaction(fn)` with a comment claiming
 * it "Bypassea RLS". It never did. It worked only because the app connected as
 * a superuser (HIGH-5), and the moment that was fixed it stopped working: with
 * no GUC set, app_current_org_id() returns the zero UUID and every RLS table
 * reads as empty.
 *
 * So the honest version of the old comment — "NO usar en /app/api/" — was never
 * enforced by anything. These tests enforce it, because the failure mode is
 * silent: a request handler that reads through it gets zero rows and looks like
 * a data problem, not a security one.
 */

describe('withSystemContext is not used from request handlers', () => {
  const routeFiles = walk(join(SRC, 'app/api')).filter((f) => f.endsWith('.ts'));

  it('finds the route handlers (guards a silently empty glob)', () => {
    expect(routeFiles.length).toBeGreaterThan(20);
  });

  for (const file of routeFiles) {
    const rel = file.slice(SRC.length + 1);
    it(`${rel} does not call withSystemContext`, () => {
      const source = readFileSync(file, 'utf8');
      // Ignore the import and the doc comment; only calls matter.
      const calls = source
        .split('\n')
        .filter((line) => /withSystemContext\s*\(/.test(line))
        .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'));
      expect(
        calls,
        `${rel} calls withSystemContext. A request handler knows which org it is\n` +
          'acting for — use withOrgContext, which is subject to RLS. If this\n' +
          'really needs to cross orgs, it needs a named SECURITY DEFINER\n' +
          'function, not a transaction wrapper that silently reads nothing.',
      ).toEqual([]);
    });
  }
});

describe('withSystemContext says what it actually does', () => {
  const client = readFileSync(join(SRC, 'db/client.ts'), 'utf8');

  /** The JSDoc block immediately above the function. */
  function docComment(): string {
    const start = client.indexOf('export async function withSystemContext');
    const before = client.slice(0, start);
    const open = before.lastIndexOf('/**');
    return open === -1 ? '' : before.slice(open);
  }

  it('no longer claims it bypasses RLS', () => {
    // Matched on the doc block, not the whole file: the new comment has to be
    // able to say "it never did" without tripping its own assertion.
    expect(docComment()).not.toMatch(/Bypassea RLS/);
    expect(docComment()).toMatch(/does not bypass RLS/i);
  });

  it('explains that it is subject to RLS like any other transaction', () => {
    expect(docComment()).toMatch(/subject to RLS|sujeta a RLS/i);
  });

  it('points at the two legitimate alternatives', () => {
    expect(docComment()).toContain('withOrgContext');
    expect(docComment()).toContain('SECURITY DEFINER');
  });
});
