export type ExportPdfProgress = 'queued' | 'active' | 'generating' | 'downloading';

export type ExportPdfOptions = {
  pageSize?: 'Letter' | 'A4';
  filename?: string;
  onProgress?: (status: ExportPdfProgress) => void;
  maxPollAttempts?: number;
  pollIntervalMs?: number;
};

export type ExportPdfResult = {
  success: boolean;
  filename: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeFilename(name: string): string {
  const clean = name.replace(/[/\\?%*:|"<>]/g, '-').trim();
  return clean.length > 0 ? clean : 'dashboard';
}

/**
 * Client-side PDF export workflow:
 * 1. POST /api/dashboards/:id/export/pdf to enqueue the job.
 * 2. Poll GET /api/dashboards/:id/export/pdf?jobId=:jobId until completed.
 * 3. Receive binary PDF blob, trigger browser download, and cleanup memory.
 */
export async function exportDashboardPdf(
  dashboardId: string,
  options: ExportPdfOptions = {}
): Promise<ExportPdfResult> {
  const pageSize = options.pageSize ?? 'Letter';
  const pollIntervalMs = options.pollIntervalMs ?? 1500;
  const maxPollAttempts = options.maxPollAttempts ?? 30;

  options.onProgress?.('queued');

  const enqueueRes = await fetch(`/api/dashboards/${dashboardId}/export/pdf`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pageSize }),
  });

  if (!enqueueRes.ok) {
    const errBody = await enqueueRes.json().catch(() => ({}));
    const message =
      errBody.message ||
      errBody.error ||
      `Error al iniciar exportación (${enqueueRes.status})`;
    throw new Error(message);
  }

  const { jobId } = await enqueueRes.json();
  if (!jobId) {
    throw new Error('No se recibió identificador de tarea de exportación.');
  }

  for (let attempt = 1; attempt <= maxPollAttempts; attempt++) {
    await sleep(pollIntervalMs);

    const statusRes = await fetch(
      `/api/dashboards/${dashboardId}/export/pdf?jobId=${encodeURIComponent(jobId)}`
    );

    if (!statusRes.ok) {
      const errBody = await statusRes.json().catch(() => ({}));
      throw new Error(
        errBody.message ||
          errBody.error ||
          `Error al consultar estado de exportación (${statusRes.status})`
      );
    }

    const contentType = statusRes.headers.get('content-type') ?? '';

    // If completed, the route returns the binary PDF
    if (contentType.includes('application/pdf')) {
      options.onProgress?.('downloading');
      const blob = await statusRes.blob();
      const filename = `${sanitizeFilename(options.filename || `dashboard-${dashboardId}`)}.pdf`;

      const downloadUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = downloadUrl;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(downloadUrl);

      return { success: true, filename };
    }

    // Otherwise, parse the status JSON
    const statusData = await statusRes.json().catch(() => ({}));
    if (statusData.status === 'failed') {
      throw new Error(
        statusData.reason || 'Falló la generación del reporte PDF en el servidor.'
      );
    }

    if (statusData.status === 'active') {
      options.onProgress?.('generating');
    } else {
      options.onProgress?.('queued');
    }
  }

  throw new Error('Tiempo de espera agotado al generar el PDF. Intente nuevamente.');
}
