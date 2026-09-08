import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockGenerateObject = vi.fn();
vi.mock('ai', () => ({
  generateObject: (...args: unknown[]) => mockGenerateObject(...args),
}));

vi.mock('@/lib/ai/router', () => ({
  getLanguageModel: () => 'mock-model',
}));

import { AiGateway, widgetExplanationSchema } from '@/lib/ai/gateway';

describe('AiGateway — explainWidgetData', () => {
  beforeEach(() => {
    mockGenerateObject.mockReset();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('validates explanation schema with valid mock object', () => {
    const validExplanation = {
      headline: 'Aumento del 12.4% en MRR impulsado por clientes Enterprise',
      summary: 'Los ingresos recurrentes mensuales alcanzaron $128,400 con una expansión fuerte en planes anuales corporativos.',
      trend: 'upward' as const,
      keyDrivers: [
        {
          label: 'Planes Enterprise',
          impact: 'positive' as const,
          detail: '4 nuevas contrataciones de nivel corporativo en la última quincena.',
        },
        {
          label: 'Tasa de Cancelación',
          impact: 'neutral' as const,
          detail: 'El churn se mantuvo estable en 1.8%, sin impacto adverso.',
        },
      ],
      suggestedAction: 'Priorizar el canal comercial outbound para cerrar negociaciones enterprise abiertas.',
    };

    const parsed = widgetExplanationSchema.safeParse(validExplanation);
    expect(parsed.success).toBe(true);
  });

  it('successfully generates structured explanation from widget data', async () => {
    const mockExplanation = {
      headline: 'Aumento del 12.4% en MRR',
      summary: 'El MRR creció impulsado por nuevas suscripciones.',
      trend: 'upward',
      keyDrivers: [
        {
          label: 'Nuevas suscripciones',
          impact: 'positive',
          detail: 'Aumento del 15% en clientes de nivel Pro.',
        },
      ],
      suggestedAction: 'Mantener la campaña de captación activa.',
    };

    mockGenerateObject.mockResolvedValueOnce({
      object: mockExplanation,
      usage: { inputTokens: 150, outputTokens: 90 },
    });

    const gateway = new AiGateway('openai', 'gpt-4o');
    const result = await gateway.explainWidgetData({
      widgetTitle: 'Ingresos Netos (MRR)',
      widgetType: 'kpi',
      data: { value: 128400, delta: 12.4 },
      context: {
        dashboardTitle: 'Mesa de Decisión Ejecutiva',
        timeWindow: 'last_30d',
        comparativo: 'previous_period',
      },
    });

    expect(result.headline).toBe('Aumento del 12.4% en MRR');
    expect(result.summary).toContain('MRR creció');
    expect(result.trend).toBe('upward');
    expect(result.keyDrivers).toHaveLength(1);
    expect(result.keyDrivers[0]?.impact).toBe('positive');
    expect(result.suggestedAction).toBe('Mantener la campaña de captación activa.');
    expect(result.usage).toEqual({ promptTokens: 150, completionTokens: 90 });

    expect(mockGenerateObject).toHaveBeenCalledOnce();
    const callArgs = (mockGenerateObject.mock.calls[0] as unknown[])[0] as { prompt: string };
    expect(callArgs.prompt).toContain('Ingresos Netos (MRR)');
    expect(callArgs.prompt).toContain('last_30d');
    expect(callArgs.prompt).toContain('previous_period');
  });

  it('handles empty or minimal data without error', async () => {
    const mockExplanation = {
      headline: 'Sin actividad registrada en el período',
      summary: 'No se encontraron registros suficientes para evaluar tendencias.',
      trend: 'stable',
      keyDrivers: [
        {
          label: 'Volumen de datos',
          impact: 'neutral',
          detail: '0 registros en el rango seleccionado.',
        },
      ],
      suggestedAction: 'Verificar la conexión de la fuente de datos o ampliar el rango temporal.',
    };

    mockGenerateObject.mockResolvedValueOnce({
      object: mockExplanation,
      usage: { inputTokens: 80, outputTokens: 50 },
    });

    const gateway = new AiGateway('openai', 'gpt-4o');
    const result = await gateway.explainWidgetData({
      widgetTitle: 'Tasa de Churn',
      widgetType: 'kpi',
      data: null,
    });

    expect(result.headline).toBe('Sin actividad registrada en el período');
    expect(result.trend).toBe('stable');
    expect(result.suggestedAction).toContain('fuente de datos');
  });
});
