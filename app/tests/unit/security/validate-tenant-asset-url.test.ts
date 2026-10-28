import { describe, it, expect } from 'vitest';
import { validateTenantAssetUrl, OutboundUrlError } from '@/lib/security/validate-connection';

/**
 * The org logo is tenant-supplied text (`orgs.brandLogoUrl`) and it is
 * rendered by the PDF worker: the URL is injected as an `<img src>` into a
 * page that Chrome then loads. Without validation, a tenant points the
 * logo at `http://redis:6379` or at the cloud metadata service and the
 * worker fetches it from inside the container network.
 */
describe('validateTenantAssetUrl', () => {
  it('accepts a public https URL', () => {
    const parsed = validateTenantAssetUrl('https://cdn.example.com/logo.png');
    expect(parsed.hostname).toBe('cdn.example.com');
  });

  it('accepts a public URL with a query string', () => {
    const parsed = validateTenantAssetUrl('https://logos.midominio.com/logo.png?v=2');
    expect(parsed.pathname).toBe('/logo.png');
  });

  it('rejects a non-http scheme', () => {
    expect(() => validateTenantAssetUrl('file:///etc/passwd')).toThrow(OutboundUrlError);
  });

  it('rejects a malformed URL', () => {
    expect(() => validateTenantAssetUrl('not a url')).toThrow(OutboundUrlError);
  });

  it('rejects loopback in every notation', () => {
    for (const url of [
      'http://127.0.0.1/logo.png',
      'http://127.1/logo.png',
      'http://2130706433/logo.png',
      'http://0x7f.0.0.1/logo.png',
      'http://[::1]/logo.png',
      'http://localhost:3000/logo.png',
    ]) {
      expect(() => validateTenantAssetUrl(url), url).toThrow(OutboundUrlError);
    }
  });

  it('rejects link-local and cloud metadata addresses', () => {
    for (const url of [
      'http://169.254.169.254/latest/meta-data/',
      'http://metadata.google.internal/computeMetadata/v1/',
    ]) {
      expect(() => validateTenantAssetUrl(url), url).toThrow(OutboundUrlError);
    }
  });

  it('rejects the service names that run next to the app', () => {
    // These resolve inside the container network: the databases and the
    // cache are reachable by name even though no public address points
    // at them.
    for (const url of [
      'http://redis:6379/logo.png',
      'http://postgres:5432/logo.png',
      'http://db/logo.png',
      'http://mysql:3306/logo.png',
    ]) {
      expect(() => validateTenantAssetUrl(url), url).toThrow(OutboundUrlError);
    }
  });

  it('rejects the suffixes reserved for private networks', () => {
    for (const url of [
      'http://logo.internal/logo.png',
      'http://logo.local/logo.png',
      'http://logo.localhost/logo.png',
      'http://logo.localdomain/logo.png',
    ]) {
      expect(() => validateTenantAssetUrl(url), url).toThrow(OutboundUrlError);
    }
  });

  it('rejects a single-label hostname', () => {
    // A public asset always has a dot: `intranet` only resolves inside a
    // private network.
    expect(() => validateTenantAssetUrl('http://intranet/logo.png')).toThrow(
      OutboundUrlError,
    );
  });
});
