'use client';

import { useState } from 'react';
import html2canvas from 'html2canvas';
import { Button } from '@/components/ui/button';
import { Download } from 'lucide-react';

type Props = {
  dashboardTitle: string;
  targetRef: React.RefObject<HTMLDivElement | null>;
};

/**
 * ExportPNGButton — captura el DOM objetivo como PNG via html2canvas
 * y dispara la descarga con un nombre derivado del título del dashboard.
 *
 * Spec `export.md §4`. Limitaciones documentadas:
 * - Solo captura el viewport visible (no scroll completo)
 * - Charts interactivos (tooltips) no se capturan
 */
export function ExportPNGButton({ dashboardTitle, targetRef }: Props) {
  const [busy, setBusy] = useState(false);

  const handleExport = async () => {
    if (!targetRef.current || busy) return;
    setBusy(true);
    try {
      const canvas = await html2canvas(targetRef.current, {
        backgroundColor: null,
        scale: 2,
        logging: false,
      });
      await new Promise<void>((resolve) => {
        canvas.toBlob((blob) => {
          if (!blob) {
            resolve();
            return;
          }
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${sanitizeFilename(dashboardTitle)}.png`;
          a.click();
          URL.revokeObjectURL(url);
          resolve();
        }, 'image/png', 0.95);
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button variant="outline" size="sm" onClick={handleExport} disabled={busy}>
      <Download className="mr-2 h-4 w-4" />
      {busy ? 'Exportando…' : 'Exportar PNG'}
    </Button>
  );
}

function sanitizeFilename(title: string): string {
  return title.replace(/[^a-zA-Z0-9-_]+/g, '-').replace(/^-+|-+$/g, '') || 'dashboard';
}