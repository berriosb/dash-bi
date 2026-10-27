import { NextResponse, type NextRequest } from 'next/server';
import { getCspFrameAncestors, verifyEmbedToken } from '@/lib/embed/token';

const PUBLIC_PATHS = [
  '/',
  '/login',
  '/signup',
  '/magic-link',
  '/forgot-password',
  '/reset-password',
  '/share/',
  '/embed/',
  '/demo/',
  '/api/auth',
  '/api/health',
  '/api/public/',
];

// better-auth session cookie name (configurable via advanced.cookiePrefix).
// Sprint 1: better-auth genera cookies con prefijo 'dashbi.session_token' o similar.
// Ver https://better-auth.com/docs/concepts/session#cookie-cache para el nombre exacto.
const SESSION_COOKIE_NAMES = [
  'dashbi.session_token',
  'dashbi.session',
  'better-auth.session_token',
  'better-auth.session',
  '__Secure-dashbi.session_token',
];

function hasSessionCookie(req: NextRequest): boolean {
  for (const name of SESSION_COOKIE_NAMES) {
    if (req.cookies.get(name)?.value) return true;
  }
  const allCookies = req.cookies.getAll();
  return allCookies.some((c) => c.name.includes('session_token') || c.name.includes('session'));
}

function isPublicPath(pathname: string): boolean {
  // SECURITY: `startsWith` alone is unsafe. Without the trailing-slash
  // guard, '/login' would match '/loginv2' or '/dashboards-extra' could
  // collide with '/dashboards'. Match each entry as either exact (only
  // for the singleton '/') or with a forced trailing-slash boundary so
  // /login only matches /login and /login/** — never /loginv2.
  if (pathname === '/') return PUBLIC_PATHS.includes('/');
  for (const p of PUBLIC_PATHS) {
    if (p === '/') continue;
    if (pathname === p) return true;
    if (pathname.startsWith(p.endsWith('/') ? p : `${p}/`)) return true;
  }
  return false;
}

/**
 * The strictest `frame-ancestors` value: nobody may frame the page.
 *
 * It is the fallback for an embed token that cannot be verified here. An
 * unverifiable token must never widen the framing policy, so the answer is
 * "no one", not "anyone".
 */
const STRICTEST_FRAME_ANCESTORS = "frame-ancestors 'none';";

function isEmbedPath(pathname: string): boolean {
  return pathname === '/embed' || pathname.startsWith('/embed/');
}

/**
 * Extract the embed token from `/embed/<token>`.
 *
 * The token is `emb_<base64url payload>.<base64url signature>`; the dot is
 * part of the token, not a file extension.
 */
function extractEmbedToken(pathname: string): string | null {
  if (!pathname.startsWith('/embed/')) return null;
  const raw = pathname.slice('/embed/'.length);
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * Build the `Content-Security-Policy` header for an embed response.
 *
 * The header is scoped to the token's OWN allowed origins: the token is
 * verified here (signature + expiry + origin) and its `allowedOrigins` list
 * becomes the `frame-ancestors` directive. A token that cannot be verified
 * degrades to `frame-ancestors 'none'` — never to a permissive value.
 *
 * This is the browser-side enforcement the embed route was missing:
 * `next.config.ts` excludes `/embed/` from `X-Frame-Options: DENY`, so
 * before this header the only guard was the server-side origin check, which
 * is skipped when the request carries no `Origin`/`Referer` at all.
 */
async function embedCspHeader(req: NextRequest): Promise<string> {
  const token = extractEmbedToken(req.nextUrl.pathname);
  if (!token) return STRICTEST_FRAME_ANCESTORS;

  // Same origin resolution the embed page uses: `Origin` first, `Referer`
  // as the fallback (a browser that frames the page sends `Referer`).
  const requestOrigin = req.headers.get('origin') ?? req.headers.get('referer') ?? undefined;

  let verification: Awaited<ReturnType<typeof verifyEmbedToken>>;
  try {
    verification = await verifyEmbedToken(token, requestOrigin);
  } catch {
    // The middleware must never break the request: an unverifiable token
    // gets the strictest framing policy instead.
    return STRICTEST_FRAME_ANCESTORS;
  }

  if (!verification.valid || !verification.payload) {
    return STRICTEST_FRAME_ANCESTORS;
  }

  return getCspFrameAncestors(verification.payload.allowedOrigins);
}

// Exported for unit testing only. Do NOT use in app code.
// See tests/unit/middleware/public-paths.test.ts.
export const __testing = { PUBLIC_PATHS, isPublicPath, hasSessionCookie };

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Correlation ID: propagate from header if present, otherwise generate.
  // Set on both request (for downstream handlers) and response (for client + logs).
  const correlationId =
    req.headers.get('x-correlation-id') ?? `req_${crypto.randomUUID()}`;

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-correlation-id', correlationId);
  requestHeaders.set('x-request-id', correlationId);
  requestHeaders.set(
    'x-org-id',
    req.headers.get('x-org-id') ?? req.cookies.get('dashbi.activeOrgId')?.value ?? '',
  );

  if (isPublicPath(pathname)) {
    const response = NextResponse.next({ request: { headers: requestHeaders } });
    response.headers.set('x-correlation-id', correlationId);
    if (isEmbedPath(pathname)) {
      // The middleware ONLY sets the header; it never rejects the embed
      // request. The page keeps deciding what to render.
      response.headers.set('Content-Security-Policy', await embedCspHeader(req));
    }
    return response;
  }

  // Sprint 1 v0.2: placeholder check basado en cookie name. En Sprint 2+
  // cambiar a `await auth.api.getSession({ headers: req.headers })` cuando
  // queramos validación criptográfica del session token. Por ahora, presence
  // del cookie es suficiente (better-auth hace la validación real en /api/auth/*).
  if (!hasSessionCookie(req)) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('redirect', pathname);
    const redirectResponse = NextResponse.redirect(url);
    redirectResponse.headers.set('x-correlation-id', correlationId);
    return redirectResponse;
  }

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('x-correlation-id', correlationId);
  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)',
    // The embed token is `emb_<payload>.<signature>`: it CONTAINS a dot, so
    // the matcher above treats `/embed/...` as "a file with an extension"
    // and skips it. Without this entry the middleware never runs for an
    // embed and the per-token CSP is never emitted.
    '/embed/:path*',
  ],
  // Node.js runtime: the embed CSP needs the token's HMAC, which reads the
  // secret from the runtime environment (`EMBED_TOKEN_SECRET`). The Edge
  // runtime inlines `process.env` at BUILD time, and the Docker build has
  // no secret, so on Edge every verification would fail and every embed
  // would fall back to `frame-ancestors 'none'` — blocking it.
  runtime: 'nodejs',
};
