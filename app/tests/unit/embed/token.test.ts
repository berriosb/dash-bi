import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  generateEmbedToken,
  verifyEmbedToken,
  buildIframeSnippet,
  getCspFrameAncestors,
  type EmbedTokenPayload,
} from '@/lib/embed/token';

describe('Embed Token Utilities', () => {
  const secretKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  beforeEach(() => {
    vi.stubEnv('LLM_KEY_ENCRYPTION_KEY', secretKey);
  });

  describe('generateEmbedToken & verifyEmbedToken', () => {
    it('generates a verifiable embed token with payload', async () => {
      const payload: Omit<EmbedTokenPayload, 'token' | 'createdAt'> = {
        dashboardId: 'dash-123',
        orgId: 'org-456',
        allowedOrigins: ['https://app.example.com'],
        theme: 'moderno-saas',
        hideTitle: true,
        allowExport: false,
        expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
      };

      const result = await generateEmbedToken(payload);
      expect(result.token).toBeDefined();
      expect(typeof result.token).toBe('string');
      expect(result.token.startsWith('emb_')).toBe(true);

      const verification = await verifyEmbedToken(result.token, 'https://app.example.com');
      expect(verification.valid).toBe(true);
      expect(verification.payload?.dashboardId).toBe('dash-123');
      expect(verification.payload?.orgId).toBe('org-456');
      expect(verification.payload?.hideTitle).toBe(true);
      expect(verification.payload?.theme).toBe('moderno-saas');
    });

    it('rejects an expired token', async () => {
      const pastDate = new Date(Date.now() - 1000).toISOString();
      const payload: Omit<EmbedTokenPayload, 'token' | 'createdAt'> = {
        dashboardId: 'dash-123',
        orgId: 'org-456',
        allowedOrigins: ['*'],
        expiresAt: pastDate,
      };

      const { token } = await generateEmbedToken(payload);
      const verification = await verifyEmbedToken(token);
      expect(verification.valid).toBe(false);
      expect(verification.error).toBe('expired');
    });

    it('rejects a token with invalid/tampered signature', async () => {
      const payload: Omit<EmbedTokenPayload, 'token' | 'createdAt'> = {
        dashboardId: 'dash-123',
        orgId: 'org-456',
        allowedOrigins: ['*'],
      };

      const { token } = await generateEmbedToken(payload);
      const tamperedToken = token.slice(0, -4) + 'abcd';

      const verification = await verifyEmbedToken(tamperedToken);
      expect(verification.valid).toBe(false);
      expect(verification.error).toBe('invalid_signature');
    });

    it('validates allowed origins properly', async () => {
      const payload: Omit<EmbedTokenPayload, 'token' | 'createdAt'> = {
        dashboardId: 'dash-123',
        orgId: 'org-456',
        allowedOrigins: ['https://trusted.com', 'https://sub.trusted.com'],
      };

      const { token } = await generateEmbedToken(payload);

      // Matching origin
      const validOrigin = await verifyEmbedToken(token, 'https://trusted.com');
      expect(validOrigin.valid).toBe(true);

      // Subdomain matching
      const validSubOrigin = await verifyEmbedToken(token, 'https://sub.trusted.com');
      expect(validSubOrigin.valid).toBe(true);

      // Unauthorized origin
      const invalidOrigin = await verifyEmbedToken(token, 'https://evil.com');
      expect(invalidOrigin.valid).toBe(false);
      expect(invalidOrigin.error).toBe('invalid_origin');
    });

    it('accepts any origin if allowedOrigins includes "*"', async () => {
      const payload: Omit<EmbedTokenPayload, 'token' | 'createdAt'> = {
        dashboardId: 'dash-123',
        orgId: 'org-456',
        allowedOrigins: ['*'],
      };

      const { token } = await generateEmbedToken(payload);
      const res = await verifyEmbedToken(token, 'https://random-site.org');
      expect(res.valid).toBe(true);
    });
  });

  describe('getCspFrameAncestors', () => {
    it('returns frame-ancestors * when allowedOrigins contains *', () => {
      expect(getCspFrameAncestors(['*'])).toBe("frame-ancestors *;");
    });

    it('formats multiple origins into frame-ancestors directive', () => {
      expect(getCspFrameAncestors(['https://a.com', 'https://b.com'])).toBe(
        "frame-ancestors https://a.com https://b.com;"
      );
    });

    it('returns frame-ancestors \'self\' when allowedOrigins is empty', () => {
      expect(getCspFrameAncestors([])).toBe("frame-ancestors 'self';");
    });
  });

  describe('buildIframeSnippet', () => {
    it('generates an iframe HTML string with default properties', () => {
      const snippet = buildIframeSnippet('emb_test_token', 'https://dash-bi.com');
      expect(snippet).toContain('<iframe');
      expect(snippet).toContain('src="https://dash-bi.com/embed/emb_test_token"');
      expect(snippet).toContain('width="100%"');
      expect(snippet).toContain('frameborder="0"');
    });
  });
});
