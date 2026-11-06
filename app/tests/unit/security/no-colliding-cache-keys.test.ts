import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * A cache key that two different questions share is a wrong answer served
 * to whoever asks second.
 *
 * The shape of the bug is specific: `JSON.stringify(value, Object.keys(value).sort())`
 * uses a replacer ARRAY, and a replacer array is applied at EVERY level of
 * the value, so every object nested below the top level comes out EMPTY. Two
 * queries that differ only in a nested value — a Stripe `params.limit`, a
 * SQL `params[0].id`, a GA4 `dateRange` — produce the SAME key.
 *
 * The invariant is asserted on the SOURCES, not on one call site: the next
 * cache that reaches for a replacer array breaks this test.
 */
const SRC = resolve(__dirname, '../../../src');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * The comments are stripped before the scan: this file's own documentation
 * quotes the forbidden pattern to explain what it forbids, and a scanner
 * that reads the comments would flag its own explanation.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    // `[^:]` keeps `https://` inside a string from eating the rest of the line.
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('claves de cache', () => {
  it('ninguna se construye con un replacer array de JSON.stringify', () => {
    const offenders: string[] = [];

    for (const file of walk(SRC)) {
      const source = stripComments(readFileSync(file, 'utf8'));
      // `JSON.stringify(val, Object.keys(...))` y `JSON.stringify(val, ['a'])`.
      // Un replacer FUNCIÓN es legítimo: no aplana nada.
      const pattern = /JSON\.stringify\(\s*[^,()]+\s*,\s*(?:Object\.keys\s*\(|\[)/;
      if (pattern.test(source)) offenders.push(file.replace(SRC, 'app/src'));
    }

    expect(
      offenders,
      'una clave de cache con replacer array aplana los objetos anidados y hace colisionar preguntas distintas',
    ).toEqual([]);
  });
});
