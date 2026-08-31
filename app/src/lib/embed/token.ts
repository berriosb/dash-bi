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

function getSecretKey(): string {
  return (
    process.env.LLM_KEY_ENCRYPTION_KEY ||
    process.env.BETTER_AUTH_SECRET ||
    'dashbi_embed_fallback_secret_key_32bytes_hex_1234'
  );
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

  const raw = tokenString.slice(4);
  const parts = raw.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { valid: false, error: 'invalid_signature' };
  }

  const payloadBase64 = parts[0];
  const providedSignature = parts[1];

  const expectedSignature = createHmac('sha256', getSecretKey())
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

  // Check allowed origins
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
 * Generate a Content-Security-Policy `frame-ancestors` directive based on allowed origins.
 */
export function getCspFrameAncestors(allowedOrigins: string[]): string {
  if (!allowedOrigins || allowedOrigins.length === 0) {
    return "frame-ancestors 'self';";
  }

  if (allowedOrigins.includes('*')) {
    return 'frame-ancestors *;';
  }

  return `frame-ancestors ${allowedOrigins.join(' ')};`;
}

/**
 * Construct an embed iframe HTML snippet.
 */
export function buildIframeSnippet(token: string, baseUrl: string = 'http://localhost:3000'): string {
  const embedUrl = `${baseUrl.replace(/\/$/, '')}/embed/${token}`;
  return `<iframe src="${embedUrl}" width="100%" height="600" frameborder="0" allowtransparency="true" loading="lazy"></iframe>`;
}
