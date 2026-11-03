import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * The quota has to be checked before EVERY model call, not once per
 * request.
 *
 * An NLQA question makes TWO model calls (generate the SQL, then answer
 * it). With the check at the route level, the second call happened with
 * no check at all: a budget exhausted by the first call still got a
 * second one.
 *
 * The gateway is the funnel every model call goes through, so that is
 * where the check belongs: a new AI route cannot forget it.
 */
const mockGenerateObject = vi.fn();
vi.mock('ai', () => ({
  generateObject: (...args: unknown[]) => mockGenerateObject(...args),
}));

vi.mock('@/lib/ai/router', () => ({
  getLanguageModel: () => 'mock-model',
}));

vi.mock('@/lib/widgets/selector', () => ({
  selectArchetype: () => ({ archetype: 'kpi-grid' }),
}));

vi.mock('@/lib/widgets/archetypes', () => ({
  ARCHETYPES: {
    'kpi-grid': {
      name: 'Vista general',
      description: 'test',
      tagline: 'test',
      atomicPatterns: ['kpis'],
      slots: [
        {
          id: 'kpi-1',
          minCount: 1,
          maxCount: 4,
          colSpan: 3,
          rowSpan: 2,
          recommendedTheme: 'auto',
          recommendedDensity: 'comfortable',
          recommendedAccent: 'default',
          recommendedTimeWindow: 'last_30d',
          recommendedComparativo: 'previous_period',
        },
      ],
    },
  },
}));

vi.mock('@/lib/widgets/validator', () => ({
  validateDashboardWithArchetype: () => ({ zodValid: true, archetypeValid: true }),
}));

import { AiGateway } from '@/lib/ai/gateway';

describe('AiGateway — guard de cuota', () => {
  beforeEach(() => {
    mockGenerateObject.mockReset();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('chequea la cuota antes de la llamada al modelo', async () => {
    const guard = vi.fn().mockResolvedValue(undefined);
    mockGenerateObject.mockResolvedValueOnce({
      object: { reasoning: 'r', sql: 'SELECT 1', params: [] },
      usage: { promptTokens: 10, completionTokens: 5 },
    });

    const gateway = new AiGateway('openai', 'gpt-4o', undefined, guard);
    await gateway.generateNLQASql({
      question: '¿cuánto facturas?',
      schemaInfo: '{}',
      dataSourceType: 'postgres',
      history: [],
    });

    expect(guard).toHaveBeenCalledTimes(1);
  });

  it('chequea la cuota en CADA llamada al modelo (NLQA hace dos)', async () => {
    const guard = vi.fn().mockResolvedValue(undefined);
    mockGenerateObject.mockResolvedValueOnce({
      object: { reasoning: 'r', sql: 'SELECT 1', params: [] },
      usage: { promptTokens: 10, completionTokens: 5 },
    });
    mockGenerateObject.mockResolvedValueOnce({
      object: { answer: 'a', reasoning: 'r' },
      usage: { promptTokens: 10, completionTokens: 5 },
    });

    const gateway = new AiGateway('openai', 'gpt-4o', undefined, guard);
    await gateway.generateNLQASql({
      question: '¿cuánto facturas?',
      schemaInfo: '{}',
      dataSourceType: 'postgres',
      history: [],
    });
    await gateway.generateNLQAAnswer({
      question: '¿cuánto facturas?',
      sql: 'SELECT 1',
      result: { rows: [], rowCount: 0 },
      history: [],
    });

    expect(guard).toHaveBeenCalledTimes(2);
  });

  it('no llama al modelo cuando el guard rechaza', async () => {
    const guard = vi.fn().mockRejectedValue(new Error('Monthly LLM budget exceeded'));
    mockGenerateObject.mockResolvedValueOnce({
      object: { reasoning: 'r', sql: 'SELECT 1', params: [] },
      usage: { promptTokens: 10, completionTokens: 5 },
    });

    const gateway = new AiGateway('openai', 'gpt-4o', undefined, guard);

    await expect(
      gateway.generateNLQASql({
        question: '¿cuánto facturas?',
        schemaInfo: '{}',
        dataSourceType: 'postgres',
        history: [],
      }),
    ).rejects.toThrow('budget exceeded');

    expect(mockGenerateObject).not.toHaveBeenCalled();
  });

  it('no chequea nada cuando no hay guard configurado', async () => {
    mockGenerateObject.mockResolvedValueOnce({
      object: { reasoning: 'r', sql: 'SELECT 1', params: [] },
      usage: { promptTokens: 10, completionTokens: 5 },
    });

    const gateway = new AiGateway('openai', 'gpt-4o');
    await gateway.generateNLQASql({
      question: '¿cuánto facturas?',
      schemaInfo: '{}',
      dataSourceType: 'postgres',
      history: [],
    });

    expect(mockGenerateObject).toHaveBeenCalledTimes(1);
  });
});
