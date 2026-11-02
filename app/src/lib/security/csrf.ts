/**
 * The CSRF gate: the `Origin` of a state-changing request has to be ours.
 *
 * ## Why `SameSite=Lax` is not enough
 *
 * The session cookie is `SameSite=Lax`, which stops a POST that comes
 * from a DIFFERENT registrable domain. It does not stop a SAME-SITE
 * attacker: a page on `evil.example.com` can POST to `app.example.com`
 * and the cookie travels, because the site is the same.
 *
 * And the attack does not need a preflight: `Content-Type: text/plain`
 * is CORS-safelisted, so a cross-origin `fetch` goes out without one,
 * and `req.json()` parses the body whatever the content type says. That
 * is enough to rotate the BYOK key, invite a member or delete a
 * dashboard.
 *
 * ## Why the `Origin` header is the right signal
 *
 * A browser sends `Origin` on every state-changing request — same-origin
 * included — and it cannot be forged by the page: the browser sets it to
 * the origin of the script that made the request. `Referer` is the
 * fallback for the rare case where `Origin` is absent.
 *
 * ## What is NOT blocked (deliberately)
 *
 * A request with NEITHER `Origin` nor `Referer` is not a browser
 * cross-site request: it is curl, a server-to-server call or a test
 * client, and it has no ambient credential to abuse. Blocking it would
 * break every non-browser client without adding protection.
 *
 * Residual: a browser old enough to send neither header, with
 * `Referrer-Policy: no-referrer`.
 */

/** The methods that change state. */
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export interface OriginCheckInput {
  method: string;
  /** The `Origin` header, verbatim. */
  origin: string | null;
  /** The `Referer` header, verbatim. */
  referer: string | null;
  /** The origin the request was addressed to (derived from the request). */
  requestOrigin: string | null;
  /** Extra origins the deployment trusts (configuration). */
  trustedOrigins: string[];
}

export interface OriginVerdict {
  allowed: boolean;
  /** Why. Useful in the log and in the tests. */
  reason:
    | 'safe-method'
    | 'same-origin'
    | 'no-origin-header'
    | 'null-origin'
    | 'malformed-origin'
    | 'foreign-origin'
    | 'malformed-referer'
    | 'foreign-referer';
}

/**
 * The canonical origin of a URL-ish string, or null when it is not one.
 *
 * `new URL()` drops the default port, so `https://bi.example.com:443` and
 * `https://bi.example.com` are the same origin.
 */
function parseOrigin(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function checkRequestOrigin(input: OriginCheckInput): OriginVerdict {
  const method = (input.method ?? '').toUpperCase();
  if (!UNSAFE_METHODS.has(method)) {
    return { allowed: true, reason: 'safe-method' };
  }

  const allowed = new Set<string>();
  const requestOrigin = parseOrigin(input.requestOrigin);
  if (requestOrigin) allowed.add(requestOrigin);
  for (const trusted of input.trustedOrigins) {
    const parsed = parseOrigin(trusted);
    if (parsed) allowed.add(parsed);
  }

  const rawOrigin = input.origin?.trim();
  if (rawOrigin) {
    // `Origin: null` is what a sandboxed iframe or a `data:` document
    // sends. It is not our origin.
    if (rawOrigin.toLowerCase() === 'null') {
      return { allowed: false, reason: 'null-origin' };
    }
    const parsed = parseOrigin(rawOrigin);
    if (!parsed) return { allowed: false, reason: 'malformed-origin' };
    if (!allowed.has(parsed)) return { allowed: false, reason: 'foreign-origin' };
    return { allowed: true, reason: 'same-origin' };
  }

  const rawReferer = input.referer?.trim();
  if (rawReferer) {
    const parsed = parseOrigin(rawReferer);
    if (!parsed) return { allowed: false, reason: 'malformed-referer' };
    if (!allowed.has(parsed)) return { allowed: false, reason: 'foreign-referer' };
    return { allowed: true, reason: 'same-origin' };
  }

  return { allowed: true, reason: 'no-origin-header' };
}

/**
 * The origins the deployment trusts, from the environment.
 *
 * `BETTER_AUTH_URL` is the app's canonical URL and `NEXT_PUBLIC_APP_URL`
 * is the one it builds its own links with. They can differ from the
 * origin the request came in on (an alias, a preview environment).
 */
export function configuredTrustedOrigins(): string[] {
  const configured = [
    process.env.BETTER_AUTH_URL,
    process.env.NEXT_PUBLIC_APP_URL,
  ];
  return configured.filter((value): value is string => Boolean(value && value.trim()));
}
