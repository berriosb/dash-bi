import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { toUserError } from '@/lib/errors/to-user-error';
import { statusFromCode } from '@/lib/errors/types';
import { LLMBudgetExceededError } from '@/lib/ai/quota';
import { getCspFrameAncestors } from '@/lib/embed/token';
import {
  encryptAlertChannels,
  maskAlertChannels,
} from '@/lib/alerts/schemas';
import { decryptApiKey } from '@/lib/security/encryption';
import nextConfig from '../../../next.config';

const APP_ROOT = resolve(__dirname, '../../..');

describe('Bloque 4 — API Contracts, Web Security & UX', () => {
  describe('toUserError — maps business errors to 404, 409, and 402 instead of 500', () => {
    it('maps __code: not_found to not_found (404)', () => {
      const err = Object.assign(new Error('Dashboard not found'), { __code: 'not_found' });
      const appErr = toUserError(err, 'corr-1');
      expect(appErr.code).toBe('not_found');
      expect(statusFromCode(appErr.code)).toBe(404);
    });

    it('maps __code: conflict to conflict (409)', () => {
      const err = Object.assign(new Error('CONCURRENCY_CONFLICT'), { __code: 'conflict' });
      const appErr = toUserError(err, 'corr-2');
      expect(appErr.code).toBe('conflict');
      expect(statusFromCode(appErr.code)).toBe(409);
    });

    it('maps LLMBudgetExceededError to llm.budget_exceeded (402)', () => {
      const err = new LLMBudgetExceededError(5, 5);
      const appErr = toUserError(err, 'corr-3');
      expect(appErr.code).toBe('llm.budget_exceeded');
      expect(statusFromCode(appErr.code)).toBe(402);
    });

    it('maps alert.quota_exceeded to tenant.quota_exceeded (402)', () => {
      const err = Object.assign(new Error('Quota exceeded'), { code: 'alert.quota_exceeded' });
      const appErr = toUserError(err, 'corr-4');
      expect(appErr.code).toBe('tenant.quota_exceeded');
      expect(statusFromCode(appErr.code)).toBe(402);
    });
  });

  describe('Alert channel encryption & masking (H3)', () => {
    it('encrypts slack webhookUrl and custom webhook url at rest and masks them on read', () => {
      const channels = [
        {
          type: 'slack' as const,
          webhookUrl: 'https://hooks.slack.com/services/T00/B00/SECRET123',
          channelLabel: '#alerts',
        },
        {
          type: 'webhook' as const,
          url: 'https://example.com/webhook-secret',
        },
      ];

      const encrypted = encryptAlertChannels(channels);
      expect(encrypted[0]?.type).toBe('slack');
      if (encrypted[0]?.type === 'slack') {
        expect(encrypted[0].webhookUrl).not.toContain('hooks.slack.com');
        expect(decryptApiKey(encrypted[0].webhookUrl)).toBe(
          'https://hooks.slack.com/services/T00/B00/SECRET123',
        );
      }

      const masked = maskAlertChannels(encrypted);
      if (masked[0]?.type === 'slack') {
        expect(masked[0].webhookUrl).toBe('[REDACTED]');
      }
      if (masked[1]?.type === 'webhook') {
        expect(masked[1].url).toBe('[REDACTED]');
      }
    });
  });

  describe('Embed X-Frame-Options & CSP sanitization (H1)', () => {
    it('excludes /embed/ routes from X-Frame-Options: DENY in next.config.ts', async () => {
      const headers = await nextConfig.headers!();
      const denyRule = headers.find((h) =>
        h.headers.some((hdr) => hdr.key === 'X-Frame-Options' && hdr.value === 'DENY'),
      );
      expect(denyRule?.source).toContain('(?!embed/)');
    });

    it('sanitizes allowedOrigins in getCspFrameAncestors against directive injection', () => {
      const csp = getCspFrameAncestors([
        'https://portal.cliente.cl/path',
        'https://evil.com; script-src unsafe-inline',
      ]);
      expect(csp).toBe('frame-ancestors https://portal.cliente.cl;');
    });
  });

  describe('Open redirect protection in login page (H2)', () => {
    it('validates redirect starts with single slash in login/page.tsx', () => {
      const loginSrc = readFileSync(
        resolve(APP_ROOT, 'src/app/(auth)/login/page.tsx'),
        'utf8',
      );
      expect(loginSrc).toContain("startsWith('/')");
      expect(loginSrc).toContain("!rawRedirect.startsWith('//')");
    });
  });

  describe('DOM XSS prevention in renderPdf & App Router error/new pages', () => {
    it('uses document.createElement("img") instead of innerHTML in render-pdf.ts', () => {
      const renderPdfSrc = readFileSync(
        resolve(APP_ROOT, 'src/worker/render-pdf.ts'),
        'utf8',
      );
      expect(renderPdfSrc).not.toContain('innerHTML');
      expect(renderPdfSrc).toContain("createElement('img')");
    });

    it('provides /dashboards/new/page.tsx, error.tsx, and not-found.tsx', () => {
      expect(
        existsSync(resolve(APP_ROOT, 'src/app/(dashboard)/dashboards/new/page.tsx')),
      ).toBe(true);
      expect(existsSync(resolve(APP_ROOT, 'src/app/error.tsx'))).toBe(true);
      expect(existsSync(resolve(APP_ROOT, 'src/app/not-found.tsx'))).toBe(true);
    });
  });
});
