import { describe, it, expect, afterEach, vi } from 'vitest';
import { generateEmbedToken, verifyEmbedToken } from '@/lib/embed/token';

/**
 * T6 — embed tokens are the only unauthenticated read path into a tenant's
 * dashboard, so their HMAC secret must never have a hardcoded fallback.
 *
 * With a committed fallback, anyone can forge a token offline for any
 * orgId/dashboardId with allowedOrigins ['*'] and no expiration.
 */
describe('Embed token secret resolution (T6)', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllEnvs();
  });

  const payload = {
    dashboardId: 'dash-123',
    orgId: 'org-456',
    allowedOrigins: ['*'],
    expiresAt: null,
  };

  it('refuses to mint a token when no secret is configured', async () => {
    // Deployments must fail loudly rather than sign with a public constant.
    vi.stubEnv('LLM_KEY_ENCRYPTION_KEY', '');
    vi.stubEnv('BETTER_AUTH_SECRET', '');

    await expect(generateEmbedToken(payload)).rejects.toThrow(
      /secret|encryption key|not configured/i,
    );
  });

  it('refuses to verify a token when no secret is configured', async () => {
    vi.stubEnv('LLM_KEY_ENCRYPTION_KEY', '');
    vi.stubEnv('BETTER_AUTH_SECRET', '');

    // A forged token must not validate just because the server has no key.
    const forged =
      'emb.' +
      Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url') +
      '.' +
      Buffer.from('anything', 'utf8').toString('base64url');

    const result = await verifyEmbedToken(forged);
    expect(result.valid).toBe(false);
  });

  it('rejects a token signed with the previously committed fallback secret', async () => {
    const LEGACY_FALLBACK = 'dashbi_embed_fallback_secret_key_32bytes_hex_1234';
    const fullPayload = { ...payload, createdAt: new Date().toISOString() };
    const payloadBase64 = Buffer.from(JSON.stringify(fullPayload), 'utf8').toString('base64url');
    const signature = await import('node:crypto')
      .then((crypto) =>
        crypto.createHmac('sha256', LEGACY_FALLBACK).update(payloadBase64).digest('base64url'),
      );
    const forgedToken = `emb_${payloadBase64}.${signature}`;

    // Server is configured with a real key.
    vi.stubEnv('LLM_KEY_ENCRYPTION_KEY', 'a'.repeat(64));
    vi.stubEnv('BETTER_AUTH_SECRET', '');

    const result = await verifyEmbedToken(forgedToken);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('invalid_signature');
  });
});
