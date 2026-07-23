import { NextResponse, type NextRequest } from 'next/server';

const PUBLIC_PATHS = [
  '/login',
  '/signup',
  '/magic-link',
  '/forgot-password',
  '/reset-password',
  '/share/',
  '/api/auth',
  '/api/health',
  '/api/public/',
];

const SESSION_COOKIE = 'dashbi.session';

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname.startsWith(p));
}

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

  const session = req.cookies.get(SESSION_COOKIE)?.value;
  if (!session) {
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
