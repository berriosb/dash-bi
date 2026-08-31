import { NextResponse, type NextRequest } from 'next/server';

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
const SESSION_COOKIE_NAMES = ['dashbi.session_token', 'dashbi.session'];

function hasSessionCookie(req: NextRequest): boolean {
  for (const name of SESSION_COOKIE_NAMES) {
    if (req.cookies.get(name)?.value) return true;
  }
  return false;
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

// Exported for unit testing only. Do NOT use in app code.
// See tests/unit/middleware/public-paths.test.ts.
export const __testing = { PUBLIC_PATHS, isPublicPath, hasSessionCookie };

export function middleware(req: NextRequest) {
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
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)'],
};
