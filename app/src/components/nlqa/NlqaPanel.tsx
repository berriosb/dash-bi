'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sparkles, X, Loader2, MessageSquare, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';

import { useDashboardStore } from '@/stores/dashboardStore';
import type { Widget, WidgetType } from '@/lib/widgets/types';

export interface NlqaMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  generatedSql?: string | null;
  generatedChartType?: string | null;
  rowCount?: number | null;
  executionMs?: number | null;
  chartSuggestion?: {
    type: 'kpi' | 'line-chart' | 'bar-chart' | 'pie-chart' | 'area-chart' | 'scatter' | 'table';
    rationale: string;
    config?: Record<string, unknown>;
  } | null;
}

interface NlqaPanelProps {
  dashboardId: string;
  dataSourceId?: string;
  open: boolean;
  onClose: () => void;
  onSaveAsWidget?: (widget: Widget) => void;
}

const CHART_TYPE_LABEL: Record<string, string> = {
  kpi: 'KPI',
  'line-chart': 'Gráfico de líneas',
  'bar-chart': 'Gráfico de barras',
  'pie-chart': 'Gráfico circular',
  'area-chart': 'Gráfico de área',
  scatter: 'Dispersión',
  table: 'Tabla',
};

const QUICK_SUGGESTIONS = [
  '¿Cuáles son los 5 productos más vendidos?',
  '¿Cuál fue el total de ingresos del último mes?',
  '¿Cómo se distribuyen las ventas por categoría?',
  '¿Cuál es la tasa de conversión promedio?',
];

export function NlqaPanel({
  dashboardId: _dashboardId,
  dataSourceId,
  open,
  onClose,
  onSaveAsWidget,
}: NlqaPanelProps) {
  const [messages, setMessages] = React.useState<NlqaMessage[]>([]);
  const [input, setInput] = React.useState('');
  const [conversationId, setConversationId] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const messagesEndRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (open) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      inputRef.current?.focus();
    }
  }, [messages, open]);

  const handleAsk = async (questionText: string) => {
    if (!questionText.trim() || isLoading || !dataSourceId) return;

    const question = questionText.trim();
    setInput('');
    setError(null);
    const userMessage: NlqaMessage = {
      id: `tmp-${Date.now()}`,
      role: 'user',
      content: question,
    };
    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);

    try {
      const res = await fetch('/api/nlqa/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: conversationId ?? undefined,
          dataSourceId,
          question,
        }),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        const message = errBody?.error ?? `HTTP ${res.status}`;
        if (res.status === 429) {
          setError('Demasiadas preguntas. Esperá unos segundos.');
        } else {
          setError(message);
        }
        setMessages((prev) => prev.filter((m) => m.id !== userMessage.id));
        return;
      }

      const data = await res.json();
      setConversationId(data.conversationId);
      const assistantMessage: NlqaMessage = {
        id: data.message.id,
        role: 'assistant',
        content: data.message.content,
        generatedSql: data.message.generatedSql,
        generatedChartType: data.message.generatedChartType,
        rowCount: data.message.rowCount,
        executionMs: data.message.executionMs,
        chartSuggestion: data.message.chartSuggestion,
      };
      setMessages((prev) => [...prev, assistantMessage]);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Error de red';
      setError(message);
      setMessages((prev) => prev.filter((m) => m.id !== userMessage.id));
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void handleAsk(input);
  };

  const handleNewConversation = () => {
    setMessages([]);
    setConversationId(null);
    setError(null);
  };

  if (!open) return null;

  return (
    <aside
      className="nlqa-panel"
      aria-label="Chat con tus datos"
    >
      <header className="nlqa-panel__header">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-violet-400" />
          <div>
            <p className="nlqa-panel__eyebrow">Preguntale a tus datos</p>
            <p className="nlqa-panel__hint">Respuesta + chart sugerido</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {conversationId && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleNewConversation}
              className="text-xs"
              aria-label="Nueva conversación"
            >
              Nueva
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Cerrar chat"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      </header>

      <div className="nlqa-panel__messages">
        {messages.length === 0 && (
          <div className="nlqa-panel__empty">
            <Sparkles className="w-6 h-6 text-violet-400 mb-2" />
            <p className="text-sm font-medium">Hacé tu primera pregunta</p>
            <p className="text-xs text-muted-foreground mt-1 mb-4">
              Preguntá en lenguaje natural sobre tus métricas o elegí una sugerencia:
            </p>
            <div className="flex flex-col gap-1.5 w-full text-left">
              {QUICK_SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => void handleAsk(suggestion)}
                  disabled={!dataSourceId || isLoading}
                  className="text-xs p-2 rounded border border-border/60 bg-surface/50 hover:bg-surface text-left text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                >
                  💬 {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((message) => (
          <NlqaBubble
            key={message.id}
            message={message}
            dataSourceId={dataSourceId}
            onSaveAsWidget={onSaveAsWidget}
          />
        ))}

        {isLoading && (
          <div className="nlqa-bubble nlqa-bubble--assistant">
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
            <span className="text-sm text-muted-foreground">Pensando…</span>
          </div>
        )}

        {error && (
          <div className="nlqa-panel__error" role="alert">
            {error}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <form className="nlqa-panel__form" onSubmit={handleSubmit}>
        <Input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={dataSourceId ? 'Preguntale a tus datos…' : 'Selecciona un data source primero'}
          disabled={isLoading || !dataSourceId}
          maxLength={500}
        />
        <Button type="submit" disabled={isLoading || !input.trim() || !dataSourceId}>
          Preguntar
        </Button>
      </form>
    </aside>
  );
}

function NlqaBubble({
  message,
  dataSourceId,
  onSaveAsWidget,
}: {
  message: NlqaMessage;
  dataSourceId?: string;
  onSaveAsWidget?: (widget: Widget) => void;
}) {
  const isUser = message.role === 'user';
  const [saved, setSaved] = React.useState(false);

  const handleSaveWidget = () => {
    if (!message.chartSuggestion || !dataSourceId) return;

    const widgetType = message.chartSuggestion.type as WidgetType;
    const storeWidgets = useDashboardStore.getState().widgets;
    const maxRow = storeWidgets.reduce(
      (max, w) => Math.max(max, (w.position?.row ?? 1) + (w.position?.rowSpan ?? 1)),
      0,
    );

    const newWidget: Widget = {
      id: `widget-nlqa-${Date.now()}`,
      type: widgetType,
      position: {
        col: 1,
        row: Math.max(1, maxRow),
        colSpan: widgetType === 'kpi' ? 4 : 6,
        rowSpan: widgetType === 'kpi' ? 1 : 2,
      },
      config: {
        title: message.content.slice(0, 40) || 'Gráfico NLQA',
        ...(message.chartSuggestion.config ?? {}),
      },
      data: null,
      source: {
        kind: 'query',
        dataSourceId,
        query: {
          kind: 'sql',
          sql: message.generatedSql || 'SELECT 1',
        },
      },
    } as Widget;

    if (onSaveAsWidget) {
      onSaveAsWidget(newWidget);
    } else {
      useDashboardStore.getState().addWidget(newWidget);
    }
    setSaved(true);
  };

  return (
    <div className={cn('nlqa-bubble', isUser ? 'nlqa-bubble--user' : 'nlqa-bubble--assistant')}>
      <p className="text-sm whitespace-pre-wrap">{message.content}</p>

      {!isUser && message.generatedSql && (
        <details className="nlqa-bubble__details">
          <summary className="nlqa-bubble__summary">
            <ChevronDown className="w-3 h-3" /> SQL generada
          </summary>
          <pre className="nlqa-bubble__sql">{message.generatedSql}</pre>
        </details>
      )}

      {!isUser && message.chartSuggestion && (
        <div className="nlqa-bubble__chart">
          <span className="text-xs font-medium">
            📊 {CHART_TYPE_LABEL[message.chartSuggestion.type] ?? message.chartSuggestion.type}
          </span>
          <p className="text-xs text-muted-foreground">{message.chartSuggestion.rationale}</p>
          <Button
            variant={saved ? 'default' : 'outline'}
            size="sm"
            disabled={saved || !dataSourceId}
            onClick={handleSaveWidget}
            className="mt-2 text-xs"
          >
            {saved ? '✓ Guardado como widget' : 'Guardar como widget →'}
          </Button>
        </div>
      )}

      {!isUser && (message.rowCount !== null || message.executionMs !== null) && (
        <p className="nlqa-bubble__meta">
          {message.rowCount ?? 0} filas · {message.executionMs ?? 0}ms
        </p>
      )}
    </div>
  );
}