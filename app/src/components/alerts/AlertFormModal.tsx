'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { useMutation } from '@tanstack/react-query';
import { X, Plus, Trash2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import type { AlertChannelConfig } from '@/lib/alerts/types';

type ConditionKind = 'threshold_above' | 'threshold_below' | 'threshold_outside_range' | 'equals' | 'missing_data';

interface AlertFormState {
  name: string;
  description: string;
  querySql: string;
  queryColumns: { value: string };
  condition:
    | { kind: 'threshold_above'; threshold: number }
    | { kind: 'threshold_below'; threshold: number }
    | { kind: 'threshold_outside_range'; min: number; max: number }
    | { kind: 'equals'; value: number }
    | { kind: 'missing_data'; windowMinutes: number };
  evaluationIntervalMinutes: number;
  consecutiveBreachesToFire: number;
  cooldownMinutes: number;
  channels: AlertChannelConfig[];
}

const DEFAULT_STATE: AlertFormState = {
  name: '',
  description: '',
  querySql: '',
  queryColumns: { value: '' },
  condition: { kind: 'threshold_below', threshold: 0 },
  evaluationIntervalMinutes: 5,
  consecutiveBreachesToFire: 1,
  cooldownMinutes: 60,
  channels: [
    { type: 'slack', webhookUrl: '', channelLabel: '#alerts' },
  ],
};

interface AlertFormModalProps {
  dashboardId: string;
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

async function createAlert(
  dashboardId: string,
  payload: AlertFormState,
): Promise<{ id: string }> {
  const res = await fetch(`/api/dashboards/${dashboardId}/alerts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? 'No pudimos crear la alerta');
  }
  return res.json();
}

export function AlertFormModal({
  dashboardId,
  open,
  onClose,
  onCreated,
}: AlertFormModalProps) {
  const { toast } = useToast();
  const [state, setState] = React.useState<AlertFormState>(DEFAULT_STATE);
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => setMounted(true), []);

  // Reset form on close
  React.useEffect(() => {
    if (!open) setState(DEFAULT_STATE);
  }, [open]);

  const createMutation = useMutation({
    mutationFn: () => createAlert(dashboardId, state),
    onSuccess: ({ id }) => {
      toast({ title: 'Alerta creada', description: `ID: ${id.slice(0, 8)}` });
      onCreated();
      onClose();
    },
    onError: (err: Error) => {
      toast({
        variant: 'destructive',
        title: 'Error al crear la alerta',
        description: err.message,
      });
    },
  });

  if (!mounted || !open) return null;

  const clientErrors = validate(state);
  const isValid = Object.keys(clientErrors).length === 0;

  function update<K extends keyof AlertFormState>(key: K, value: AlertFormState[K]) {
    setState((s) => ({ ...s, [key]: value }));
  }

  function updateCondition(condition: AlertFormState['condition']) {
    setState((s) => ({ ...s, condition }));
  }

  function updateChannel(index: number, channel: AlertChannelConfig) {
    setState((s) => {
      const channels = [...s.channels];
      channels[index] = channel;
      return { ...s, channels };
    });
  }

  function removeChannel(index: number) {
    setState((s) => ({ ...s, channels: s.channels.filter((_, i) => i !== index) }));
  }

  function addChannel(type: 'slack' | 'email' | 'webhook') {
    const fresh: AlertChannelConfig =
      type === 'slack'
        ? { type: 'slack', webhookUrl: '', channelLabel: '#alerts' }
        : type === 'email'
          ? { type: 'email', recipients: [''], subject: 'Alerta dash-bi' }
          : { type: 'webhook', url: '' };
    setState((s) => ({ ...s, channels: [...s.channels, fresh] }));
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="alert-form-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in-0"
    >
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl border border-border bg-card shadow-2xl text-card-foreground">
        <div className="flex items-center justify-between border-b border-border/70 px-6 py-4 sticky top-0 bg-card z-10">
          <div>
            <h2 id="alert-form-title" className="text-lg font-semibold">Nueva alerta</h2>
            <p className="text-xs text-muted-foreground">
              Te notificamos por Slack, email o webhook cuando una métrica cruce el umbral.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Cerrar">
            <X className="w-4 h-4" />
          </Button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (isValid) createMutation.mutate();
          }}
          className="px-6 py-5 space-y-5"
        >
          {/* Name */}
          <Field label="Nombre" required error={clientErrors.name}>
            <Input
              value={state.name}
              onChange={(e) => update('name', e.target.value)}
              placeholder="Revenue diario bajo $50k"
              maxLength={100}
              required
            />
          </Field>

          {/* Description */}
          <Field label="Descripción (opcional)" error={clientErrors.description}>
            <textarea
              value={state.description}
              onChange={(e) => update('description', e.target.value)}
              placeholder="Se dispara cuando el revenue diario cae por debajo de $50k por 2 checks seguidos"
              maxLength={500}
              rows={2}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </Field>

          {/* SQL */}
          <Field label="Métrica (SQL)" required error={clientErrors.querySql}>
            <textarea
              value={state.querySql}
              onChange={(e) => update('querySql', e.target.value)}
              placeholder={`SELECT SUM(amount) AS revenue\nFROM orders\nWHERE created_at > NOW() - INTERVAL '1 day'`}
              rows={4}
              required
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Solo SELECT. LIMIT 1 se inyecta automáticamente.
            </p>
          </Field>

          {/* Value column */}
          <Field label="Columna del valor" required error={clientErrors.queryColumns}>
            <Input
              value={state.queryColumns.value}
              onChange={(e) =>
                update('queryColumns', { value: e.target.value })
              }
              placeholder="revenue"
              required
            />
          </Field>

          {/* Condition */}
          <Field label="Condición" required error={clientErrors.condition}>
            <ConditionEditor
              condition={state.condition}
              onChange={updateCondition}
            />
          </Field>

          {/* Evaluation cadence */}
          <Field label="Evalúa cada">
            <select
              value={state.evaluationIntervalMinutes}
              onChange={(e) => update('evaluationIntervalMinutes', Number(e.target.value))}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="5">5 minutos</option>
              <option value="15">15 minutos</option>
              <option value="30">30 minutos</option>
              <option value="60">1 hora</option>
              <option value="360">6 horas</option>
              <option value="1440">24 horas</option>
            </select>
          </Field>

          {/* Consecutive breaches */}
          <Field
            label="Checks consecutivos para disparar"
            help="Evita alertas por un spike momentáneo"
          >
            <Input
              type="number"
              min={1}
              max={10}
              value={state.consecutiveBreachesToFire}
              onChange={(e) => update('consecutiveBreachesToFire', Number(e.target.value))}
            />
          </Field>

          {/* Cooldown */}
          <Field
            label="Cooldown (minutos)"
            help="No re-disparar dentro de este tiempo"
          >
            <Input
              type="number"
              min={1}
              value={state.cooldownMinutes}
              onChange={(e) => update('cooldownMinutes', Number(e.target.value))}
            />
          </Field>

          {/* Channels */}
          <Field label="Canales" required error={clientErrors.channels}>
            <ChannelEditor
              channels={state.channels}
              onUpdate={updateChannel}
              onRemove={removeChannel}
              onAdd={addChannel}
            />
          </Field>

          {Object.keys(clientErrors).length > 0 && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <div>
                <p className="font-medium mb-1">Revisá los campos marcados antes de continuar.</p>
                <ul className="list-disc pl-4 space-y-0.5">
                  {Object.entries(clientErrors).map(([k, v]) => (
                    <li key={k}>{v}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 pt-4 border-t border-border/40 sticky bottom-0 bg-card">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={!isValid || createMutation.isPending}>
              {createMutation.isPending ? 'Creando…' : 'Crear alerta'}
            </Button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}

// ─── sub-components ───────────────────────────────────────────────

function Field({
  label,
  required,
  help,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  help?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium text-foreground/90">
        {label}
        {required && <span className="text-destructive ml-0.5">*</span>}
      </Label>
      {children}
      {help && !error && <p className="text-xs text-muted-foreground">{help}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function ConditionEditor({
  condition,
  onChange,
}: {
  condition: AlertFormState['condition'];
  onChange: (c: AlertFormState['condition']) => void;
}) {
  function changeKind(kind: ConditionKind) {
    switch (kind) {
      case 'threshold_above':
        onChange({ kind, threshold: 0 });
        return;
      case 'threshold_below':
        onChange({ kind, threshold: 0 });
        return;
      case 'threshold_outside_range':
        onChange({ kind, min: 0, max: 100 });
        return;
      case 'equals':
        onChange({ kind, value: 0 });
        return;
      case 'missing_data':
        onChange({ kind, windowMinutes: 30 });
        return;
    }
  }

  return (
    <div className="space-y-2">
      <select
        value={condition.kind}
        onChange={(e) => changeKind(e.target.value as ConditionKind)}
        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
      >
        <option value="threshold_below">Por debajo del umbral</option>
        <option value="threshold_above">Por encima del umbral</option>
        <option value="threshold_outside_range">Fuera del rango (min..max)</option>
        <option value="equals">Igual a a valor exacto</option>
        <option value="missing_data">Sin datos (data freshness)</option>
      </select>

      {condition.kind === 'threshold_above' ||
      condition.kind === 'threshold_below' ? (
        <Input
          type="number"
          value={condition.threshold}
          onChange={(e) =>
            onChange({ kind: condition.kind, threshold: Number(e.target.value) })
          }
          placeholder="Umbral"
        />
      ) : null}

      {condition.kind === 'threshold_outside_range' ? (
        <div className="flex gap-2">
          <Input
            type="number"
            value={condition.min}
            onChange={(e) =>
              onChange({ kind: 'threshold_outside_range', min: Number(e.target.value), max: condition.max })
            }
            placeholder="min"
          />
          <Input
            type="number"
            value={condition.max}
            onChange={(e) =>
              onChange({ kind: 'threshold_outside_range', min: condition.min, max: Number(e.target.value) })
            }
            placeholder="max"
          />
        </div>
      ) : null}

      {condition.kind === 'equals' ? (
        <Input
          type="number"
          value={condition.value}
          onChange={(e) => onChange({ kind: 'equals', value: Number(e.target.value) })}
          placeholder="Valor exacto"
        />
      ) : null}

      {condition.kind === 'missing_data' ? (
        <Input
          type="number"
          min={1}
          value={condition.windowMinutes}
          onChange={(e) =>
            onChange({ kind: 'missing_data', windowMinutes: Number(e.target.value) })
          }
          placeholder="Ventana en minutos"
        />
      ) : null}
    </div>
  );
}

function ChannelEditor({
  channels,
  onUpdate,
  onRemove,
  onAdd,
}: {
  channels: AlertChannelConfig[];
  onUpdate: (index: number, channel: AlertChannelConfig) => void;
  onRemove: (index: number) => void;
  onAdd: (type: 'slack' | 'email' | 'webhook') => void;
}) {
  return (
    <div className="space-y-3">
      {channels.map((ch, i) => (
        <div
          key={i}
          className="rounded-md border border-border/60 bg-background p-3 space-y-2"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              {channelLabel(ch)}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onRemove(i)}
              aria-label="Eliminar canal"
            >
              <Trash2 className="w-3.5 h-3.5 text-destructive" />
            </Button>
          </div>

          {ch.type === 'slack' && (
            <>
              <Input
                value={ch.webhookUrl}
                onChange={(e) =>
                  onUpdate(i, { ...ch, webhookUrl: e.target.value })
                }
                placeholder="https://hooks.slack.com/services/T00/B00/xxx"
              />
              <Input
                value={ch.channelLabel}
                onChange={(e) =>
                  onUpdate(i, { ...ch, channelLabel: e.target.value })
                }
                placeholder="#revenue-alerts"
              />
            </>
          )}

          {ch.type === 'email' && (
            <>
              <Input
                value={ch.subject}
                onChange={(e) => onUpdate(i, { ...ch, subject: e.target.value })}
                placeholder="Asunto (ej: Alerta: revenue bajo)"
              />
              <div className="space-y-1">
                <Label className="text-xs">Destinatarios (1-10)</Label>
                {ch.recipients.map((email, idx) => (
                  <div key={idx} className="flex gap-1">
                    <Input
                      type="email"
                      value={email}
                      onChange={(e) => {
                        const next = [...ch.recipients];
                        next[idx] = e.target.value;
                        onUpdate(i, { ...ch, recipients: next });
                      }}
                      placeholder="cfo@empresa.com"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        onUpdate(i, {
                          ...ch,
                          recipients: ch.recipients.filter((_, j) => j !== idx),
                        })
                      }
                      aria-label="Eliminar destinatario"
                    >
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ))}
                {ch.recipients.length < 10 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      onUpdate(i, { ...ch, recipients: [...ch.recipients, ''] })
                    }
                  >
                    <Plus className="w-3.5 h-3.5 mr-1" /> Agregar destinatario
                  </Button>
                )}
              </div>
            </>
          )}

          {ch.type === 'webhook' && (
            <>
              <Input
                value={ch.url}
                onChange={(e) => onUpdate(i, { ...ch, url: e.target.value })}
                placeholder="https://example.com/webhook"
              />
              <Input
                value={JSON.stringify(ch.headers ?? {})}
                onChange={(e) => {
                  try {
                    const parsed = JSON.parse(e.target.value);
                    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                      onUpdate(i, { ...ch, headers: parsed as Record<string, string> });
                    }
                  } catch {
                    // ignore parse errors while typing
                  }
                }}
                placeholder='Headers JSON (ej: {"Authorization": "Bearer xxx"})'
              />
              <p className="text-xs text-muted-foreground">
                Opcional. JSON object con header → valor.
              </p>
            </>
          )}
        </div>
      ))}

      {channels.length < 5 && (
        <div className="flex items-center gap-2 pt-1">
          <span className="text-xs text-muted-foreground">Agregar canal:</span>
          <Button type="button" variant="outline" size="sm" onClick={() => onAdd('slack')}>
            + Slack
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => onAdd('email')}>
            + Email
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => onAdd('webhook')}>
            + Webhook
          </Button>
        </div>
      )}
    </div>
  );
}

function channelLabel(ch: AlertChannelConfig): string {
  if (ch.type === 'slack') return `Slack ${ch.channelLabel ?? ''}`.trim();
  if (ch.type === 'email') return `Email (${ch.recipients?.length ?? 0})`;
  return 'Webhook';
}

// ─── client-side validation ─────────────────────────────────────────

function validate(state: AlertFormState): Record<string, string> {
  const errors: Record<string, string> = {};

  if (!state.name.trim()) errors.name = 'El nombre es requerido';
  else if (state.name.length > 100) errors.name = 'Máximo 100 caracteres';

  if (state.description.length > 500) errors.description = 'Máximo 500 caracteres';

  if (state.querySql.trim().length < 10) {
    errors.querySql = 'La query debe tener al menos 10 caracteres';
  } else if (state.querySql.length > 5000) {
    errors.querySql = 'Máximo 5000 caracteres';
  } else if (!/^\s*(SELECT|WITH)\b/i.test(state.querySql)) {
    errors.querySql = 'La query debe empezar con SELECT o WITH';
  }

  if (!state.queryColumns.value.trim()) {
    errors.queryColumns = 'Indicá la columna del valor';
  }

  if (state.condition.kind === 'threshold_outside_range') {
    if (state.condition.min >= state.condition.max) {
      errors.condition = 'min debe ser menor que max';
    }
  }

  if (state.evaluationIntervalMinutes < 1 || state.evaluationIntervalMinutes > 1440) {
    errors.evaluationIntervalMinutes = 'Entre 1 y 1440 minutos';
  }

  if (state.consecutiveBreachesToFire < 1 || state.consecutiveBreachesToFire > 10) {
    errors.consecutiveBreaches = 'Entre 1 y 10 checks';
  }

  if (state.cooldownMinutes < 1 || state.cooldownMinutes > 10080) {
    errors.cooldown = 'Entre 1 minuto y 7 días';
  }

  if (state.channels.length === 0) {
    errors.channels = 'Al menos un canal es requerido';
  } else {
    state.channels.forEach((ch, i) => {
      if (ch.type === 'slack') {
        if (!ch.webhookUrl.startsWith('https://hooks.slack.com/')) {
          errors[`channel_${i}_webhookUrl`] = `Canal ${i + 1}: URL de Slack inválida`;
        }
        if (!ch.channelLabel.trim()) {
          errors[`channel_${i}_channelLabel`] = `Canal ${i + 1}: etiqueta requerida`;
        }
      } else if (ch.type === 'email') {
        if (ch.recipients.length === 0 || ch.recipients.some((r) => !r.includes('@'))) {
          errors[`channel_${i}_recipients`] = `Canal ${i + 1}: al menos un email válido`;
        }
        if (!ch.subject.trim()) {
          errors[`channel_${i}_subject`] = `Canal ${i + 1}: asunto requerido`;
        }
      } else if (ch.type === 'webhook') {
        if (!ch.url.startsWith('https://') && !ch.url.startsWith('http://')) {
          errors[`channel_${i}_url`] = `Canal ${i + 1}: URL inválida`;
        }
      }
    });
  }

  return errors;
}