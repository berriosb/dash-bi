import { createHmac, timingSafeEqual } from 'crypto';

export interface EmbedTokenPayload {
  token?: string;
  dashboardId: string;
  orgId: string;
  allowedOrigins: string[];
  theme?: 'moderno-saas' | 'corporate' | 'transparent';
  hideTitle?: boolean;
  allowExport?: boolean;
  expiresAt?: string | null;
  createdAt?: string;
}

export interface EmbedVerifyResult {
  valid: boolean;
  payload?: EmbedTokenPayload;
  error?: 'expired' | 'invalid_signature' | 'invalid_origin' | 'not_found';
}

export class EmbedTokenSecretError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmbedTokenSecretError';
  }
}

/**
 * Resolve the HMAC key used to sign embed tokens.
 *
 * T6: there is deliberately NO hardcoded fallback. A committed default
 * would let anyone forge a token for any org offline, which turns the
 * embed route into an unauthenticated read path across tenants. A
 * misconfigured deployment must fail loudly instead.
 */
function getSecretKey(): string {
  const key = process.env.EMBED_TOKEN_SECRET || process.env.LLM_KEY_ENCRYPTION_KEY || process.env.BETTER_AUTH_SECRET;
  if (!key || key.trim().length === 0) {
    throw new EmbedTokenSecretError(
      'Embed token secret is not configured. Set EMBED_TOKEN_SECRET (recommended), LLM_KEY_ENCRYPTION_KEY, or BETTER_AUTH_SECRET.',
    );
  }
  return key;
}

/**
 * Generate a cryptographically signed HMAC token for dashboard embedding.
 * Format: `emb_${base64UrlPayload}.${base64UrlSignature}`
 */
export async function generateEmbedToken(
  options: Omit<EmbedTokenPayload, 'token' | 'createdAt'>
): Promise<{ token: string; payload: EmbedTokenPayload }> {
  const fullPayload: EmbedTokenPayload = {
    ...options,
    createdAt: new Date().toISOString(),
  };

  const payloadString = Buffer.from(JSON.stringify(fullPayload), 'utf8').toString('base64url');
  const signature = createHmac('sha256', getSecretKey())
    .update(payloadString)
    .digest('base64url');

  const token = `emb_${payloadString}.${signature}`;
  return {
    token,
    payload: {
      ...fullPayload,
      token,
    },
  };
}

/**
 * Verify an embed token's signature, expiration, and allowed HTTP origins.
 */
export async function verifyEmbedToken(
  tokenString: string,
  requestOrigin?: string
): Promise<EmbedVerifyResult> {
  if (!tokenString || !tokenString.startsWith('emb_')) {
    return { valid: false, error: 'invalid_signature' };
  }

  // An unconfigured deployment must not validate anything: without a key we
  // cannot distinguish a real token from a forgery. Fail closed rather than
  // throw, since this runs on the public embed read path.
  let secretKey: string;
  try {
    secretKey = getSecretKey();
  } catch {
    return { valid: false, error: 'invalid_signature' };
  }

  const raw = tokenString.slice(4);
  const parts = raw.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { valid: false, error: 'invalid_signature' };
  }

  const payloadBase64 = parts[0];
  const providedSignature = parts[1];

  const expectedSignature = createHmac('sha256', secretKey)
    .update(payloadBase64)
    .digest('base64url');

  const sigBufferA = Buffer.from(providedSignature, 'utf8');
  const sigBufferB = Buffer.from(expectedSignature, 'utf8');

  if (sigBufferA.length !== sigBufferB.length || !timingSafeEqual(sigBufferA, sigBufferB)) {
    return { valid: false, error: 'invalid_signature' };
  }

  let payload: EmbedTokenPayload;
  try {
    const jsonStr = Buffer.from(payloadBase64, 'base64url').toString('utf8');
    payload = JSON.parse(jsonStr);
  } catch {
    return { valid: false, error: 'invalid_signature' };
  }

  // Check expiration
  if (payload.expiresAt) {
    const expiry = new Date(payload.expiresAt);
    if (expiry.getTime() < Date.now()) {
      return { valid: false, error: 'expired' };
    }
  }

  // Check allowed origins.
  //
  // DECISION (security P0, task 6): a MISSING `Origin`/`Referer` does NOT
  // fail closed, and the API default `allowedOrigins: ['*']` is left alone.
  //
  // Failing closed on a missing header would break the embed page for a
  // NORMAL browser request: a top-level navigation (someone opening the
  // embed URL directly, or a preview link) sends neither `Origin` nor
  // `Referer`, so the dashboard would refuse to render for a legitimate
  // user. Changing the API default to "no origins" would break every embed
  // whose token was minted without an explicit list — and the tokens
  // already minted keep their own `allowedOrigins` anyway, so the change
  // would only create a split between old and new embeds.
  //
  // The browser-side enforcement is the CSP `frame-ancestors` header that
  // the middleware emits for `/embed/*` (`app/src/middleware.ts`): a
  // browser that frames the page from an origin the token does not allow is
  // blocked by the browser, whatever the request headers said. This origin
  // check stays as defense in depth for the data path.
  //
  // RESIDUAL GAP, stated explicitly: a request with no `Origin`/`Referer`
  // (e.g. `curl`, or an embedder that sets `Referrer-Policy: no-referrer`)
  // passes this check. It can read the rendered dashboard, but it cannot
  // frame it from a disallowed origin.
  if (requestOrigin && payload.allowedOrigins && payload.allowedOrigins.length > 0) {
    const isWildcard = payload.allowedOrigins.includes('*');
    if (!isWildcard) {
      const originMatch = payload.allowedOrigins.some((allowed) => {
        try {
          const allowedUrl = new URL(allowed).origin;
          const reqUrl = new URL(requestOrigin).origin;
          return allowedUrl === reqUrl;
        } catch {
          return allowed === requestOrigin;
        }
      });

      if (!originMatch) {
        return { valid: false, error: 'invalid_origin' };
      }
    }
  }

  return {
    valid: true,
    payload,
  };
}

/**
 * Un origin ya normalizado (`new URL(x).origin`) debe reducirse a este
 * alfabeto antes de entrar al header.
 *
 * El filtro es una allowlist, no una denylist: cualquier cosa que no
 * sea scheme + host + puerto opcional se descarta, incluidos los
 * caracteres de control y los separadores de directiva (`;`) que
 * romperían el CSP en directivas nuevas. Un `allowedOrigins` guardado
 * por un usuario con `https://evil.com; script-src *` inyectaría
 * directivas completas si se interpolara sin filtrar.
 */
const SAFE_ORIGIN = /^https?:\/\/[a-z0-9.-]+(?::\d{1,5})?$/i;

/**
 * Reduce una entrada de `allowedOrigins` a un origin CSP-safe, o `null`
 * si no es confiable.
 *
 * `new URL` ya reduce `https://host/path` a su origin y lanza con
 * entradas que no son URLs, pero acepta esquemas como `javascript:`
 * (origin `null`) y credenciales embebidas, así que la allowlist
 * corrige lo que el parser deja pasar.
 */
function sanitizeFrameAncestorOrigin(candidate: unknown): string | null {
  if (typeof candidate !== 'string') return null;
  const trimmed = candidate.trim();
  if (trimmed === '*') return '*';
  if (trimmed === '') return null;

  let origin: string;
  try {
    origin = new URL(trimmed).origin;
  } catch {
    return null;
  }

  return SAFE_ORIGIN.test(origin) ? origin : null;
}

/**
 * Generate a Content-Security-Policy `frame-ancestors` directive based on allowed origins.
 *
 * La lista se sanea antes de interpolarse: cada entrada se reduce a su
 * origin y cualquier valor con separadores de directiva se descarta. Una
 * lista vacía (o totalmente inválida) degrada a `frame-ancestors 'none'`,
 * que bloquea el framing en vez de emitir un header sin restricciones
 * útiles.
 */
export function getCspFrameAncestors(allowedOrigins: string[]): string {
  if (!Array.isArray(allowedOrigins) || allowedOrigins.length === 0) {
    return "frame-ancestors 'self';";
  }

  if (allowedOrigins.includes('*')) {
    return 'frame-ancestors *;';
  }

  const sanitized = [
    ...new Set(
      allowedOrigins
        .map(sanitizeFrameAncestorOrigin)
        .filter((origin): origin is string => origin !== null),
    ),
  ];

  if (sanitized.length === 0) {
    return "frame-ancestors 'none';";
  }

  return `frame-ancestors ${sanitized.join(' ')};`;
}

/**
 * Construct an embed iframe HTML snippet.
 */
export function buildIframeSnippet(token: string, baseUrl: string = 'http://localhost:3000'): string {
  const embedUrl = `${baseUrl.replace(/\/$/, '')}/embed/${token}`;
  return `<iframe src="${embedUrl}" width="100%" height="600" frameborder="0" allowtransparency="true" loading="lazy"></iframe>`;
}
