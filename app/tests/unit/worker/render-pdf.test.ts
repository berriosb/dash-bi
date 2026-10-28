import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockLaunch,
  mockNewPage,
  mockSetViewport,
  mockGoto,
  mockWaitForSelector,
  mockEvaluate,
  mockPdf,
  mockClose,
  mockSetRequestInterception,
  mockPageOn,
} = vi.hoisted(() => ({
  mockLaunch: vi.fn(),
  mockNewPage: vi.fn(),
  mockSetViewport: vi.fn(),
  mockGoto: vi.fn(),
  mockWaitForSelector: vi.fn(),
  mockEvaluate: vi.fn(),
  mockPdf: vi.fn(),
  mockClose: vi.fn(),
  mockSetRequestInterception: vi.fn(),
  mockPageOn: vi.fn(),
}));

const mockPage = {
  setViewport: mockSetViewport,
  goto: mockGoto,
  waitForSelector: mockWaitForSelector,
  evaluate: mockEvaluate,
  pdf: mockPdf,
  setRequestInterception: mockSetRequestInterception,
  on: mockPageOn,
};

const mockBrowser = {
  newPage: mockNewPage,
  close: mockClose,
};

vi.mock('puppeteer', () => ({
  default: {
    launch: mockLaunch,
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { renderPdf } from '@/worker/render-pdf';
import { logger } from '@/lib/logger';

const baseJob = {
  url: 'http://localhost:3000/dashboard/dash-1/print?token=abc',
  options: { pageSize: 'Letter' as const },
  branding: {},
};

const fakePdfBuffer = Buffer.from('PDF-BYTES');

describe('renderPdf', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockLaunch.mockResolvedValue(mockBrowser);
    mockNewPage.mockResolvedValue(mockPage);
    mockSetViewport.mockResolvedValue(undefined);
    mockGoto.mockResolvedValue(undefined);
    mockWaitForSelector.mockResolvedValue(undefined);
    mockEvaluate.mockResolvedValue(undefined);
    mockPdf.mockResolvedValue(fakePdfBuffer);
    mockClose.mockResolvedValue(undefined);
    // El worker valida que la URL que navega sea el origen de la app.
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
  });

  /**
   * The renderer is the process that ends up running tenant-controlled
   * content (a dashboard page with the tenant's branding). It must not
   * carry the worker's secrets: `DATABASE_MIGRATION_URL` is the DB OWNER,
   * `LLM_KEY_ENCRYPTION_KEY` decrypts every BYOK, `REDIS_URL` and
   * `RESEND_API_KEY` are credentials too. Puppeteer hands `process.env` to
   * the browser process by default.
   */
  it('launches Chrome with a minimal env, without the worker secrets', async () => {
    process.env.DATABASE_URL = 'postgres://app:secret@postgres:5432/dashbi';
    process.env.DATABASE_MIGRATION_URL = 'postgres://owner:secret@postgres:5432/dashbi';
    process.env.LLM_KEY_ENCRYPTION_KEY = 'a'.repeat(64);
    process.env.REDIS_URL = 'redis://:redissecret@redis:6379';
    process.env.RESEND_API_KEY = 're_secret';

    await renderPdf(baseJob);

    const options = mockLaunch.mock.calls[0]![0] as { env?: Record<string, string> };
    const env = options.env ?? {};
    expect(env).not.toHaveProperty('DATABASE_URL');
    expect(env).not.toHaveProperty('DATABASE_MIGRATION_URL');
    expect(env).not.toHaveProperty('DATABASE_READONLY_URL');
    expect(env).not.toHaveProperty('LLM_KEY_ENCRYPTION_KEY');
    expect(env).not.toHaveProperty('REDIS_URL');
    expect(env).not.toHaveProperty('RESEND_API_KEY');
    expect(env).not.toHaveProperty('PDF_WORKER_SECRET');
    // The browser still needs a PATH to find its own libraries.
    expect(env.PATH).toBe(process.env.PATH);
  });

  it('launches puppeteer headless WITHOUT disabling the sandbox', async () => {
    await renderPdf(baseJob);

    expect(mockLaunch).toHaveBeenCalledTimes(1);
    const options = mockLaunch.mock.calls[0]![0] as { headless: boolean; args: string[] };
    expect(options.headless).toBe(true);
    expect(options.args).not.toContain('--no-sandbox');
    expect(options.args).not.toContain('--disable-setuid-sandbox');
  });

  it('falls back to --no-sandbox when the sandbox is unavailable, and says so', async () => {
    mockLaunch.mockRejectedValueOnce(new Error('No usable sandbox!'));

    await renderPdf(baseJob);

    expect(mockLaunch).toHaveBeenCalledTimes(2);
    const fallback = mockLaunch.mock.calls[1]![0] as { args: string[] };
    expect(fallback.args).toContain('--no-sandbox');
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ sandbox: false }),
      expect.stringContaining('sandbox'),
    );
  });

  it('does not fall back for a failure that is not about the sandbox', async () => {
    mockLaunch.mockRejectedValue(new Error('chrome binary missing'));

    await expect(renderPdf(baseJob)).rejects.toThrow('chrome binary missing');
    expect(mockLaunch).toHaveBeenCalledTimes(1);
  });

  /**
   * The worker navigates to whatever URL the job carries. If the payload
   * could name an arbitrary host, the renderer becomes an open proxy that
   * screenshots whatever it can reach from inside the container network.
   */
  it('refuses to navigate to a URL outside the app origin', async () => {
    await expect(
      renderPdf({ ...baseJob, url: 'http://169.254.169.254/latest/meta-data/' }),
    ).rejects.toThrow();

    expect(mockGoto).not.toHaveBeenCalled();
  });

  it('navigates to the app origin', async () => {
    await renderPdf(baseJob);
    expect(mockGoto).toHaveBeenCalledTimes(1);
  });

  it('does not log the one-time print token', async () => {
    await renderPdf(baseJob);

    const logged = JSON.stringify((logger.info as ReturnType<typeof vi.fn>).mock.calls);
    expect(logged).not.toContain('token=abc');
  });

  /**
   * The rendered page can reference any host: a widget that shows a
   * product image takes the URL from the customer's own data. Without an
   * interceptor, the renderer fetches it from inside the container
   * network, where the databases and the cache are reachable by name.
   */
  describe('request interception', () => {
    function handlerFor(): (request: {
      url: () => string;
      abort: () => void;
      continue: () => void;
    }) => void {
      const call = mockPageOn.mock.calls.find((c) => c[0] === 'request');
      if (!call) throw new Error('no request handler registered');
      return call[1] as never;
    }

    function probe(url: string): { abort: ReturnType<typeof vi.fn>; cont: ReturnType<typeof vi.fn> } {
      const abort = vi.fn();
      const cont = vi.fn();
      handlerFor()({ url: () => url, abort, continue: cont });
      return { abort, cont };
    }

    it('intercepts the requests of the page', async () => {
      await renderPdf(baseJob);
      expect(mockSetRequestInterception).toHaveBeenCalledWith(true);
    });

    it('blocks requests to internal hosts', async () => {
      await renderPdf(baseJob);

      for (const url of [
        'http://redis:6379/x.png',
        'http://postgres:5432/x.png',
        'http://169.254.169.254/latest/meta-data/',
        'http://127.0.0.1:3000/x.png',
        'http://assets.internal/x.png',
      ]) {
        const { abort, cont } = probe(url);
        expect(abort, url).toHaveBeenCalled();
        expect(cont, url).not.toHaveBeenCalled();
      }
    });

    it('allows the app origin and public hosts', async () => {
      await renderPdf(baseJob);

      for (const url of [
        'http://localhost:3000/dashboard/dash-1/print',
        'https://cdn.example.com/logo.png',
        'data:image/png;base64,AAAA',
      ]) {
        const { abort, cont } = probe(url);
        expect(cont, url).toHaveBeenCalled();
        expect(abort, url).not.toHaveBeenCalled();
      }
    });
  });

  it('uses Letter viewport by default', async () => {
    await renderPdf(baseJob);
    expect(mockSetViewport).toHaveBeenCalledWith({ width: 816, height: 1056 });
  });

  it('uses A4 viewport when pageSize is A4', async () => {
    await renderPdf({ ...baseJob, options: { pageSize: 'A4' } });
    expect(mockSetViewport).toHaveBeenCalledWith({ width: 794, height: 1056 });
  });

  it('navigates to the provided URL with domcontentloaded wait', async () => {
    await renderPdf(baseJob);
    expect(mockGoto).toHaveBeenCalledWith(
      baseJob.url,
      expect.objectContaining({ waitUntil: 'domcontentloaded', timeout: 30_000 })
    );
  });

  it('waits for the dashboard-ready selector before capturing', async () => {
    await renderPdf(baseJob);
    expect(mockWaitForSelector).toHaveBeenCalledWith(
      '[data-dashboard-ready="true"]',
      expect.objectContaining({ timeout: 15_000 })
    );
  });

  it('injects org logo header when branding.logoUrl is present', async () => {
    await renderPdf({
      ...baseJob,
      branding: { logoUrl: 'https://cdn.example.com/logo.png' },
    });
    expect(mockEvaluate).toHaveBeenCalledTimes(1);
    const args = mockEvaluate.mock.calls[0]!;
    expect(args[0]).toBeInstanceOf(Function);
    expect(args[1]).toBe('https://cdn.example.com/logo.png');
  });

  it('does not inject branding when logoUrl is missing', async () => {
    await renderPdf({ ...baseJob, branding: {} });
    expect(mockEvaluate).not.toHaveBeenCalled();
  });

  /**
   * The logo URL is tenant-supplied text and it is injected as an
   * `<img src>` into the page Chrome loads: without validation the
   * renderer fetches whatever the tenant points it at, from inside the
   * container network.
   */
  it('does not inject a logo whose URL is not a public asset', async () => {
    await renderPdf({
      ...baseJob,
      branding: { logoUrl: 'http://redis:6379/logo.png' },
    });

    expect(mockEvaluate).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ reason: expect.any(String) }),
      expect.stringContaining('logo'),
    );
  });

  it('configures page.pdf() with printBackground and consistent margins', async () => {
    await renderPdf(baseJob);
    expect(mockPdf).toHaveBeenCalledTimes(1);
    expect(mockPdf).toHaveBeenCalledWith(
      expect.objectContaining({
        format: 'Letter',
        printBackground: true,
        margin: expect.objectContaining({ top: '20mm', bottom: '20mm' }),
      })
    );
  });

  it('returns { buffer } with the pdf bytes from puppeteer', async () => {
    const result = await renderPdf(baseJob);
    expect(result.buffer.equals(fakePdfBuffer)).toBe(true);
  });

  it('always closes the browser even when render throws', async () => {
    mockGoto.mockRejectedValueOnce(new Error('navigation failed'));
    await expect(renderPdf(baseJob)).rejects.toThrow('navigation failed');
    expect(mockClose).toHaveBeenCalledTimes(1);
  });
});