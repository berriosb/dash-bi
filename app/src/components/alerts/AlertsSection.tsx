'use client';

import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Bell, Pause, Pencil, Trash2, AlertTriangle } from 'lucide-react';

interface AlertRule {
  id: string;
  name: string;
  description: string | null;
  condition: { kind: string; threshold?: number; min?: number; max?: number; value?: number; windowMinutes?: number };
  channels: Array<{ type: 'slack' | 'email' | 'webhook'; webhookUrl?: string; channelLabel?: string; url?: string; recipients?: string[] }>;
  evaluationIntervalMinutes: number;
  consecutiveBreachesToFire: number;
  cooldownMinutes: number;
  enabled: boolean;
  lastFiredAt: string | null;
  lastEvaluationStatus: 'ok' | 'breached' | 'error' | null;
  createdAt: string;
}

interface AlertsSectionProps {
  dashboardId: string;
  canManage: boolean;
}

async function fetchAlerts(dashboardId: string): Promise<{ rules: AlertRule[] }> {
  const res = await fetch(`/api/dashboards/${dashboardId}/alerts`);
  if (!res.ok) throw new Error('No pudimos cargar las alertas');
  return res.json();
}

async function patchAlert(ruleId: string, updates: { enabled?: boolean }): Promise<void> {
  const res = await fetch(`/api/alert-rules/${ruleId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error('No pudimos actualizar la alerta');
}

async function deleteAlert(ruleId: string): Promise<void> {
  const res = await fetch(`/api/alert-rules/${ruleId}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('No pudimos eliminar la alerta');
}

function describeCondition(c: AlertRule['condition']): string {
  switch (c.kind) {
    case 'threshold_above':
      return `Valor > ${c.threshold}`;
    case 'threshold_below':
      return `Valor < ${c.threshold}`;
    case 'threshold_outside_range':
      return `Valor fuera de [${c.min}, ${c.max}]`;
    case 'equals':
      return `Valor === ${c.value}`;
    case 'missing_data':
      return `Sin datos por ${c.windowMinutes} min`;
    default:
      return c.kind;
  }
}

function describeChannels(channels: AlertRule['channels']): string {
  return channels
    .map((c) => {
      if (c.type === 'slack') return `Slack ${c.channelLabel ?? ''}`.trim();
      if (c.type === 'email') return `Email (${c.recipients?.length ?? 0})`;
      if (c.type === 'webhook') return 'Webhook';
      return c.type;
    })
    .join(', ');
}

export function AlertsSection({ dashboardId, canManage }: AlertsSectionProps) {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['alerts', dashboardId],
    queryFn: () => fetchAlerts(dashboardId),
    enabled: canManage,
  });

  const toggleMutation = useMutation({
    mutationFn: ({ ruleId, enabled }: { ruleId: string; enabled: boolean }) =>
      patchAlert(ruleId, { enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['alerts', dashboardId] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (ruleId: string) => deleteAlert(ruleId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['alerts', dashboardId] }),
  });

  if (!canManage) return null;

  if (isLoading) {
    return (
      <div className="rounded-lg border border-border bg-card p-6">
        <div className="flex items-center gap-2 mb-4">
          <Bell className="w-4 h-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Alertas</h2>
        </div>
        <p className="text-sm text-muted-foreground">Cargando…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-border bg-card p-6">
        <div className="flex items-center gap-2 mb-4">
          <Bell className="w-4 h-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Alertas</h2>
        </div>
        <p className="text-sm text-destructive">No pudimos cargar las alertas.</p>
      </div>
    );
  }

  const rules = data?.rules ?? [];

  return (
    <div className="rounded-lg border border-border bg-card p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bell className="w-4 h-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Alertas
          </h2>
          {rules.length > 0 && (
            <Badge variant="secondary" className="text-xs">
              {rules.length}
            </Badge>
          )}
        </div>
        <Button variant="outline" size="sm" disabled title="Crear alerta (próximamente)">
          + Nueva alerta
        </Button>
      </div>

      {rules.length === 0 ? (
        <div className="rounded-md border border-dashed border-border bg-muted/30 p-6 text-center">
          <AlertTriangle className="w-6 h-6 mx-auto mb-2 text-muted-foreground" />
          <p className="text-sm text-muted-foreground mb-1">Sin alertas configuradas</p>
          <p className="text-xs text-muted-foreground/80">
            Configura umbrales y canales (Slack, email, webhook) para recibir notificaciones
            cuando una métrica cruce el límite.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {rules.map((rule) => (
            <li
              key={rule.id}
              className="flex items-start justify-between gap-4 rounded-md border border-border/60 bg-background px-4 py-3"
            >
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm">{rule.name}</span>
                  {!rule.enabled && (
                    <Badge variant="outline" className="text-xs">
                      Pausada
                    </Badge>
                  )}
                  {rule.lastEvaluationStatus === 'error' && (
                    <Badge variant="destructive" className="text-xs">
                      Error de evaluación
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
                    {describeCondition(rule.condition)}
                  </code>
                </p>
                <p className="text-xs text-muted-foreground">
                  Canales: <span className="text-foreground/80">{describeChannels(rule.channels)}</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  Evalúa cada {rule.evaluationIntervalMinutes} min · Cooldown {rule.cooldownMinutes} min
                  {rule.consecutiveBreachesToFire > 1 && (
                    <> · {rule.consecutiveBreachesToFire} checks consecutivos</>
                  )}
                </p>
                {rule.lastFiredAt && (
                  <p className="text-xs text-muted-foreground">
                    Último disparo:{' '}
                    <span className="text-foreground/80">
                      {new Date(rule.lastFiredAt).toLocaleString()}
                    </span>
                  </p>
                )}
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    toggleMutation.mutate({ ruleId: rule.id, enabled: !rule.enabled })
                  }
                  disabled={toggleMutation.isPending}
                  title={rule.enabled ? 'Pausar' : 'Reanudar'}
                  aria-label={rule.enabled ? 'Pausar' : 'Reanudar'}
                >
                  <Pause className="w-4 h-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled
                  title="Editar (próximamente)"
                  aria-label="Editar"
                >
                  <Pencil className="w-4 h-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    if (confirm(`¿Eliminar la alerta "${rule.name}"?`)) {
                      deleteMutation.mutate(rule.id);
                    }
                  }}
                  disabled={deleteMutation.isPending}
                  title="Eliminar"
                  aria-label="Eliminar"
                >
                  <Trash2 className="w-4 h-4 text-destructive" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-muted-foreground/80 pt-2 border-t border-border/40">
        � Las alertas se evalúan cada {rules[0]?.evaluationIntervalMinutes ?? 5} min según configuración.
        Canales: Slack, Email, Webhook custom. Ver{' '}
        <code className="font-mono">specs/alerts.md</code> para detalles.
      </p>
    </div>
  );
}
