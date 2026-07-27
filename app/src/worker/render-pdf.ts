import puppeteer, { type Browser, type Page } from 'puppeteer';
import { logger } from '@/lib/logger';

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
  const browser: Browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    const page: Page = await browser.newPage();
    const dims = VIEWPORT_DIMENSIONS[job.options.pageSize];
    await page.setViewport({ width: dims.width, height: dims.height });

    await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForSelector('[data-dashboard-ready="true"]', { timeout: 15_000 });

    if (job.branding.logoUrl) {
      await page.evaluate((logoUrl: string) => {
        const header = document.createElement('div');
        header.dataset.dashboardBranding = 'logo';
        header.innerHTML = `<img src="${logoUrl}" style="height: 40px; margin: 16px;" />`;
        document.body.prepend(header);
      }, job.branding.logoUrl);
    }

    const pdf = await page.pdf({
      format: job.options.pageSize,
      printBackground: true,
      margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' },
    });

    logger.info(
      { url: job.url, pageSize: job.options.pageSize, bytes: pdf.length },
      'pdf-worker: render complete'
    );

    return { buffer: Buffer.from(pdf) };
  } finally {
    await browser.close();
  }
}