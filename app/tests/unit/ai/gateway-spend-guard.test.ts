import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * The quota has to be RESERVED before EVERY model call, not once per
 * request.
 *
 * An NLQA question makes TWO model calls (generate the SQL, then answer
 * it). With the check at the route level, the second call happened with
 * no check at all: a budget exhausted by the first call still got a
 * second one.
 *
 * The gateway is the funnel every model call goes through, so that is
 * where the check belongs: a new AI route cannot forget it.
 *
 * And it is a RESERVATION, not a check: the spend used to be recorded
 * after the call, so N calls that started together all read the same
 * spend, all passed, and all spent. The reservation is what the next
 * caller sees, and the gateway settles it with the real cost.
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
      usage: { inputTokens: 10, outputTokens: 5 },
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
      usage: { inputTokens: 10, outputTokens: 5 },
    });
    mockGenerateObject.mockResolvedValueOnce({
      object: { answer: 'a', reasoning: 'r' },
      usage: { inputTokens: 10, outputTokens: 5 },
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
      usage: { inputTokens: 10, outputTokens: 5 },
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
      usage: { inputTokens: 10, outputTokens: 5 },
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

  it('libera la reserva con el gasto real cuando la llamada termina bien', async () => {
    const settle = vi.fn().mockResolvedValue(undefined);
    const guard = vi.fn().mockResolvedValue({ id: 'res-1', settle });
    mockGenerateObject.mockResolvedValueOnce({
      object: { reasoning: 'r', sql: 'SELECT 1', params: [] },
      usage: { inputTokens: 10, outputTokens: 5 },
    });

    const gateway = new AiGateway('openai', 'gpt-4o', undefined, guard);
    await gateway.generateNLQASql({
      question: '¿cuánto facturas?',
      schemaInfo: '{}',
      dataSourceType: 'postgres',
      history: [],
    });

    // La reserva se cierra con lo que la llamada costó de verdad: sin
    // esto, la estimación quedaría contra el presupuesto hasta el TTL.
    expect(settle).toHaveBeenCalledTimes(1);
    expect(settle).toHaveBeenCalledWith(
      { promptTokens: 10, completionTokens: 5 },
      expect.objectContaining({ success: true }),
    );
  });

  it('libera la reserva también cuando la llamada falla', async () => {
    const settle = vi.fn().mockResolvedValue(undefined);
    const guard = vi.fn().mockResolvedValue({ id: 'res-1', settle });
    mockGenerateObject.mockRejectedValueOnce(new Error('provider exploded'));

    const gateway = new AiGateway('openai', 'gpt-4o', undefined, guard);

    await expect(
      gateway.generateNLQASql({
        question: '¿cuánto facturas?',
        schemaInfo: '{}',
        dataSourceType: 'postgres',
        history: [],
      }),
    ).rejects.toThrow('provider exploded');

    expect(settle).toHaveBeenCalledTimes(1);
    expect(settle).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ success: false, error: 'provider exploded' }),
    );
  });

  it('cada llamada del gateway toma su propia reserva', async () => {
    const settle = vi.fn().mockResolvedValue(undefined);
    const guard = vi.fn().mockImplementation(async () => ({ id: 'res-1', settle }));
    mockGenerateObject.mockResolvedValueOnce({
      object: { reasoning: 'r', sql: 'SELECT 1', params: [] },
      usage: { inputTokens: 10, outputTokens: 5 },
    });
    mockGenerateObject.mockResolvedValueOnce({
      object: { answer: 'a', reasoning: 'r' },
      usage: { inputTokens: 10, outputTokens: 5 },
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
    expect(settle).toHaveBeenCalledTimes(2);
  });
});
