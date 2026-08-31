"use client";

import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarClock,
  ChevronDown,
  ChevronUp,
  Loader2,
  Pause,
  Play,
  Plus,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { parseRecipientEmails } from "@/lib/reports/ui";

interface DashboardSummary {
  id: string;
  title: string;
}

interface ScheduledReport {
  id: string;
  dashboardId: string;
  title: string | null;
  cron: string;
  timezone: string;
  format: "pdf" | "png-link";
  recipients: Array<{ email: string; name?: string }>;
  enabled: boolean;
  nextRunAt: string | null;
  lastRunStatus: "success" | "failed" | "skipped" | null;
  lastRunAt: string | null;
}

interface ReportRun {
  id: string;
  status: "success" | "failed" | "skipped";
  startedAt: string;
  completedAt: string | null;
  errorMessage: string | null;
}

async function getJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok)
    throw new Error(body.error ?? "No pudimos completar la operación.");
  return body;
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("es-CL", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

const CRON_PRESETS = [
  { label: 'Semanal (Lunes a las 09:00)', value: '0 9 * * 1' },
  { label: 'Días hábiles (Lun a Vie 08:00)', value: '0 8 * * 1-5' },
  { label: 'Mensual (1° del mes 09:00)', value: '0 9 1 * *' },
  { label: 'Personalizado (cron)', value: 'custom' },
];

export default function ReportsPage() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dashboardId, setDashboardId] = useState("");
  const [title, setTitle] = useState("");
  const [selectedPreset, setSelectedPreset] = useState("0 9 * * 1");
  const [cron, setCron] = useState("0 9 * * 1");
  const [format, setFormat] = useState<"pdf" | "png-link">("pdf");
  const [recipients, setRecipients] = useState("");

  const reportsQuery = useQuery({
    queryKey: ["scheduled-reports"],
    queryFn: () =>
      getJson<{ reports: ScheduledReport[] }>("/api/scheduled-reports"),
  });
  const dashboardsQuery = useQuery({
    queryKey: ["dashboards", "report-form"],
    queryFn: () =>
      getJson<{ dashboards: DashboardSummary[] }>("/api/dashboards"),
    enabled: showForm,
  });
  const detailQuery = useQuery({
    queryKey: ["scheduled-report", selectedReportId],
    queryFn: () =>
      getJson<{ runs: ReportRun[] }>(
        `/api/scheduled-reports/${selectedReportId}`,
      ),
    enabled: selectedReportId !== null,
  });

  const invalidateReports = () =>
    queryClient.invalidateQueries({ queryKey: ["scheduled-reports"] });
  const mutation = useMutation({
    mutationFn: ({
      id,
      method,
      body,
    }: {
      id: string;
      method: "PATCH" | "DELETE";
      body?: unknown;
    }) =>
      getJson(`/api/scheduled-reports/${id}`, {
        method,
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      }),
    onSuccess: invalidateReports,
    onError: (mutationError) =>
      setError(
        mutationError instanceof Error
          ? mutationError.message
          : "No pudimos actualizar el reporte.",
      ),
  });

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    const parsedRecipients = parseRecipientEmails(recipients);
    if (!dashboardId || parsedRecipients.length === 0) {
      setError("Elegí un dashboard y al menos un email destinatario.");
      return;
    }

    try {
      await getJson("/api/scheduled-reports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          dashboardId,
          title: title || undefined,
          cron,
          format,
          recipients: parsedRecipients,
        }),
      });
      await invalidateReports();
      setShowForm(false);
      setTitle("");
      setRecipients("");
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "No pudimos crear el reporte.",
      );
    }
  };

  const reports = reportsQuery.data?.reports ?? [];

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Distribución
          </p>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <CalendarClock className="h-6 w-6 text-primary" /> Reportes
            programados
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Enviá dashboards por email según un calendario controlado.
          </p>
        </div>
        <Button
          data-testid="new-report-button"
          onClick={() => {
            setError(null);
            setShowForm((value) => !value);
          }}
        >
          <Plus className="mr-2 h-4 w-4" /> Nuevo reporte
        </Button>
      </div>

      {error && (
        <div
          className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
          role="alert"
        >
          {error}
        </div>
      )}

      {showForm && (
        <Card data-testid="create-report-card">
          <CardHeader>
            <CardTitle>Programar un envío</CardTitle>
            <CardDescription>
              Configurá la frecuencia de envío y los destinatarios del informe.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="grid gap-4 md:grid-cols-2" onSubmit={handleCreate}>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="report-dashboard">Dashboard</Label>
                <select
                  id="report-dashboard"
                  value={dashboardId}
                  onChange={(event) => setDashboardId(event.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  required
                >
                  <option value="">Seleccioná un dashboard</option>
                  {(dashboardsQuery.data?.dashboards ?? []).map((dashboard) => (
                    <option key={dashboard.id} value={dashboard.id}>
                      {dashboard.title}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="report-title">Título opcional</Label>
                <Input
                  id="report-title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Resumen semanal para directorio"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="report-format">Formato de entrega</Label>
                <select
                  id="report-format"
                  value={format}
                  onChange={(e) => setFormat(e.target.value as "pdf" | "png-link")}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="pdf">Documento PDF adjunto</option>
                  <option value="png-link">Enlace web interactivo</option>
                </select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="report-preset">Frecuencia</Label>
                <select
                  id="report-preset"
                  value={selectedPreset}
                  onChange={(event) => {
                    const val = event.target.value;
                    setSelectedPreset(val);
                    if (val !== 'custom') {
                      setCron(val);
                    }
                  }}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  {CRON_PRESETS.map((preset) => (
                    <option key={preset.value} value={preset.value}>
                      {preset.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="report-cron">Expresión Cron</Label>
                <Input
                  id="report-cron"
                  value={cron}
                  onChange={(event) => {
                    setCron(event.target.value);
                    setSelectedPreset('custom');
                  }}
                  placeholder="0 9 * * 1"
                  required
                />
              </div>

              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="report-recipients">Destinatarios (separados por coma)</Label>
                <Input
                  id="report-recipients"
                  value={recipients}
                  onChange={(event) => setRecipients(event.target.value)}
                  placeholder="ana@empresa.com, equipo@empresa.com"
                  required
                />
              </div>

              <div className="flex gap-2 md:col-span-2">
                <Button type="submit">Guardar programación</Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowForm(false)}
                >
                  Cancelar
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Programaciones activas</CardTitle>
          <CardDescription>
            {reports.length} reporte{reports.length === 1 ? "" : "s"}{" "}
            configurado{reports.length === 1 ? "" : "s"}.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {reportsQuery.isLoading && (
            <p className="text-sm text-muted-foreground">
              Cargando programaciones…
            </p>
          )}
          {reportsQuery.isError && (
            <p className="text-sm text-destructive">
              No pudimos cargar los reportes.
            </p>
          )}
          {!reportsQuery.isLoading && reports.length === 0 && (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              Todavía no hay envíos programados.
            </p>
          )}
          {reports.map((report) => (
            <div key={report.id} className="rounded-lg border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="font-medium">
                      {report.title || "Reporte sin título"}
                    </h2>
                    <Badge variant={report.enabled ? "default" : "outline"}>
                      {report.enabled ? "Activo" : "Pausado"}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Cron <code>{report.cron}</code> · Próximo envío:{" "}
                    {formatDate(report.nextRunAt)}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Para:{" "}
                    {report.recipients
                      .map((recipient) => recipient.email)
                      .join(", ")}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      mutation.mutate({
                        id: report.id,
                        method: "PATCH",
                        body: { enabled: !report.enabled },
                      })
                    }
                    disabled={mutation.isPending}
                  >
                    {report.enabled ? (
                      <Pause className="mr-1 h-4 w-4" />
                    ) : (
                      <Play className="mr-1 h-4 w-4" />
                    )}{" "}
                    {report.enabled ? "Pausar" : "Activar"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Eliminar reporte"
                    onClick={() =>
                      mutation.mutate({ id: report.id, method: "DELETE" })
                    }
                    disabled={mutation.isPending}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Ver historial"
                    onClick={() =>
                      setSelectedReportId(
                        selectedReportId === report.id ? null : report.id,
                      )
                    }
                  >
                    {selectedReportId === report.id ? (
                      <ChevronUp className="h-4 w-4" />
                    ) : (
                      <ChevronDown className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
              {selectedReportId === report.id && (
                <div className="mt-4 border-t pt-3">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Últimas ejecuciones
                  </p>
                  {detailQuery.isLoading && (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  )}
                  {(detailQuery.data?.runs ?? []).length === 0 &&
                    !detailQuery.isLoading && (
                      <p className="text-sm text-muted-foreground">
                        Todavía no hay ejecuciones.
                      </p>
                    )}
                  <div className="space-y-2">
                    {(detailQuery.data?.runs ?? []).map((run) => (
                      <div
                        key={run.id}
                        className="flex flex-wrap justify-between gap-2 text-xs"
                      >
                        <span>
                          <Badge variant="outline">{run.status}</Badge>{" "}
                          {formatDate(run.startedAt)}
                        </span>
                        <span className="text-muted-foreground">
                          {run.errorMessage ?? formatDate(run.completedAt)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
