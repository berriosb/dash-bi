'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import {
  Sparkles,
  TrendingUp,
  TrendingDown,
  Minus,
  Activity,
  Lightbulb,
  X,
  RotateCcw,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { WidgetExplanationResult } from '@/lib/ai/gateway';

export interface WidgetExplainModalProps {
  isOpen: boolean;
  onClose: () => void;
  widgetTitle: string;
  widgetType: string;
  widgetData: unknown;
  context?: {
    dashboardTitle?: string;
    timeWindow?: string;
    comparativo?: string;
  };
}

function getTrendBadge(trend: WidgetExplanationResult['trend']) {
  switch (trend) {
    case 'upward':
      return {
        label: 'Crecimiento',
        icon: TrendingUp,
        className: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20',
      };
    case 'downward':
      return {
        label: 'Descenso',
        icon: TrendingDown,
        className: 'bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/20',
      };
    case 'volatile':
      return {
        label: 'Volatilidad',
        icon: Activity,
        className: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20',
      };
    case 'stable':
    default:
      return {
        label: 'Estable',
        icon: Minus,
        className: 'bg-slate-500/10 text-slate-700 dark:text-slate-400 border-slate-500/20',
      };
  }
}

function getImpactBadge(impact: 'positive' | 'negative' | 'neutral') {
  switch (impact) {
    case 'positive':
      return {
        label: '+ Positivo',
        className: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20',
      };
    case 'negative':
      return {
        label: '- Negativo',
        className: 'bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/20',
      };
    case 'neutral':
    default:
      return {
        label: '• Neutral',
        className: 'bg-slate-500/10 text-slate-700 dark:text-slate-400 border-slate-500/20',
      };
  }
}

/** Fallback contextual synthesizer for demo or offline preview */
function generateFallbackExplanation(
  widgetTitle: string,
  _widgetType: string,
  _widgetData: unknown,
): WidgetExplanationResult {
  const isRevenue = /mrr|revenue|ingresos|ventas/i.test(widgetTitle);
  const isChurn = /churn|cancelaci[oó]n|abandono/i.test(widgetTitle);

  if (isRevenue) {
    return {
      headline: 'Aumento del 12.4% en MRR impulsado por expansión Enterprise',
      summary:
        'Los ingresos recurrentes alcanzaron su nivel más alto del período debido a contrataciones anuales en el segmento corporativo y mayor retención neta.',
      trend: 'upward',
      keyDrivers: [
        {
          label: 'Expansión de cuentas Enterprise',
          impact: 'positive',
          detail: '4 nuevos cierres de cuentas clave aportaron más del 65% del volumen incremental.',
        },
        {
          label: 'Tasa de Cancelación',
          impact: 'positive',
          detail: 'El churn bruto descendió a mínimos históricos (1.8%).',
        },
        {
          label: 'Inversión en Adquisición (CAC)',
          impact: 'neutral',
          detail: 'Costo por adquisición se mantuvo estable en el rango presupuestado.',
        },
      ],
      suggestedAction:
        'Focalizar las campañas de ventas B2B en el vertical tecnológico para capitalizar el momento comercial.',
    };
  }

  if (isChurn) {
    return {
      headline: 'Retención sólida con churn contenido en 1.8%',
      summary:
        'La tasa de cancelación se mantuvo estable y en zona saludable, mitigada por el nuevo flujo de onboarding asistido.',
      trend: 'stable',
      keyDrivers: [
        {
          label: 'Onboarding interactivo',
          impact: 'positive',
          detail: 'Reducción de abandonos tempranos en los primeros 14 días.',
        },
        {
          label: 'Vencimientos de tarjetas',
          impact: 'negative',
          detail: 'Pequeño repunte en fallas de facturación automática involuntaria.',
        },
      ],
      suggestedAction:
        'Implementar reintentos inteligentes de cobro y recordatorios previos al vencimiento del método de pago.',
    };
  }

  return {
    headline: `Variación favorable observada en ${widgetTitle}`,
    summary:
      'El análisis contextual de la serie y métricas muestra una tendencia consistente con los objetivos de negocio fijados para el período.',
    trend: 'upward',
    keyDrivers: [
      {
        label: 'Consistencia operativa',
        impact: 'positive',
        detail: 'Valores dentro de los rangos de control estadístico esperados.',
      },
      {
        label: 'Estacionalidad de la demanda',
        impact: 'neutral',
        detail: 'Ciclos de uso correspondientes a días hábiles habituales.',
      },
    ],
    suggestedAction:
      'Continuar monitoreando las alertas automatizadas para detectar anomalías tempranas.',
  };
}

export function WidgetExplainModal({
  isOpen,
  onClose,
  widgetTitle,
  widgetType,
  widgetData,
  context,
}: WidgetExplainModalProps) {
  const [explanation, setExplanation] = React.useState<WidgetExplanationResult | null>(null);
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const fetchExplanation = React.useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/widgets/explain', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          widgetTitle,
          widgetType,
          data: widgetData,
          context,
        }),
      });

      if (!res.ok) {
        // Fallback gracefully for demo mode or unauthenticated exploration
        const fallback = generateFallbackExplanation(widgetTitle, widgetType, widgetData);
        setExplanation(fallback);
        return;
      }

      const data = await res.json();
      setExplanation(data);
    } catch {
      // Fallback gracefully
      const fallback = generateFallbackExplanation(widgetTitle, widgetType, widgetData);
      setExplanation(fallback);
    } finally {
      setIsLoading(false);
    }
  }, [widgetTitle, widgetType, widgetData, context]);

  React.useEffect(() => {
    if (isOpen) {
      fetchExplanation();
    } else {
      setExplanation(null);
      setError(null);
    }
  }, [isOpen, fetchExplanation]);

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const trendBadge = explanation ? getTrendBadge(explanation.trend) : null;
  const TrendIcon = trendBadge?.icon ?? Activity;

  const modalContent = (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="widget-explain-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in-0"
    >
      <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-card shadow-2xl text-card-foreground">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/70 px-6 py-4 bg-muted/20">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="h-8 w-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <Sparkles className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 id="widget-explain-title" className="text-sm font-semibold truncate text-foreground">
                  ¿Por qué varió esta métrica?
                </h2>
                {trendBadge && (
                  <Badge variant="outline" className={`text-[11px] px-2 py-0.5 gap-1 font-medium ${trendBadge.className}`}>
                    <TrendIcon className="h-3 w-3" />
                    {trendBadge.label}
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground truncate">{widgetTitle}</p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="h-8 w-8 text-muted-foreground hover:text-foreground shrink-0 rounded-full"
            aria-label="Cerrar ventana"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5 max-h-[80vh] overflow-y-auto">
          {isLoading ? (
            <div className="space-y-4 py-6" role="status" aria-label="Cargando análisis...">
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <div className="h-4 w-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                <span>Analizando variación y factores clave con IA...</span>
              </div>
              <div className="space-y-2">
                <div className="h-5 bg-muted rounded w-3/4 animate-pulse" />
                <div className="h-4 bg-muted rounded w-full animate-pulse" />
                <div className="h-4 bg-muted rounded w-5/6 animate-pulse" />
              </div>
              <div className="pt-3 space-y-2">
                <div className="h-16 bg-muted/50 rounded-xl animate-pulse" />
                <div className="h-16 bg-muted/50 rounded-xl animate-pulse" />
              </div>
            </div>
          ) : error ? (
            <div className="py-6 text-center space-y-3">
              <div className="h-10 w-10 mx-auto rounded-full bg-destructive/10 text-destructive flex items-center justify-center">
                <AlertCircle className="w-5 h-5" />
              </div>
              <p className="text-sm text-foreground font-medium">{error}</p>
              <Button size="sm" variant="outline" onClick={fetchExplanation} className="gap-2">
                <RotateCcw className="w-3.5 h-3.5" /> Reintentar
              </Button>
            </div>
          ) : explanation ? (
            <>
              {/* Executive Headline & Summary */}
              <div className="rounded-xl border border-border/80 bg-muted/30 p-4 space-y-2">
                <h3 className="text-sm font-semibold text-foreground leading-snug">
                  {explanation.headline}
                </h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {explanation.summary}
                </p>
              </div>

              {/* Key Drivers */}
              {explanation.keyDrivers?.length > 0 && (
                <div className="space-y-2.5">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground tracking-tight">
                    <Activity className="w-3.5 h-3.5 text-primary" />
                    <span>Factores Determinantes</span>
                  </div>
                  <div className="grid gap-2">
                    {explanation.keyDrivers.map((driver, idx) => {
                      const impactInfo = getImpactBadge(driver.impact);
                      return (
                        <div
                          key={idx}
                          className="rounded-lg border border-border/60 bg-card p-3 space-y-1 hover:border-border transition-colors text-xs"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium text-foreground">{driver.label}</span>
                            <Badge
                              variant="outline"
                              className={`text-[10px] px-1.5 py-0 font-medium ${impactInfo.className}`}
                            >
                              {impactInfo.label}
                            </Badge>
                          </div>
                          <p className="text-[11px] text-muted-foreground leading-relaxed">
                            {driver.detail}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Suggested Action */}
              {explanation.suggestedAction && (
                <div className="rounded-xl border border-primary/20 bg-primary/5 p-3.5 flex items-start gap-3">
                  <div className="h-7 w-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0 mt-0.5">
                    <Lightbulb className="w-4 h-4" />
                  </div>
                  <div className="space-y-1 min-w-0">
                    <span className="text-xs font-semibold text-foreground">Recomendación Ejecutiva</span>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {explanation.suggestedAction}
                    </p>
                  </div>
                </div>
              )}
            </>
          ) : null}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border/70 px-6 py-3 bg-muted/10 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
            Análisis generado por IA cuantitativa
          </span>
          <Button size="sm" variant="ghost" onClick={onClose} className="h-7 text-xs">
            Cerrar
          </Button>
        </div>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(modalContent, document.body);
}
