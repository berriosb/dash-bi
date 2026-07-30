'use client';

import * as React from 'react';
import { useDashboardStore } from '@/stores/dashboardStore';
import { useUIStore } from '@/stores/uiStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import { ChevronLeft, Trash2, AlertTriangle } from 'lucide-react';
import type { Widget, WidgetType } from '@/lib/widgets/types';

const WIDGET_TYPE_LABEL: Record<WidgetType, string> = {
  kpi: 'KPI',
  'line-chart': 'Gráfico de líneas',
  'bar-chart': 'Gráfico de barras',
  'pie-chart': 'Gráfico circular',
  'area-chart': 'Gráfico de área',
  scatter: 'Dispersión',
  table: 'Tabla',
};

interface PropertyPanelProps {
  dashboardId: string;
}

export function PropertyPanel({ dashboardId: _dashboardId }: PropertyPanelProps) {
  const widgets = useDashboardStore((s) => s.widgets);
  const updateWidget = useDashboardStore((s) => s.updateWidget);
  const removeWidget = useDashboardStore((s) => s.removeWidget);
  const selectedWidgetId = useUIStore((s) => s.selectedWidgetId);
  const setSelectedWidgetId = useUIStore((s) => s.setSelectedWidgetId);
  const { toast } = useToast();

  const widget = React.useMemo(
    () => widgets.find((w) => w.id === selectedWidgetId) ?? null,
    [widgets, selectedWidgetId],
  );

  if (!widget) {
    return (
      <aside className="property-panel property-panel--empty">
        <div className="property-panel__empty">
          <h3 className="property-panel__title">Propiedades</h3>
          <p className="property-panel__hint">
            Selecciona un widget para editar sus propiedades.
          </p>
        </div>
      </aside>
    );
  }

  const handleTitleChange = (title: string) => {
    updateWidget(widget.id, { config: { ...widget.config, title } } as Partial<Widget>);
  };

  const handlePositionChange = (patch: Partial<typeof widget.position>) => {
    updateWidget(widget.id, { position: { ...widget.position, ...patch } });
  };

  const handleDelete = () => {
    const title = widget.config.title ?? widget.id;
    removeWidget(widget.id);
    setSelectedWidgetId(null);
    toast({
      title: 'Widget eliminado',
      description: `${title} se quitó del dashboard. Ctrl+Z para deshacer.`,
    });
  };

  return (
    <aside className="property-panel" aria-label="Propiedades del widget">
      <header className="property-panel__header">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setSelectedWidgetId(null)}
          className="property-panel__back"
          aria-label="Cerrar panel"
        >
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <div>
          <p className="property-panel__eyebrow">Propiedades del widget</p>
          <h3 className="property-panel__title">{WIDGET_TYPE_LABEL[widget.type]}</h3>
        </div>
      </header>

      <div className="property-panel__body">
        <section className="property-section">
          <Label htmlFor="widget-title">Título</Label>
          <Input
            id="widget-title"
            value={widget.config.title ?? ''}
            onChange={(e) => handleTitleChange(e.target.value)}
            placeholder="Título del widget"
          />
        </section>

        <Separator />

        <PositionSection widget={widget} onChange={handlePositionChange} />

        <Separator />

        <TypeSpecificFields widget={widget} onUpdate={(patch) => updateWidget(widget.id, patch)} />

        <Separator />

        <section className="property-section">
          <h4 className="property-section__title">Fuente de datos</h4>
          <p className="property-section__meta">
            <span className="property-section__meta-label">ID:</span>
            <code className="property-section__meta-value">{widget.source.dataSourceId}</code>
          </p>
          <p className="property-section__meta">
            <span className="property-section__meta-label">Tipo:</span>
            <code className="property-section__meta-value">{widget.source.query.kind}</code>
          </p>
          <p className="property-section__hint">
            La edición de query se hace en el data source (Sprint 3).
          </p>
        </section>
      </div>

      <footer className="property-panel__footer">
        <Button
          variant="destructive"
          size="sm"
          onClick={handleDelete}
          className="w-full gap-2"
        >
          <Trash2 className="w-4 h-4" />
          Eliminar widget
        </Button>
        <p className="property-panel__footer-hint">
          <AlertTriangle className="w-3 h-3" />
          Reversible con Ctrl+Z
        </p>
      </footer>
    </aside>
  );
}

function PositionSection({
  widget,
  onChange,
}: {
  widget: Widget;
  onChange: (patch: Partial<Widget['position']>) => void;
}) {
  return (
    <section className="property-section">
      <h4 className="property-section__title">Posición</h4>
      <div className="property-grid">
        <div>
          <Label htmlFor="widget-col">Columna</Label>
          <Input
            id="widget-col"
            type="number"
            min={1}
            max={12}
            value={widget.position.col}
            onChange={(e) => onChange({ col: Number(e.target.value) })}
          />
        </div>
        <div>
          <Label htmlFor="widget-row">Fila</Label>
          <Input
            id="widget-row"
            type="number"
            min={1}
            value={widget.position.row}
            onChange={(e) => onChange({ row: Number(e.target.value) })}
          />
        </div>
        <div>
          <Label htmlFor="widget-colspan">Ancho (col)</Label>
          <Input
            id="widget-colspan"
            type="number"
            min={1}
            max={12}
            value={widget.position.colSpan}
            onChange={(e) => onChange({ colSpan: Number(e.target.value) })}
          />
        </div>
        <div>
          <Label htmlFor="widget-rowspan">Alto (filas)</Label>
          <Input
            id="widget-rowspan"
            type="number"
            min={1}
            value={widget.position.rowSpan}
            onChange={(e) => onChange({ rowSpan: Number(e.target.value) })}
          />
        </div>
      </div>
    </section>
  );
}

function TypeSpecificFields({
  widget,
  onUpdate,
}: {
  widget: Widget;
  onUpdate: (patch: Partial<Widget>) => void;
}) {
  if (widget.type === 'kpi') {
    return (
      <section className="property-section">
        <h4 className="property-section__title">Formato</h4>
        <div className="property-grid">
          <div>
            <Label htmlFor="kpi-format">Formato</Label>
            <select
              id="kpi-format"
              className="property-select"
              value={widget.config.format ?? 'number'}
              onChange={(e) =>
                onUpdate({
                  config: { ...widget.config, format: e.target.value as 'currency' | 'number' | 'percent' },
                } as Partial<Widget>)
              }
            >
              <option value="number">Número</option>
              <option value="currency">Moneda</option>
              <option value="percent">Porcentaje</option>
            </select>
          </div>
          <div>
            <Label htmlFor="kpi-showDelta">Mostrar delta</Label>
            <label className="property-toggle">
              <input
                id="kpi-showDelta"
                type="checkbox"
                checked={widget.config.showDelta ?? false}
                onChange={(e) =>
                  onUpdate({
                    config: { ...widget.config, showDelta: e.target.checked },
                  } as Partial<Widget>)
                }
              />
              <span>{widget.config.showDelta ? 'Activado' : 'Desactivado'}</span>
            </label>
          </div>
        </div>
      </section>
    );
  }

  if (widget.type === 'table') {
    return (
      <section className="property-section">
        <h4 className="property-section__title">Tabla</h4>
        <p className="property-section__hint">
          Edición de columnas inline en Sprint 3. Configuración actual: {widget.config.columns.length} columna
          {widget.config.columns.length === 1 ? '' : 's'}.
        </p>
      </section>
    );
  }

  // Charts (line, bar, area, pie, scatter)
  return (
    <section className="property-section">
      <h4 className="property-section__title">Gráfico</h4>
      <div className="property-grid">
        <div>
          <Label htmlFor="chart-showLegend">Mostrar leyenda</Label>
          <label className="property-toggle">
            <input
              id="chart-showLegend"
              type="checkbox"
              checked={widget.config.showLegend ?? true}
              onChange={(e) =>
                onUpdate({
                  config: { ...widget.config, showLegend: e.target.checked },
                } as Partial<Widget>)
              }
            />
            <span>{widget.config.showLegend ? 'Activado' : 'Desactivado'}</span>
          </label>
        </div>
        <div>
          <Label htmlFor="chart-showGrid">Mostrar grilla</Label>
          <label className="property-toggle">
            <input
              id="chart-showGrid"
              type="checkbox"
              checked={widget.config.showGrid ?? true}
              onChange={(e) =>
                onUpdate({
                  config: { ...widget.config, showGrid: e.target.checked },
                } as Partial<Widget>)
              }
            />
            <span>{widget.config.showGrid ? 'Activado' : 'Desactivado'}</span>
          </label>
        </div>
      </div>
    </section>
  );
}