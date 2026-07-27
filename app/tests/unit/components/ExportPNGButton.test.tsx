// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const { mockHtml2Canvas, mockCreateObjectURL, mockRevokeObjectURL } = vi.hoisted(() => ({
  mockHtml2Canvas: vi.fn(),
  mockCreateObjectURL: vi.fn(() => 'blob:fake-url'),
  mockRevokeObjectURL: vi.fn(),
}));

const mockToBlob = vi.fn();
const mockCanvas = {
  toBlob: mockToBlob,
};

vi.mock('html2canvas', () => ({
  default: mockHtml2Canvas,
}));

if (typeof globalThis.URL.createObjectURL !== 'function') {
  Object.defineProperty(globalThis.URL, 'createObjectURL', {
    value: mockCreateObjectURL,
    writable: true,
  });
} else {
  vi.spyOn(URL, 'createObjectURL').mockImplementation(mockCreateObjectURL);
}
vi.spyOn(URL, 'revokeObjectURL').mockImplementation(mockRevokeObjectURL);

import { ExportPNGButton } from '@/components/dashboard/ExportPNGButton';

describe('ExportPNGButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHtml2Canvas.mockResolvedValue(mockCanvas);
    mockToBlob.mockImplementation((cb: (blob: Blob | null) => void) => {
      cb(new Blob(['png-bytes'], { type: 'image/png' }));
    });
  });

  it('renders a button with export label', () => {
    const targetRef = { current: document.createElement('div') };
    render(<ExportPNGButton dashboardTitle="Sales Q3" targetRef={targetRef} />);
    const button = screen.getByRole('button', { name: /exportar png/i });
    expect(button).toBeDefined();
    expect(button.tagName).toBe('BUTTON');
  });

  it('captures the dashboard DOM via html2canvas on click', async () => {
    const targetRef = { current: document.createElement('div') };
    render(<ExportPNGButton dashboardTitle="Sales Q3" targetRef={targetRef} />);

    fireEvent.click(screen.getByRole('button', { name: /exportar png/i }));

    expect(mockHtml2Canvas).toHaveBeenCalledTimes(1);
    const firstCallTarget = mockHtml2Canvas.mock.calls[0]?.[0];
    expect(firstCallTarget).toBe(targetRef.current);
  });

  it('configures html2canvas with 2x scale and transparent background', async () => {
    const targetRef = { current: document.createElement('div') };
    render(<ExportPNGButton dashboardTitle="Sales Q3" targetRef={targetRef} />);

    fireEvent.click(screen.getByRole('button', { name: /exportar png/i }));

    await vi.waitFor(() => expect(mockHtml2Canvas).toHaveBeenCalled());
    const opts = mockHtml2Canvas.mock.calls[0]?.[1];
    expect(opts).toMatchObject({
      scale: 2,
      backgroundColor: null,
      logging: false,
    });
  });

  it('does nothing when targetRef.current is null', () => {
    const targetRef = { current: null };
    render(<ExportPNGButton dashboardTitle="Sales Q3" targetRef={targetRef} />);

    fireEvent.click(screen.getByRole('button', { name: /exportar png/i }));

    expect(mockHtml2Canvas).not.toHaveBeenCalled();
  });

  it('triggers download with PNG filename based on dashboard title', async () => {
    const clickSpy = vi.fn();
    const origCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = origCreateElement(tag);
      if (tag === 'a') {
        (el as HTMLAnchorElement).click = clickSpy;
      }
      return el;
    });

    const targetRef = { current: document.createElement('div') };
    render(<ExportPNGButton dashboardTitle="Sales Q3 2026!" targetRef={targetRef} />);
    fireEvent.click(screen.getByRole('button', { name: /exportar png/i }));

    await vi.waitFor(() => expect(clickSpy).toHaveBeenCalled());
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });
});