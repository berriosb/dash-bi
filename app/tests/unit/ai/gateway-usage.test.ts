import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * El gateway debe exponer el consumo de tokens de CADA llamada al modelo.
 *
 * Antes, solo `explainWidgetData` devolvía `usage`; las otras cuatro
 * rutas lo descartaban, así que el gasto real nunca llegaba a
 * `llm_usage` y ningún presupuesto podía aplicarse. Estos tests fijan
 * que la información viaja, que es lo que hace posible contabilizar.
 */
const generateObjectMock = vi.fn();

vi.mock('ai', () => ({
  generateObject: (...args: unknown[]) => generateObjectMock(...args),
  generateText: vi.fn(),
}));

import { AiGateway } from '@/lib/ai/gateway';

const USAGE = { inputTokens: 1234, outputTokens: 567, totalTokens: 1801 };

describe('AiGateway token accounting', () => {
  beforeEach(() => {
    generateObjectMock.mockReset();
  });

  it('surfaces usage from the NLQA SQL step', async () => {
    generateObjectMock.mockResolvedValue({
      object: { reasoning: 'porque sí', sql: 'SELECT 1', params: [] },
      usage: USAGE,
    });

    const gateway = new AiGateway('openai', 'gpt-4o');
    const result = await gateway.generateNLQASql({
      question: '¿cuánto revenue?',
      schemaInfo: 'tabla revenue',
      dataSourceType: 'postgres',
    });

    expect(result.usage).toEqual({ promptTokens: 1234, completionTokens: 567 });
  });

  it('surfaces usage from the NLQA answer step', async () => {
    generateObjectMock.mockResolvedValue({
      object: { answer: 'ok', chart: null, language: null },
      usage: USAGE,
    });

    const gateway = new AiGateway('openai', 'gpt-4o');
    const result = await gateway.generateNLQAAnswer({
      question: '¿cuánto revenue?',
      sql: 'SELECT 1',
      result: { rows: [{ a: 1 }], rowCount: 1 },
    });

    expect(result.usage).toEqual({ promptTokens: 1234, completionTokens: 567 });
  });

  it('reports zero rather than undefined when the provider omits token counts', async () => {
    // Some providers/proxies return usage without inputTokens/outputTokens.
    // A NaN here would silently poison the cost column.
    generateObjectMock.mockResolvedValue({
      object: { reasoning: 'r', sql: 'SELECT 1', params: [] },
      usage: { totalTokens: 42 },
    });

    const gateway = new AiGateway('openai', 'gpt-4o');
    const result = await gateway.generateNLQASql({
      question: 'q',
      schemaInfo: 's',
      dataSourceType: 'postgres',
    });

    expect(result.usage).toEqual({ promptTokens: 0, completionTokens: 0 });
  });

  it('leaves usage undefined when the provider returns none at all', async () => {
    generateObjectMock.mockResolvedValue({
      object: { reasoning: 'r', sql: 'SELECT 1', params: [] },
      usage: undefined,
    });

    const gateway = new AiGateway('openai', 'gpt-4o');
    const result = await gateway.generateNLQASql({
      question: 'q',
      schemaInfo: 's',
      dataSourceType: 'postgres',
    });

    expect(result.usage).toBeUndefined();
  });
});
