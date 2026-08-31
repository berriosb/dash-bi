'use client';

import * as React from 'react';
import html2canvas from 'html2canvas';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { exportDashboardPdf, type ExportPdfProgress } from '@/lib/export/client-export';
import {
  Download,
  Share2,
  FileText,
  Image as ImageIcon,
  Link2,
  Code,
  Copy,
  Check,
  Trash2,
  Loader2,
  Sparkles,
  X,
  ExternalLink,
} from 'lucide-react';

export type PublicLinkItem = {
  id: string;
  token: string;
  url: string;
  expiresAt: string | null;
  viewCount: number;
  lastViewedAt: string | null;
  createdAt: string;
};

interface ExportShareDialogProps {
  dashboardId: string;
  dashboardTitle: string;
  targetRef?: React.RefObject<HTMLDivElement | null>;
  defaultOpen?: boolean;
}

export function ExportShareDialog({
  dashboardId,
  dashboardTitle,
  targetRef,
  defaultOpen = false,
}: ExportShareDialogProps) {
  const [open, setOpen] = React.useState(defaultOpen);
  const [activeTab, setActiveTab] = React.useState<'pdf' | 'png' | 'share' | 'embed'>('pdf');
  const { toast } = useToast();

  // PDF Export State
  const [pageSize, setPageSize] = React.useState<'Letter' | 'A4'>('Letter');
  const [pdfProgress, setPdfProgress] = React.useState<ExportPdfProgress | null>(null);
  const [isPdfExporting, setIsPdfExporting] = React.useState(false);

  // PNG Export State
  const [isPngExporting, setIsPngExporting] = React.useState(false);

  // Public Links State
  const [expiresInDays, setExpiresInDays] = React.useState<number>(30);
  const [isCreatingLink, setIsCreatingLink] = React.useState(false);
  const [activeLinks, setActiveLinks] = React.useState<PublicLinkItem[]>([]);
  const [isLoadingLinks, setIsLoadingLinks] = React.useState(false);
  const [copiedId, setCopiedId] = React.useState<string | null>(null);

  // Embed State
  const [embedOrigin, setEmbedOrigin] = React.useState<string>('*');
  const [embedTheme, setEmbedTheme] = React.useState<'moderno-saas' | 'corporate' | 'transparent'>('moderno-saas');
  const [embedHideTitle, setEmbedHideTitle] = React.useState(false);
  const [isGeneratingEmbed, setIsGeneratingEmbed] = React.useState(false);
  const [generatedSnippet, setGeneratedSnippet] = React.useState<string | null>(null);
  const [copiedEmbed, setCopiedEmbed] = React.useState(false);

  const fetchLinks = React.useCallback(async () => {
    if (dashboardId === 'demo') return;
    setIsLoadingLinks(true);
    try {
      const res = await fetch(`/api/dashboards/${dashboardId}/share`);
      if (res.ok) {
        const data = await res.json();
        setActiveLinks(data.links ?? []);
      }
    } catch {
      // Non-critical background fetch
    } finally {
      setIsLoadingLinks(false);
    }
  }, [dashboardId]);

  React.useEffect(() => {
    if (open && activeTab === 'share') {
      void fetchLinks();
    }
  }, [open, activeTab, fetchLinks]);

  const handleExportPdf = async () => {
    setIsPdfExporting(true);
    setPdfProgress('queued');
    try {
      await exportDashboardPdf(dashboardId, {
        pageSize,
        filename: dashboardTitle,
        onProgress: (p) => setPdfProgress(p),
      });
      toast({
        title: 'PDF generado con éxito',
        description: 'La descarga del reporte ha comenzado.',
      });
      setOpen(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Error inesperado al exportar PDF';
      toast({
        variant: 'destructive',
        title: 'No se pudo exportar el PDF',
        description: message,
      });
    } finally {
      setIsPdfExporting(false);
      setPdfProgress(null);
    }
  };

  const handleExportPng = async () => {
    const el = targetRef?.current || document.querySelector('.dashboard-grid-container') || document.querySelector('main');
    if (!el) {
      toast({
        variant: 'destructive',
        title: 'No se pudo capturar',
        description: 'No se encontró el contenedor visual del dashboard.',
      });
      return;
    }

    setIsPngExporting(true);
    try {
      const canvas = await html2canvas(el as HTMLElement, {
        backgroundColor: null,
        scale: 2,
        logging: false,
      });

      canvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const cleanName = dashboardTitle.replace(/[^a-zA-Z0-9-_]+/g, '-').replace(/^-+|-+$/g, '') || 'dashboard';
        a.download = `${cleanName}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toast({
          title: 'PNG exportado',
          description: 'La imagen se descargó en alta resolución.',
        });
        setOpen(false);
      }, 'image/png', 0.95);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Error al generar imagen';
      toast({
        variant: 'destructive',
        title: 'Error al exportar PNG',
        description: message,
      });
    } finally {
      setIsPngExporting(false);
    }
  };

  const handleCreatePublicLink = async () => {
    setIsCreatingLink(true);
    try {
      const res = await fetch(`/api/dashboards/${dashboardId}/share`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ expiresInDays }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Error al generar enlace');
      }

      const newLink = await res.json();
      await navigator.clipboard.writeText(newLink.url);
      toast({
        title: 'Enlace público creado y copiado',
        description: 'Cualquier persona con este enlace puede ver el dashboard.',
      });
      void fetchLinks();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'No se pudo crear el enlace';
      toast({
        variant: 'destructive',
        title: 'Error al crear enlace público',
        description: message,
      });
    } finally {
      setIsCreatingLink(false);
    }
  };

  const handleRevokeLink = async (linkId: string) => {
    try {
      const res = await fetch(`/api/public-links/${linkId}`, { method: 'DELETE' });
      if (res.ok) {
        toast({ title: 'Enlace revocado', description: 'El enlace ya no es accesible.' });
        setActiveLinks((prev) => prev.filter((l) => l.id !== linkId));
      }
    } catch {
      toast({ variant: 'destructive', title: 'Error al revocar enlace' });
    }
  };

  const handleGenerateEmbed = async () => {
    setIsGeneratingEmbed(true);
    try {
      const allowedOrigins = embedOrigin
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      const res = await fetch(`/api/dashboards/${dashboardId}/embed`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          allowedOrigins: allowedOrigins.length > 0 ? allowedOrigins : ['*'],
          theme: embedTheme,
          hideTitle: embedHideTitle,
          expiresInDays,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Error al generar código de embebido');
      }

      const data = await res.json();
      setGeneratedSnippet(data.iframeSnippet);
      await navigator.clipboard.writeText(data.iframeSnippet);
      setCopiedEmbed(true);
      setTimeout(() => setCopiedEmbed(false), 2500);
      toast({
        title: 'Código iframe generado y copiado',
        description: 'Pega este código en tu aplicación para embeber el dashboard.',
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'No se pudo generar el código';
      toast({
        variant: 'destructive',
        title: 'Error al generar código iframe',
        description: message,
      });
    } finally {
      setIsGeneratingEmbed(false);
    }
  };

  const copyToClipboard = async (url: string, id: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
      toast({ title: 'Copiado al portapapeles', description: url });
    } catch {
      toast({ variant: 'destructive', title: 'No se pudo copiar' });
    }
  };

  const getPdfStatusText = () => {
    switch (pdfProgress) {
      case 'queued':
        return 'Encolando solicitud en el worker...';
      case 'active':
      case 'generating':
        return 'Generando reporte con Puppeteer...';
      case 'downloading':
        return 'Descargando archivo PDF...';
      default:
        return 'Procesando...';
    }
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="platform-editor-action text-xs gap-1.5"
      >
        <Share2 className="w-3.5 h-3.5 text-primary" />
        <span>Exportar & Compartir</span>
      </Button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="export-share-dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in-0"
        >
          <div className="w-full max-w-lg overflow-hidden rounded-xl border border-border bg-card shadow-2xl text-card-foreground">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-border/70 px-6 py-4">
              <div>
                <h2 id="export-share-dialog-title" className="text-base font-semibold text-foreground">
                  Exportar & Compartir
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Genera reportes presentables o comparte el dashboard con tu equipo y clientes.
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setOpen(false)}
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                aria-label="Cerrar ventana"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>

            {/* Modal Tabs */}
            <div className="flex border-b border-border/70 bg-muted/30 px-6" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'pdf'}
                onClick={() => setActiveTab('pdf')}
                className={`flex items-center gap-2 border-b-2 px-4 py-3 text-xs font-medium transition-colors ${
                  activeTab === 'pdf'
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                <FileText className="w-3.5 h-3.5" />
                <span>PDF Presentable</span>
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'png'}
                onClick={() => setActiveTab('png')}
                className={`flex items-center gap-2 border-b-2 px-4 py-3 text-xs font-medium transition-colors ${
                  activeTab === 'png'
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                <ImageIcon className="w-3.5 h-3.5" />
                <span>Imagen PNG</span>
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'share'}
                onClick={() => setActiveTab('share')}
                className={`flex items-center gap-2 border-b-2 px-4 py-3 text-xs font-medium transition-colors ${
                  activeTab === 'share'
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                <Link2 className="w-3.5 h-3.5" />
                <span>Enlace Público</span>
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'embed'}
                onClick={() => setActiveTab('embed')}
                className={`flex items-center gap-2 border-b-2 px-4 py-3 text-xs font-medium transition-colors ${
                  activeTab === 'embed'
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                <Code className="w-3.5 h-3.5" />
                <span>Embeber (Iframe)</span>
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-4">
              {/* TAB 1: PDF */}
              {activeTab === 'pdf' && (
                <div className="space-y-4">
                  <div className="rounded-lg border border-primary/20 bg-primary/5 p-3.5 flex items-start gap-3">
                    <Sparkles className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                    <div className="text-xs space-y-1">
                      <p className="font-medium text-foreground">Reporte Corporativo de Alta Fidelidad</p>
                      <p className="text-muted-foreground">
                        Renderizado en servidor dedicado con Puppeteer para vectorizar gráficos, incluir el logo de tu organización y paginación limpia.
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs text-foreground font-medium">Formato de Hoja</Label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setPageSize('Letter')}
                        className={`rounded-lg border p-3 text-left transition-colors ${
                          pageSize === 'Letter'
                            ? 'border-primary bg-primary/10 text-foreground'
                            : 'border-border bg-card hover:bg-accent/40 text-muted-foreground'
                        }`}
                      >
                        <p className="text-xs font-semibold">Carta (Letter)</p>
                        <p className="text-[11px] text-muted-foreground">8.5" × 11" · Estándar LatAm / USA</p>
                      </button>

                      <button
                        type="button"
                        onClick={() => setPageSize('A4')}
                        className={`rounded-lg border p-3 text-left transition-colors ${
                          pageSize === 'A4'
                            ? 'border-primary bg-primary/10 text-foreground'
                            : 'border-border bg-card hover:bg-accent/40 text-muted-foreground'
                        }`}
                      >
                        <p className="text-xs font-semibold">A4</p>
                        <p className="text-[11px] text-muted-foreground">210 × 297 mm · Estándar Internacional</p>
                      </button>
                    </div>
                  </div>

                  {isPdfExporting && (
                    <div className="rounded-lg border border-border bg-muted/40 p-3 flex items-center gap-3">
                      <Loader2 className="w-4 h-4 text-primary animate-spin" />
                      <div className="text-xs">
                        <p className="font-medium text-foreground">{getPdfStatusText()}</p>
                        <p className="text-[11px] text-muted-foreground">Esto suele tardar de 3 a 6 segundos.</p>
                      </div>
                    </div>
                  )}

                  <Button
                    onClick={handleExportPdf}
                    disabled={isPdfExporting}
                    className="w-full gap-2 text-xs h-10 font-medium"
                  >
                    {isPdfExporting ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Generando PDF...</span>
                      </>
                    ) : (
                      <>
                        <Download className="w-3.5 h-3.5" />
                        <span>Generar y Descargar PDF</span>
                      </>
                    )}
                  </Button>
                </div>
              )}

              {/* TAB 2: PNG */}
              {activeTab === 'png' && (
                <div className="space-y-4">
                  <div className="rounded-lg border border-border bg-muted/20 p-3.5 text-xs text-muted-foreground space-y-1">
                    <p className="font-medium text-foreground">Captura Instantánea para Slack o Email</p>
                    <p>
                      Exporta una imagen PNG nítida a 2x Retina con las métricas y gráficos visibles actualmente en tu pantalla.
                    </p>
                  </div>

                  <Button
                    onClick={handleExportPng}
                    disabled={isPngExporting}
                    variant="default"
                    className="w-full gap-2 text-xs h-10 font-medium"
                  >
                    {isPngExporting ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Capturando imagen...</span>
                      </>
                    ) : (
                      <>
                        <Download className="w-3.5 h-3.5" />
                        <span>Exportar Imagen PNG</span>
                      </>
                    )}
                  </Button>
                </div>
              )}

              {/* TAB 3: SHARE LINK */}
              {activeTab === 'share' && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label className="text-xs text-foreground font-medium">Vigencia del enlace</Label>
                    <div className="grid grid-cols-4 gap-1.5">
                      {[
                        { days: 7, label: '7 días' },
                        { days: 30, label: '30 días' },
                        { days: 90, label: '90 días' },
                        { days: 365, label: '1 año' },
                      ].map((item) => (
                        <button
                          key={item.days}
                          type="button"
                          onClick={() => setExpiresInDays(item.days)}
                          className={`rounded-md border py-1.5 text-center text-xs transition-colors ${
                            expiresInDays === item.days
                              ? 'border-primary bg-primary/10 font-semibold text-primary'
                              : 'border-border bg-card text-muted-foreground hover:bg-accent/40'
                          }`}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <Button
                    onClick={handleCreatePublicLink}
                    disabled={isCreatingLink}
                    className="w-full gap-2 text-xs h-9 font-medium"
                  >
                    {isCreatingLink ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Generando enlace...</span>
                      </>
                    ) : (
                      <>
                        <Link2 className="w-3.5 h-3.5" />
                        <span>Generar enlace público</span>
                      </>
                    )}
                  </Button>

                  {/* Active links section */}
                  <div className="pt-2 border-t border-border space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs text-foreground font-medium">Enlaces Activos</Label>
                      {isLoadingLinks && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
                    </div>

                    {activeLinks.length === 0 ? (
                      <p className="text-xs text-muted-foreground italic py-2 text-center">
                        No hay enlaces públicos activos para este dashboard.
                      </p>
                    ) : (
                      <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                        {activeLinks.map((link) => (
                          <div
                            key={link.id}
                            className="flex items-center justify-between gap-2 p-2.5 rounded-lg border border-border bg-muted/20 text-xs"
                          >
                            <div className="min-w-0 flex-1 space-y-0.5">
                              <div className="flex items-center gap-1.5">
                                <a
                                  href={link.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="font-mono text-[11px] text-primary hover:underline truncate inline-flex items-center gap-1"
                                >
                                  {link.url.replace(/^https?:\/\//, '')}
                                  <ExternalLink className="w-2.5 h-2.5 shrink-0 opacity-70" />
                                </a>
                              </div>
                              <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                                <span>{link.viewCount} vistas</span>
                                <span>·</span>
                                <span>
                                  {link.expiresAt
                                    ? `Vence: ${new Date(link.expiresAt).toLocaleDateString('es-CL')}`
                                    : 'Sin vencimiento'}
                                </span>
                              </div>
                            </div>

                            <div className="flex items-center gap-1 shrink-0">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => copyToClipboard(link.url, link.id)}
                                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                                title="Copiar enlace"
                              >
                                {copiedId === link.id ? (
                                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                                ) : (
                                  <Copy className="w-3.5 h-3.5" />
                                )}
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleRevokeLink(link.id)}
                                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                title="Revocar enlace"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* TAB 4: EMBED (IFRAME) */}
              {activeTab === 'embed' && (
                <div className="space-y-4">
                  <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground space-y-1">
                    <p className="font-medium text-foreground">Integración en Plataformas & SaaS de Terceros</p>
                    <p>
                      Genera un token firmado con CSP para embeber este dashboard en tu propia app vía iframe sin mostrar controles administrativos.
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs text-foreground font-medium">Dominios autorizados (CORS / CSP)</Label>
                    <input
                      type="text"
                      value={embedOrigin}
                      onChange={(e) => setEmbedOrigin(e.target.value)}
                      placeholder="https://app.mi-empresa.com, https://portal.com (o * para todos)"
                      className="w-full h-8 px-2.5 text-xs rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary font-mono"
                    />
                    <p className="text-[10px] text-muted-foreground">
                      Usa <code className="bg-muted px-1 py-0.5 rounded text-[10px]">*</code> para pruebas locales o especifica los dominios separados por coma.
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-foreground font-medium">Tema Visual</Label>
                      <select
                        value={embedTheme}
                        onChange={(e) => setEmbedTheme(e.target.value as 'moderno-saas' | 'corporate' | 'transparent')}
                        className="w-full h-8 px-2 text-xs rounded-md border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                      >
                        <option value="moderno-saas">Moderno SaaS</option>
                        <option value="corporate">Corporate</option>
                        <option value="transparent">Fondo Transparente</option>
                      </select>
                    </div>

                    <div className="space-y-1.5 flex flex-col justify-end pb-1">
                      <label className="flex items-center gap-2 cursor-pointer text-xs text-foreground select-none">
                        <input
                          type="checkbox"
                          checked={embedHideTitle}
                          onChange={(e) => setEmbedHideTitle(e.target.checked)}
                          className="rounded border-border text-primary focus:ring-primary h-3.5 w-3.5"
                        />
                        <span>Ocultar título</span>
                      </label>
                    </div>
                  </div>

                  <Button
                    onClick={handleGenerateEmbed}
                    disabled={isGeneratingEmbed}
                    className="w-full gap-2 text-xs h-9 font-medium"
                  >
                    {isGeneratingEmbed ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Generando snippet...</span>
                      </>
                    ) : (
                      <>
                        <Code className="w-3.5 h-3.5" />
                        <span>Generar Código Iframe</span>
                      </>
                    )}
                  </Button>

                  {generatedSnippet && (
                    <div className="space-y-1.5 pt-2 border-t border-border">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs text-foreground font-medium">Código Iframe Generado</Label>
                        <span className="text-[10px] text-emerald-400 font-medium">
                          {copiedEmbed ? '¡Copiado!' : 'Listo para insertar'}
                        </span>
                      </div>
                      <div className="relative">
                        <pre className="p-2.5 rounded-lg border border-border bg-muted/40 font-mono text-[11px] text-foreground overflow-x-auto whitespace-pre-wrap break-all">
                          {generatedSnippet}
                        </pre>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            void navigator.clipboard.writeText(generatedSnippet);
                            setCopiedEmbed(true);
                            setTimeout(() => setCopiedEmbed(false), 2000);
                          }}
                          className="absolute top-2 right-2 h-7 px-2 text-xs gap-1"
                        >
                          {copiedEmbed ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                          <span>Copiar</span>
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
