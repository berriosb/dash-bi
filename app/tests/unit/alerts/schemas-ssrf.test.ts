import { describe, it, expect } from 'vitest';
import { WebhookChannelSchema } from '@/lib/alerts/schemas';

/**
 * T3/T6 — the alert-rule API must reject SSRF targets at creation time.
 *
 * Validating only at send time would still persist a hostile URL in the
 * database; validating only at creation time would trust a row that was
 * written before the rule existed. Both layers are required.
 */
describe('WebhookChannelSchema — SSRF prevention at creation time (T3/T6)', () => {
  const validHeaders = { 'X-Api-Key': 'secret' };

  it('accepts a public https webhook', () => {
    const parsed = WebhookChannelSchema.safeParse({
      type: 'webhook',
      url: 'https://events.pagerduty.com/v2/enqueue',
      headers: validHeaders,
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects the AWS metadata endpoint', () => {
    const parsed = WebhookChannelSchema.safeParse({
      type: 'webhook',
      url: 'http://169.254.169.254/latest/meta-data/',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects loopback with a port suffix', () => {
    const parsed = WebhookChannelSchema.safeParse({
      type: 'webhook',
      url: 'http://127.0.0.1:8080/',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects the GCP metadata hostname', () => {
    const parsed = WebhookChannelSchema.safeParse({
      type: 'webhook',
      url: 'http://metadata.google.internal/computeMetadata/v1/',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects loopback encoded as a decimal integer', () => {
    const parsed = WebhookChannelSchema.safeParse({
      type: 'webhook',
      url: 'http://2130706433/',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects a non-http scheme', () => {
    const parsed = WebhookChannelSchema.safeParse({
      type: 'webhook',
      url: 'file:///etc/passwd',
    });
    expect(parsed.success).toBe(false);
  });
});
