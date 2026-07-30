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
} = vi.hoisted(() => ({
  mockLaunch: vi.fn(),
  mockNewPage: vi.fn(),
  mockSetViewport: vi.fn(),
  mockGoto: vi.fn(),
  mockWaitForSelector: vi.fn(),
  mockEvaluate: vi.fn(),
  mockPdf: vi.fn(),
  mockClose: vi.fn(),
}));

const mockPage = {
  setViewport: mockSetViewport,
  goto: mockGoto,
  waitForSelector: mockWaitForSelector,
  evaluate: mockEvaluate,
  pdf: mockPdf,
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
  });

  it('launches puppeteer with headless: true and no-sandbox args', async () => {
    await renderPdf(baseJob);

    expect(mockLaunch).toHaveBeenCalledTimes(1);
    expect(mockLaunch).toHaveBeenCalledWith(
      expect.objectContaining({
        headless: true,
        args: expect.arrayContaining(['--no-sandbox', '--disable-setuid-sandbox']),
      })
    );
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