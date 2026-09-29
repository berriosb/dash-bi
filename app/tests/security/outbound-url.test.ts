import { describe, it, expect } from 'vitest';
import { validateOutboundUrl, OutboundUrlError } from '@/lib/security/validate-connection';

/**
 * Matches the rejection message rather than the error class on purpose:
 * `toThrow(OutboundUrlError)` silently degrades to "throws anything" while
 * the export does not exist yet, which a TypeError would satisfy.
 */
const REJECTED = /not allowed|not in the allowed|not a valid|blocked|invalid|scheme|private|SSRF/i;

/**
 * T3/T6 — SSRF on outbound HTTP.
 *
 * The webhook alert channel and the embed/share flows make user-supplied
 * HTTP requests from the server. Without validation an authenticated user
 * can point them at cloud metadata endpoints (169.254.169.254) or internal
 * services and read the response through the delivery result.
 *
 * These tests pin the normalization rules that close the classic bypasses:
 * port suffixes, IPv6 brackets, and inet_aton alternate encodings.
 */
describe('validateOutboundUrl — SSRF prevention (T3/T6)', () => {
  it('exports a callable validator and its error type', () => {
    // Guards against the vacuous pass: while the export is missing,
    // `toThrow(OutboundUrlError)` degrades to "throws anything", which a
    // TypeError from calling `undefined` would satisfy.
    expect(typeof validateOutboundUrl).toBe('function');
    expect(typeof OutboundUrlError).toBe('function');
  });

  describe('rejects cloud metadata endpoints', () => {
    it('rejects AWS/Azure metadata by IP', () => {
      expect(() => validateOutboundUrl('http://169.254.169.254/latest/meta-data/'))
        .toThrow(REJECTED);
    });

    it('rejects AWS metadata when a port suffix is appended', () => {
      // The original validatePostgresHost missed this: its patterns are
      // end-anchored, so "169.254.169.254:80" slipped through.
      expect(() => validateOutboundUrl('http://169.254.169.254:80/latest/meta-data/'))
        .toThrow(REJECTED);
    });

    it('rejects GCP metadata by hostname', () => {
      expect(() => validateOutboundUrl('http://metadata.google.internal/computeMetadata/v1/'))
        .toThrow(REJECTED);
    });

    it('rejects Azure metadata by hostname', () => {
      expect(() => validateOutboundUrl('http://metadata.azure.com/'))
        .toThrow(REJECTED);
    });
  });

  describe('rejects loopback and private ranges regardless of port', () => {
    it('rejects loopback by IPv4', () => {
      expect(() => validateOutboundUrl('http://127.0.0.1:8080/')).toThrow(REJECTED);
    });

    it('rejects loopback by hostname with port', () => {
      expect(() => validateOutboundUrl('http://localhost:5432/')).toThrow(REJECTED);
    });

    it('rejects IPv6 loopback in bracket notation', () => {
      expect(() => validateOutboundUrl('http://[::1]:8080/')).toThrow(REJECTED);
    });

    it('rejects RFC1918 10/8 with port', () => {
      expect(() => validateOutboundUrl('http://10.0.0.5:5432/')).toThrow(REJECTED);
    });

    it('rejects RFC1918 172.16/12 with port', () => {
      expect(() => validateOutboundUrl('http://172.16.5.4:3306/')).toThrow(REJECTED);
    });

    it('rejects RFC1918 192.168/16', () => {
      expect(() => validateOutboundUrl('http://192.168.1.10/admin')).toThrow(REJECTED);
    });

    it('rejects IPv6 unique-local (fc00::/7)', () => {
      expect(() => validateOutboundUrl('http://[fd00::1]/')).toThrow(REJECTED);
    });

    it('rejects IPv6 link-local (fe80::/10)', () => {
      expect(() => validateOutboundUrl('http://[fe80::1]/')).toThrow(REJECTED);
    });
  });

  describe('rejects alternate IP encodings (inet_aton)', () => {
    it('rejects loopback as a bare decimal integer', () => {
      // 2130706433 === 127.0.0.1. glibc's resolver accepts this form.
      expect(() => validateOutboundUrl('http://2130706433/')).toThrow(REJECTED);
    });

    it('rejects loopback in octal notation', () => {
      expect(() => validateOutboundUrl('http://0177.0.0.1/')).toThrow(REJECTED);
    });

    it('rejects loopback in hex notation', () => {
      expect(() => validateOutboundUrl('http://0x7f.0.0.1/')).toThrow(REJECTED);
    });

    it('rejects the short-form decimal 2-part encoding', () => {
      // 127.1 === 127.0.0.1
      expect(() => validateOutboundUrl('http://127.1/')).toThrow(REJECTED);
    });
  });

  describe('rejects non-HTTP protocols', () => {
    it('rejects file:// scheme', () => {
      expect(() => validateOutboundUrl('file:///etc/passwd')).toThrow(REJECTED);
    });

    it('rejects gopher:// scheme', () => {
      expect(() => validateOutboundUrl('gopher://127.0.0.1:11211/')).toThrow(REJECTED);
    });

    it('rejects a malformed URL', () => {
      expect(() => validateOutboundUrl('not-a-url')).toThrow(REJECTED);
    });
  });

  describe('allows legitimate public targets', () => {
    it('allows public hostnames over https', () => {
      expect(() => validateOutboundUrl('https://events.pagerduty.com/v2/enqueue')).not.toThrow();
    });

    it('allows public hostnames with an explicit port', () => {
      expect(() => validateOutboundUrl('https://hooks.example.com:8443/path')).not.toThrow();
    });

    it('allows public IPs', () => {
      expect(() => validateOutboundUrl('https://8.8.8.8/')).not.toThrow();
    });
  });

  describe('allowlist enforcement', () => {
    it('rejects a host outside the allowlist', () => {
      expect(() => validateOutboundUrl('https://evil.example.com/', { allowedPrefixes: ['https://hooks.slack.com/'] }))
        .toThrow(REJECTED);
    });

    it('accepts a host inside the allowlist', () => {
      expect(() => validateOutboundUrl('https://hooks.slack.com/services/T00/B00/xxx', { allowedPrefixes: ['https://hooks.slack.com/'] }))
        .not.toThrow();
    });

    it('rejects an allowlisted host that resolves to a private IP', () => {
      // Allowlist must not become a bypass for the range checks.
      expect(() => validateOutboundUrl('http://169.254.169.254/', { allowedPrefixes: ['http://169.254.169.254/'] }))
        .toThrow(REJECTED);
    });
  });
});
