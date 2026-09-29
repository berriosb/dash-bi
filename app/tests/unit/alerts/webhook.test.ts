import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { sendWebhookAlert } from '@/lib/alerts/channels/webhook';

const originalFetch = global.fetch;

describe('Alerts Webhook Channel', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });
  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  const baseParams = {
    url: 'https://events.pagerduty.com/v2/enqueue',
    headers: { Authorization: 'Bearer test-token' },
    payload: {
      alertName: 'Orders stopped',
      dashboardTitle: 'Orders Pipeline',
      breachedValue: 0,
      threshold: 1,
      correlationId: 'alert_test_456',
      firedAt: '2026-08-31T15:00:00.000Z',
    },
  };

  it('POSTs payload with custom headers merged', async () => {
    const mockFetch = vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 202,
      text: async () => 'accepted',
    } as Response);

    const result = await sendWebhookAlert(baseParams);
    expect(result.status).toBe('success');
    expect(result.channelType).toBe('webhook');

    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toBe(baseParams.url);
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>)['content-type']).toBe('application/json');
    expect((init?.headers as Record<string, string>)['Authorization']).toBe('Bearer test-token');

    const body = JSON.parse(init?.body as string);
    expect(body.alertName).toBe('Orders stopped');
    expect(body.correlationId).toBe('alert_test_456');
  });

  it('works without custom headers', async () => {
    const mockFetch = vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => 'ok',
    } as Response);

    await sendWebhookAlert({ ...baseParams, headers: undefined });
    const init = mockFetch.mock.calls[0]![1]!;
    expect((init?.headers as Record<string, string>)['content-type']).toBe('application/json');
    expect((init?.headers as Record<string, string>)['Authorization']).toBeUndefined();
  });

  it('returns failed on 5xx response', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => 'service unavailable',
    } as Response);

    const result = await sendWebhookAlert(baseParams);
    expect(result.status).toBe('failed');
    expect(result.error).toContain('503');
  });

  it('returns failed on fetch exception', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await sendWebhookAlert(baseParams);
    expect(result.status).toBe('failed');
    expect(result.error).toBe('ECONNREFUSED');
  });

  // T3/T6 — SSRF. The webhook target is user-supplied and the server
  // performs the request, so an unvalidated URL turns this into a
  // server-side request forgery primitive.
  describe('SSRF protection', () => {
    it('does not send to the AWS metadata endpoint', async () => {
      const result = await sendWebhookAlert({
        ...baseParams,
        url: 'http://169.254.169.254/latest/meta-data/iam/security-credentials/',
      });

      expect(result.status).toBe('failed');
      expect(result.error).toMatch(/not allowed|blocked|SSRF/i);
      expect(fetch).not.toHaveBeenCalled();
    });

    it('does not send to loopback', async () => {
      const result = await sendWebhookAlert({ ...baseParams, url: 'http://127.0.0.1:5432/' });

      expect(result.status).toBe('failed');
      expect(fetch).not.toHaveBeenCalled();
    });

    it('does not send to an internal hostname', async () => {
      const result = await sendWebhookAlert({ ...baseParams, url: 'http://localhost:8080/admin' });

      expect(result.status).toBe('failed');
      expect(fetch).not.toHaveBeenCalled();
    });

    it('does not send to a non-HTTP scheme', async () => {
      const result = await sendWebhookAlert({ ...baseParams, url: 'file:///etc/passwd' });

      expect(result.status).toBe('failed');
      expect(fetch).not.toHaveBeenCalled();
    });

    it('does not follow redirects into the private range', async () => {
      // A public URL that 302s to 169.254.169.254 is the same attack with
      // an extra hop, so the transport must not chase it.
      const mockFetch = vi.mocked(fetch).mockResolvedValue({
        ok: true,
        status: 200,
        redirect: 'manual',
        text: async () => 'ok',
      } as unknown as Response);

      await sendWebhookAlert(baseParams);
      const init = mockFetch.mock.calls[0]![1]!;
      expect(init?.redirect).toBe('manual');
    });
  });
});
