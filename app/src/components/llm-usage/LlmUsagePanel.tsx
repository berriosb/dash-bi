'use client';

import * as React from 'react';
import { Card } from '@/components/ui/card';
import { Loader2, Coins, Activity, Zap, TrendingUp } from 'lucide-react';

interface ProviderStat {
  provider: string;
  model: string;
  count: number;
  totalCostUsd: string;
  totalTokens: number;
}

interface DayStat {
  day: string;
  count: number;
  costUsd: string;
}

interface LlmUsageResponse {
  window: { days: number; since: string };
  totals: {
    totalRequests: number;
    successCount: number;
    totalPromptTokens: number;
    totalCompletionTokens: number;
    totalCostUsd: string;
    avgLatencyMs: number;
  };
  byProvider: ProviderStat[];
  byDay: DayStat[];
}

function formatUsd(value: string): string {
  const n = Number(value);
  if (Number.isNaN(n)) return '$0.00';
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

function formatNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

export function LlmUsagePanel() {
  const [data, setData] = React.useState<LlmUsageResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [days, setDays] = React.useState(30);

  const fetchData = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/llm-usage/stats?days=${days}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      const json = await res.json();
      setData(json);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setLoading(false);
    }
  }, [days]);

  React.useEffect(() => {
    fetchData();
  }, [fetchData]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Uso de IA</h2>
          <p className="text-sm text-muted-foreground">
            Costos y métricas de los proveedores LLM configurados en tu org.
          </p>
        </div>
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="property-select"
          aria-label="Ventana de tiempo"
        >
          <option value={7}>Últimos 7 días</option>
          <option value={30}>Últimos 30 días</option>
          <option value={90}>Últimos 90 días</option>
        </select>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          Cargando…
        </div>
      )}

      {error && (
        <div className="llm-usage__error" role="alert">
          {error}
        </div>
      )}

      {data && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <StatCard
              icon={<Coins className="w-4 h-4 text-amber-400" />}
              label="Costo total"
              value={formatUsd(data.totals.totalCostUsd)}
            />
            <StatCard
              icon={<Activity className="w-4 h-4 text-indigo-400" />}
              label="Requests"
              value={formatNumber(data.totals.totalRequests)}
              subtext={`${data.totals.successCount} ok`}
            />
            <StatCard
              icon={<Zap className="w-4 h-4 text-violet-400" />}
              label="Tokens"
              value={formatNumber(data.totals.totalPromptTokens + data.totals.totalCompletionTokens)}
              subtext={`${formatNumber(data.totals.totalPromptTokens)} prompt · ${formatNumber(data.totals.totalCompletionTokens)} completion`}
            />
            <StatCard
              icon={<TrendingUp className="w-4 h-4 text-emerald-400" />}
              label="Latencia media"
              value={`${data.totals.avgLatencyMs}ms`}
            />
          </div>

          {data.byProvider.length > 0 && (
            <Card className="llm-usage__card">
              <h3 className="llm-usage__heading">Por proveedor</h3>
              <table className="llm-usage__table">
                <thead>
                  <tr>
                    <th>Proveedor</th>
                    <th>Modelo</th>
                    <th className="text-right">Requests</th>
                    <th className="text-right">Tokens</th>
                    <th className="text-right">Costo</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byProvider.map((row) => (
                    <tr key={`${row.provider}-${row.model}`}>
                      <td>{row.provider}</td>
                      <td><code className="text-xs">{row.model}</code></td>
                      <td className="text-right">{row.count}</td>
                      <td className="text-right">{formatNumber(row.totalTokens)}</td>
                      <td className="text-right font-medium">{formatUsd(row.totalCostUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}

          {data.byDay.length > 0 && (
            <Card className="llm-usage__card">
              <h3 className="llm-usage__heading">Por día</h3>
              <DayChart data={data.byDay} />
            </Card>
          )}

          {data.byProvider.length === 0 && data.byDay.length === 0 && (
            <Card className="llm-usage__card">
              <p className="text-sm text-muted-foreground">
                Sin uso registrado en los últimos {days} días. Probá generar un dashboard o hacer una pregunta en el chat NLQA.
              </p>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  subtext,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  subtext?: string;
}) {
  return (
    <Card className="llm-usage__stat">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <p className="llm-usage__stat-value">{value}</p>
      {subtext && <p className="llm-usage__stat-subtext">{subtext}</p>}
    </Card>
  );
}

function DayChart({ data }: { data: DayStat[] }) {
  const maxCost = Math.max(...data.map((d) => Number(d.costUsd)), 0);
  if (maxCost === 0) {
    return <p className="text-sm text-muted-foreground">Sin datos.</p>;
  }
  return (
    <div className="llm-usage__day-chart">
      {data.map((d) => {
        const heightPct = (Number(d.costUsd) / maxCost) * 100;
        return (
          <div key={d.day} className="llm-usage__day-col" title={`${d.day}: ${formatUsd(d.costUsd)} (${d.count} req)`}>
            <div
              className="llm-usage__day-bar"
              style={{ height: `${Math.max(2, heightPct)}%` }}
            />
            <span className="llm-usage__day-label">{d.day.slice(5)}</span>
          </div>
        );
      })}
    </div>
  );
}