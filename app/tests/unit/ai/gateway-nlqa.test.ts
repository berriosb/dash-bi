import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as React from 'react';

// Mock the AI SDK before importing the gateway
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
          allowedTypes: ['kpi'],
          col: 1,
          row: 1,
        },
      ],
      recommendedTheme: 'auto',
      recommendedDensity: 'balanced',
      recommendedAccent: 'default',
      recommendedTimeWindow: 'last_30d',
      recommendedComparativo: 'previous_period',
    },
  },
}));

vi.mock('@/lib/widgets/validator', () => ({
  validateDashboardWithArchetype: () => ({ zodValid: true, archetypeValid: true }),
}));

import { AiGateway } from '@/lib/ai/gateway';

describe('AiGateway — NLQA methods', () => {
  beforeEach(() => {
    mockGenerateObject.mockReset();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('generateNLQASql', () => {
    it('returns parsed SQL on success', async () => {
      mockGenerateObject.mockResolvedValueOnce({
        object: {
          reasoning: 'Sumamos revenue de julio',
          sql: 'SELECT SUM(amount) FROM subs WHERE date BETWEEN $1 AND $2',
          params: ['2026-07-01', '2026-07-31'],
        },
        usage: { promptTokens: 100, completionTokens: 50 },
      });

      const gateway = new AiGateway('openai', 'gpt-4o');
      const result = await gateway.generateNLQASql({
        question: '¿Cuánto revenue hubo en julio?',
        schemaInfo: 'subscriptions(id, amount, date)',
        dataSourceType: 'postgres',
      });

      expect(result.sql).toContain('SELECT SUM');
      expect(result.reasoning).toBe('Sumamos revenue de julio');
      expect(mockGenerateObject).toHaveBeenCalledOnce();
    });

    it('returns null SQL with fallback when AI cannot answer', async () => {
      mockGenerateObject.mockResolvedValueOnce({
        object: {
          reasoning: 'No se puede responder con datos',
          sql: null,
          fallbackAnswer: 'Pregunta conceptual sin datos disponibles.',
        },
        usage: { promptTokens: 80, completionTokens: 40 },
      });

      const gateway = new AiGateway('openai', 'gpt-4o');
      const result = await gateway.generateNLQASql({
        question: '¿Cuál es el sentido de la vida?',
        schemaInfo: 'subscriptions(id, amount, date)',
        dataSourceType: 'postgres',
      });

      expect(result.sql).toBeNull();
      expect(result.fallbackAnswer).toContain('conceptual');
    });

    it('includes history in prompt when provided', async () => {
      mockGenerateObject.mockResolvedValueOnce({
        object: { reasoning: '', sql: 'SELECT COUNT(*) FROM t', params: [] },
        usage: { promptTokens: 0, completionTokens: 0 },
      });

      const gateway = new AiGateway('openai', 'gpt-4o');
      await gateway.generateNLQASql({
        question: 'Y de esos, ¿cuántos son del Q3?',
        schemaInfo: 't(x int)',
        dataSourceType: 'postgres',
        history: [
          { role: 'user', content: '¿Cuántos usuarios hay?' },
          { role: 'assistant', content: '1,234 usuarios', sql: 'SELECT COUNT(*) FROM users' },
        ],
      });

      const callArgs = mockGenerateObject.mock.calls[0]?.[0] as { prompt?: string };
      expect(callArgs.prompt).toContain('CONVERSATION HISTORY');
      expect(callArgs.prompt).toContain('SELECT COUNT(*) FROM users');
    });
  });

  describe('generateNLQAAnswer', () => {
    it('returns parsed answer + chart suggestion', async () => {
      mockGenerateObject.mockResolvedValueOnce({
        object: {
          answer: 'Hubo $45,230 USD en julio, +12% vs junio.',
          chartSuggestion: {
            type: 'kpi',
            rationale: 'Single value comparing two periods.',
            config: { format: 'currency' },
          },
        },
        usage: { promptTokens: 200, completionTokens: 80 },
      });

      const gateway = new AiGateway('openai', 'gpt-4o');
      const result = await gateway.generateNLQAAnswer({
        question: '¿Cuánto revenue hubo en julio?',
        sql: 'SELECT SUM(amount) FROM subs WHERE month = 7',
        result: { rows: [{ sum: 45230 }], rowCount: 1 },
      });

      expect(result.answer).toContain('45,230');
      expect(result.chartSuggestion?.type).toBe('kpi');
    });

    it('returns null chart suggestion when result is empty', async () => {
      mockGenerateObject.mockResolvedValueOnce({
        object: {
          answer: 'No hay datos.',
          chartSuggestion: null,
        },
        usage: { promptTokens: 100, completionTokens: 40 },
      });

      const gateway = new AiGateway('openai', 'gpt-4o');
      const result = await gateway.generateNLQAAnswer({
        question: 'Top 5 clientes',
        sql: 'SELECT * FROM customers LIMIT 5',
        result: { rows: [], rowCount: 0 },
      });

      expect(result.chartSuggestion).toBeNull();
    });
  });

  describe('generateNLQAEdit', () => {
    it('returns add action with new widget', async () => {
      mockGenerateObject.mockResolvedValueOnce({
        object: {
          action: 'add',
          reasoning: 'User wants a new KPI',
          widgets: [
            {
              id: 'w_new_kpi',
              type: 'kpi',
              position: { col: 1, row: 5, colSpan: 4, rowSpan: 2 },
              config: { title: 'New KPI' },
            },
          ],
        },
        usage: { promptTokens: 300, completionTokens: 120 },
      });

      const gateway = new AiGateway('openai', 'gpt-4o');
      const result = await gateway.generateNLQAEdit({
        prompt: 'Agregá un KPI de revenue total',
        existingDashboard: {
          title: 'Test',
          widgets: [],
        },
        schemaInfo: 't(x)',
        dataSourceType: 'postgres',
      });

      expect(result.action).toBe('add');
      expect(result.widgets).toHaveLength(1);
    });

    it('returns noop for unclear prompts', async () => {
      mockGenerateObject.mockResolvedValueOnce({
        object: {
          action: 'noop',
          reasoning: 'No está claro qué hacer',
        },
        usage: { promptTokens: 0, completionTokens: 0 },
      });

      const gateway = new AiGateway('openai', 'gpt-4o');
      const result = await gateway.generateNLQAEdit({
        prompt: 'hmm',
        existingDashboard: { title: 'Test', widgets: [] },
        schemaInfo: 't(x)',
        dataSourceType: 'postgres',
      });

      expect(result.action).toBe('noop');
      expect(result.widgets).toBeUndefined();
    });
  });
});