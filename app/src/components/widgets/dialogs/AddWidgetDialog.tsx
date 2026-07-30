'use client';

import * as React from 'react';
import { useDashboardStore } from '@/stores/dashboardStore';
import { useUIStore } from '@/stores/uiStore';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Plus,
  BarChart3,
  LineChart,
  PieChart,
  AreaChart,
  ScatterChart as ScatterPlot,
  Table,
  Hash,
  Sparkles,
  X,
} from 'lucide-react';
import type { Widget, WidgetType } from '@/lib/widgets/types';

const WIDGET_TYPES: Array<{
  type: WidgetType;
  label: string;
  description: string;
  Icon: React.ComponentType<{ className?: string }>;
}> = [
  { type: 'kpi', label: 'KPI', description: 'Un número destacado con delta.', Icon: Hash },
  { type: 'line-chart', label: 'Línea', description: 'Tendencia en el tiempo.', Icon: LineChart },
  { type: 'bar-chart', label: 'Barras', description: 'Comparación entre categorías.', Icon: BarChart3 },
  { type: 'pie-chart', label: 'Circular', description: 'Proporciones de un total.', Icon: PieChart },
  { type: 'area-chart', label: 'Área', description: 'Tendencia acumulada.', Icon: AreaChart },
  { type: 'scatter', label: 'Dispersión', description: 'Relación entre dos variables.', Icon: ScatterPlot },
  { type: 'table', label: 'Tabla', description: 'Listado de filas.', Icon: Table },
];

interface AddWidgetDialogProps {
  dashboardId: string;
}

export function AddWidgetDialog({ dashboardId: _dashboardId }: AddWidgetDialogProps) {
  const [open, setOpen] = React.useState(false);
  const [step, setStep] = React.useState<'type' | 'form'>('type');
  const [selectedType, setSelectedType] = React.useState<WidgetType | null>(null);
  const [title, setTitle] = React.useState('');
  const [dataSourceId, setDataSourceId] = React.useState('');

  const addWidget = useDashboardStore((s) => s.addWidget);
  const widgets = useDashboardStore((s) => s.widgets);
  const setSelectedWidgetId = useUIStore((s) => s.setSelectedWidgetId);
  const { toast } = useToast();

  const close = () => {
    setOpen(false);
    setStep('type');
    setSelectedType(null);
    setTitle('');
    setDataSourceId('');
  };

  const handleSelectType = (type: WidgetType) => {
    setSelectedType(type);
    setStep('form');
  };

  const handleAdd = () => {
    if (!selectedType) return;
    const finalTitle = title.trim() || `${WIDGET_TYPES.find((w) => w.type === selectedType)?.label ?? 'Widget'} nuevo`;
    const finalSourceId = dataSourceId.trim() || 'ds_default';

    const id = `w_${selectedType}_${Date.now().toString(36)}`;
    const position = findNextEmptyPosition(widgets);

    const widget = buildWidget({
      type: selectedType,
      id,
      title: finalTitle,
      dataSourceId: finalSourceId,
      position,
    });

    addWidget(widget);
    setSelectedWidgetId(id);
    toast({
      title: 'Widget agregado',
      description: `${finalTitle} se agregó al dashboard.`,
    });
    close();
  };

  return (
    <>
      <Button
        variant="default"
        size="sm"
        onClick={() => setOpen(true)}
        className="gap-1.5"
      >
        <Plus className="w-4 h-4" />
        Agregar widget
      </Button>

      {open && (
        <div
          className="dialog-overlay"
          role="button"
          tabIndex={-1}
          aria-label="Cerrar diálogo"
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') close();
          }}
        >
          <div
            className="dialog-content"
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-widget-title"
          >
            <header className="dialog-header">
              <h2 id="add-widget-title" className="dialog-title">
                {step === 'type' ? 'Agregar widget' : `Configurar ${WIDGET_TYPES.find((w) => w.type === selectedType)?.label ?? ''}`}
              </h2>
              <Button
                variant="ghost"
                size="icon"
                onClick={close}
                aria-label="Cerrar"
                className="dialog-close"
              >
                <X className="w-4 h-4" />
              </Button>
            </header>

            {step === 'type' && (
              <>
                <ul className="widget-type-grid">
                  {WIDGET_TYPES.map(({ type, label, description, Icon }) => (
                    <li key={type}>
                      <button
                        type="button"
                        className="widget-type-card"
                        onClick={() => handleSelectType(type)}
                      >
                        <Icon className="w-5 h-5 text-indigo-400" />
                        <div>
                          <p className="widget-type-card__label">{label}</p>
                          <p className="widget-type-card__description">{description}</p>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
                <footer className="dialog-footer">
                  <p className="dialog-footer__hint">
                    <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                    ¿Querés que la IA arme el widget? Probá &quot;Regenerar con IA&quot; en el toolbar.
                  </p>
                </footer>
              </>
            )}

            {step === 'form' && selectedType && (
              <form
                className="widget-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  handleAdd();
                }}
              >
                <div>
                  <Label htmlFor="widget-new-title">Título</Label>
                  <Input
                    id="widget-new-title"
                    ref={(el) => {
                      if (el && step === 'form') {
                        setTimeout(() => el.focus(), 0);
                      }
                    }}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Ej.: Revenue del trimestre"
                  />
                </div>
                <div>
                  <Label htmlFor="widget-new-source">Data source ID</Label>
                  <Input
                    id="widget-new-source"
                    value={dataSourceId}
                    onChange={(e) => setDataSourceId(e.target.value)}
                    placeholder="ds_postgres_prod"
                  />
                  <p className="widget-form__hint">
                    El wizard de data sources está en Sprint 3. Por ahora podés pegar el ID directamente.
                  </p>
                </div>
                <footer className="dialog-footer dialog-footer--actions">
                  <Button type="button" variant="ghost" onClick={() => setStep('type')}>
                    Atrás
                  </Button>
                  <Button type="submit" variant="default">
                    Agregar
                  </Button>
                </footer>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function findNextEmptyPosition(widgets: Widget[]) {
  if (widgets.length === 0) {
    return { col: 1, row: 1, colSpan: 4, rowSpan: 2 };
  }
  const maxRow = widgets.reduce((max, w) => Math.max(max, w.position.row + w.position.rowSpan - 1), 0);
  return { col: 1, row: maxRow + 1, colSpan: 4, rowSpan: 2 };
}

interface BuildWidgetInput {
  type: WidgetType;
  id: string;
  title: string;
  dataSourceId: string;
  position: { col: number; row: number; colSpan: number; rowSpan: number };
}

function buildWidget(input: BuildWidgetInput): Widget {
  const { type, id, title, dataSourceId, position } = input;
  const source = {
    kind: 'query' as const,
    dataSourceId,
    query: { kind: 'sql' as const, sql: '' },
  };

  switch (type) {
    case 'kpi':
      return {
        id,
        type: 'kpi',
        position,
        config: { title, format: 'number', showDelta: true },
        data: { value: 0 },
        source,
      };
    case 'table':
      return {
        id,
        type: 'table',
        position,
        config: {
          title,
          columns: [
            { key: 'col1', label: 'Columna 1', format: 'text' as const },
          ],
          pagination: true,
          pageSize: 10,
          searchable: true,
        },
        data: [],
        source,
      };
    case 'pie-chart':
      return {
        id,
        type: 'pie-chart',
        position,
        config: { title, variant: 'donut' },
        data: [],
        source,
      };
    case 'line-chart':
    case 'bar-chart':
    case 'area-chart':
    case 'scatter':
      return {
        id,
        type,
        position,
        config: { title, showLegend: true, showGrid: true },
        data: [],
        source,
      };
  }
}