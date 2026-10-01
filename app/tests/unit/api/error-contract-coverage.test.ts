import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';

/**
 * T8 — one error contract for the whole API.
 *
 * `errorResponse()` in `src/lib/errors/response.ts` is the single place where
 * an error becomes a status code plus a body. Nine handlers were still
 * hand-rolling it, and the hand-rolled versions failed in three distinct ways:
 * two returned a raw `error.message` to the client, one reported every failure
 * as 401, and six dropped `code` and `correlationId` from the body while
 * omitting the `x-correlation-id` header.
 *
 * This is a guard, not a test of behaviour: the audit already measured the
 * per-handler damage, and the point here is that the list cannot quietly grow
 * again. Any new route that skips the helper fails the build.
 */

/**
 * Routes that legitimately do not use the contract:
 *
 * - `auth/[...all]` is better-auth's catch-all. It owns its own error shape
 *   and its own status mapping; wrapping it would break its protocol.
 * - `health` is an unauthenticated liveness probe. It must stay trivially
 *   cheap and must not leak an AppError envelope to a load balancer.
 */
const EXEMPT = new Set([
  'src/app/api/auth/[...all]/route.ts',
  'src/app/api/health/route.ts',
]);

describe('T8 guard: every API route uses the canonical error contract', () => {
  const routes = globSync('src/app/api/**/route.ts').sort();

  it('discovers the API routes', () => {
    expect(routes.length).toBeGreaterThan(30);
  });

  it.each(routes.filter((r) => !EXEMPT.has(r)))(
    '%s routes errors through errorResponse()',
    (route) => {
      const source = readFileSync(route, 'utf8');
      expect(
        source.includes('errorResponse'),
        `${route} does not use errorResponse() from @/lib/errors/response`,
      ).toBe(true);
    },
  );

  it('exempts only the two documented routes', () => {
    // If someone adds a route to EXEMPT to silence this guard, the count
    // below is what makes that visible in the diff.
    expect(EXEMPT.size).toBe(2);
    for (const route of EXEMPT) {
      expect(routes).toContain(route);
    }
  });
});
