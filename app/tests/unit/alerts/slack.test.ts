import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { sendSlackAlert } from '@/lib/alerts/channels/slack';

const originalFetch = global.fetch;

describe('Alerts Slack Channel', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });
  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  const baseParams = {
    webhookUrl: 'https://hooks.slack.com/services/T00/B00/xxx',
    channelLabel: '#revenue-alerts',
    ruleName: 'Revenue bajo $50k',
    dashboardTitle: 'Revenue Dashboard',
    breachedValue: 48200,
    threshold: 50000,
    correlationId: 'alert_test_123',
  };

  it('POSTs a Block Kit payload to the webhook URL', async () => {
    const mockFetch = vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => 'ok',
    } as Response);

    const result = await sendSlackAlert(baseParams);

    expect(result.status).toBe('success');
    expect(result.channelType).toBe('slack');
    expect(mockFetch).toHaveBeenCalledOnce();

    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toBe(baseParams.webhookUrl);
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>)['content-type']).toBe('application/json');

    const body = JSON.parse(init?.body as string);
    expect(body.text).toContain('Revenue bajo');
    expect(body.blocks).toHaveLength(3);
    expect(body.blocks[0].text.text).toContain('*Revenue bajo $50k*');
    // fields block has dashboard / value / threshold / channel
    const fields = body.blocks[1].fields;
    expect(fields).toHaveLength(4);
    expect(fields[0].text).toContain('Revenue Dashboard');
    expect(fields[1].text).toContain('48200');
    expect(fields[2].text).toContain('50000');
    expect(fields[3].text).toContain('#revenue-alerts');
    // context block has correlationId
    expect(body.blocks[2].elements[0].text).toContain('alert_test_123');
  });

  it('returns failed with status when Slack returns 4xx', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 410,
      text: async () => 'gone',
    } as Response);

    const result = await sendSlackAlert(baseParams);
    expect(result.status).toBe('failed');
    expect(result.error).toContain('410');
    expect(result.error).toContain('gone');
  });

  it('returns failed when fetch throws', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('network unreachable'));

    const result = await sendSlackAlert(baseParams);
    expect(result.status).toBe('failed');
    expect(result.error).toBe('network unreachable');
  });

  it('includes string breached value correctly', async () => {
    const mockFetch = vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => 'ok',
    } as Response);

    await sendSlackAlert({ ...baseParams, breachedValue: 'abc' });
    const body = JSON.parse(mockFetch.mock.calls[0]![1]!.body as string);
    const fields = body.blocks[1].fields;
    expect(fields[1].text).toContain('abc');
  });
});
