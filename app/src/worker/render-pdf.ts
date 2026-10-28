import puppeteer, { type Browser, type Page } from 'puppeteer';
import { logger } from '@/lib/logger';
import { validateTenantAssetUrl } from '@/lib/security/validate-connection';

export type PdfJobPayload = {
  url: string;
  options: { pageSize: 'A4' | 'Letter' };
  branding: { logoUrl?: string; primaryColor?: string };
};

export type PdfRenderResult = { buffer: Buffer };

const VIEWPORT_DIMENSIONS: Record<'A4' | 'Letter', { width: number; height: number }> = {
  A4: { width: 794, height: 1056 },
  Letter: { width: 816, height: 1056 },
};

/**
 * The env the BROWSER process is allowed to see.
 *
 * Puppeteer hands `process.env` to the browser process by default, and the
 * browser process is the one that renders tenant-controlled content. If it
 * can read the worker's environment, a renderer compromise reads the DB
 * owner credentials (`DATABASE_MIGRATION_URL`), the master key that
 * decrypts every BYOK (`LLM_KEY_ENCRYPTION_KEY`), the Redis password and
 * the email provider key.
 *
 * So the browser gets an ALLOWLIST: what Chromium needs to run, and
 * nothing else.
 */
const CHROME_ENV_ALLOWLIST = [
  'PATH',
  'HOME',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TZ',
  'TMPDIR',
  'DISPLAY',
  'XAUTHORITY',
  'XDG_CONFIG_HOME',
  'XDG_CACHE_HOME',
  'NODE_ENV',
  'PUPPETEER_EXECUTABLE_PATH',
  'CHROME_DEVEL_SANDBOX',
] as const;

/** Flags that are safe regardless of the sandbox decision. */
const BASE_CHROME_ARGS = ['--disable-dev-shm-usage', '--disable-gpu'];

/**
 * Only used when the sandbox is unavailable (see `launchBrowser`). Chrome's
 * own sandbox is the difference between "a renderer bug" and "a renderer
 * bug that owns the container".
 */
const NO_SANDBOX_ARGS = ['--no-sandbox', '--disable-setuid-sandbox'];

function buildChromeEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of CHROME_ENV_ALLOWLIST) {
    const value = process.env[key];
    if (typeof value === 'string') env[key] = value;
  }
  return env;
}

/**
 * Chrome refuses to start without a usable sandbox in some environments
 * (a container without the setuid helper or without user namespaces).
 *
 * The fallback keeps the export working, but it is a real downgrade: the
 * renderer then runs with the privileges of the browser process. It is
 * logged as a WARNING, loudly, on every render.
 */
function isSandboxUnavailable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /sandbox/i.test(message);
}

async function launchBrowser(): Promise<Browser> {
  const env = buildChromeEnv();

  try {
    return await puppeteer.launch({ headless: true, args: [...BASE_CHROME_ARGS], env });
  } catch (error) {
    if (!isSandboxUnavailable(error)) throw error;

    logger.warn(
      { sandbox: false, err: error instanceof Error ? error.message : String(error) },
      'pdf-worker: Chrome sandbox unavailable, falling back to --no-sandbox',
    );
    return await puppeteer.launch({
      headless: true,
      args: [...BASE_CHROME_ARGS, ...NO_SANDBOX_ARGS],
      env,
    });
  }
}

/**
 * The origins the renderer is allowed to navigate to.
 *
 * The worker navigates to the print route of the app itself, with a
 * one-time token. If the job payload could name any host, the renderer
 * would be an open proxy that screenshots whatever it reaches from inside
 * the container network (the databases and the cache are right there).
 *
 * `NEXT_PUBLIC_APP_URL` is the public origin the app builds the print URL
 * with; `INTERNAL_APP_URL` is the same app as seen from the container
 * network.
 */
function allowedOrigins(): string[] {
  const configured = [process.env.NEXT_PUBLIC_APP_URL, process.env.INTERNAL_APP_URL];
  const origins = new Set<string>();
  for (const value of configured) {
    if (!value || !value.trim()) continue;
    try {
      origins.add(new URL(value).origin);
    } catch {
      logger.warn({ value }, 'pdf-worker: ignoring an unparseable app URL');
    }
  }
  return [...origins];
}

function assertRenderableUrl(url: string): void {
  const allowed = allowedOrigins();
  if (allowed.length === 0) {
    throw new Error('pdf-worker: no app origin is configured; refusing to render');
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('pdf-worker: the job URL is not a valid URL');
  }

  if (!allowed.includes(parsed.origin)) {
    throw new Error('pdf-worker: refusing to render a URL outside the app origin');
  }
}

/**
 * The URL without its query string.
 *
 * The print route carries a one-time token in the query: that token is a
 * bearer credential for the dashboard, so it must not reach the logs.
 */
function urlWithoutQuery(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return '[unparseable url]';
  }
}

/**
 * The tenant's logo, if it is an asset this renderer may fetch.
 *
 * `branding.logoUrl` is free text the tenant wrote, and it becomes an
 * `<img src>` in the page Chrome loads — from inside the container network,
 * where the databases and the cache are reachable by name. A logo that
 * does not pass `validateTenantAssetUrl` is dropped: the PDF renders
 * without branding (branding is not critical for an export) instead of
 * fetching an arbitrary host.
 */
function safeLogoUrl(logoUrl: string | undefined): string | null {
  if (!logoUrl) return null;
  try {
    validateTenantAssetUrl(logoUrl);
    return logoUrl;
  } catch (error) {
    logger.warn(
      { reason: error instanceof Error ? error.message : String(error) },
      'pdf-worker: dropping an org logo whose URL is not a public asset',
    );
    return null;
  }
}

/**
 * Whether a request made by the rendered page may leave the renderer.
 *
 * The page is not only the app's own markup: a widget that shows a
 * product image takes the URL from the CUSTOMER's own data, and the
 * dashboard can reference any host. Without an interceptor, Chrome fetches
 * those from inside the container network, where the databases and the
 * cache are reachable by name.
 *
 * Allowed: the app's own origins (the document itself and its assets) and
 * public hosts. Everything else that is not a public asset is refused.
 */
function isBlockedRequest(url: string, allowed: string[]): boolean {
  // `data:`, `blob:` and `about:` never leave the renderer.
  if (/^(data|blob|about):/i.test(url)) return false;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return true;
  }

  if (allowed.includes(parsed.origin)) return false;

  try {
    validateTenantAssetUrl(url);
    return false;
  } catch {
    return true;
  }
}

/**
 * Render a PDF from a dashboard URL using Puppeteer.
 *
 * The URL is expected to be the print route with a one-time token. The
 * page must render with `data-dashboard-ready="true"` set on `<main>` so
 * we know widgets have finished hydrating before we capture.
 *
 * Branding: when `branding.logoUrl` is set, a header with the logo is
 * injected into the page before the PDF capture.
 */
export async function renderPdf(job: PdfJobPayload): Promise<PdfRenderResult> {
  assertRenderableUrl(job.url);
  const logoUrl = safeLogoUrl(job.branding.logoUrl);

  const browser: Browser = await launchBrowser();

  try {
    const page: Page = await browser.newPage();
    const dims = VIEWPORT_DIMENSIONS[job.options.pageSize];
    await page.setViewport({ width: dims.width, height: dims.height });

    // Every request the page makes goes through the interceptor: the
    // dashboard can reference hosts the tenant controls (an image URL in
    // their own data), and the renderer must not reach the internal
    // network on their behalf.
    const origins = allowedOrigins();
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const target = request.url();
      if (isBlockedRequest(target, origins)) {
        logger.warn(
          { url: target },
          'pdf-worker: blocked a request to a host that is not a public asset',
        );
        void request.abort();
        return;
      }
      void request.continue();
    });

    await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForSelector('[data-dashboard-ready="true"]', { timeout: 15_000 });

    if (logoUrl) {
      await page.evaluate((logoUrl: string) => {
        const header = document.createElement('div');
        header.dataset.dashboardBranding = 'logo';
        header.style.height = '40px';
        header.style.margin = '16px';
        // `logoUrl` is tenant-supplied branding. Interpolating it into an
        // HTML string turns a quote in the value into markup injection
        // inside the page Puppeteer is about to screenshot and print, so
        // the attribute is set through the DOM instead.
        const logo = document.createElement('img');
        logo.src = logoUrl;
        logo.alt = 'Logo';
        logo.style.height = '40px';
        header.appendChild(logo);
        document.body.prepend(header);
      }, logoUrl);
    }

    const pdf = await page.pdf({
      format: job.options.pageSize,
      printBackground: true,
      margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' },
    });

    logger.info(
      { url: urlWithoutQuery(job.url), pageSize: job.options.pageSize, bytes: pdf.length },
      'pdf-worker: render complete'
    );

    return { buffer: Buffer.from(pdf) };
  } finally {
    await browser.close();
  }
}
