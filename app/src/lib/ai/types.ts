export type LLMProvider = 'openai' | 'anthropic' | 'gemini';

export type LLMModelConfig = {
  provider: LLMProvider;
  model: string;
  apiKeyEncrypted?: string;
  fallbackProvider?: LLMProvider;
  fallbackModel?: string;
};

export type GenerateDashboardInput = {
  prompt: string;
  dataSourceId: string;
  dataSourceType: 'postgres' | 'stripe' | 'sheets';
  schemaInfo: string;
  recentArchetypes?: string[];
};

export type MODEL_COST_RATES = Record<string, { promptPer1k: number; completionPer1k: number }>;

export const MODEL_COSTS: MODEL_COST_RATES = {
  'gpt-4o': { promptPer1k: 0.0025, completionPer1k: 0.01 },
  'gpt-4o-mini': { promptPer1k: 0.00015, completionPer1k: 0.0006 },
  'claude-3-5-sonnet-latest': { promptPer1k: 0.003, completionPer1k: 0.015 },
  'claude-3-5-haiku-latest': { promptPer1k: 0.0008, completionPer1k: 0.004 },
  'gemini-1.5-pro': { promptPer1k: 0.00125, completionPer1k: 0.005 },
  'gemini-1.5-flash': { promptPer1k: 0.000075, completionPer1k: 0.0003 },
};

/**
 * Token usage of a single model call.
 *
 * Every gateway method returns this so callers can record real spend in
 * `llm_usage`. Before it existed, only 1 of 3 AI routes recorded usage,
 * so the cost dashboard under-reported and no budget could be enforced.
 */
export interface LLMUsage {
  promptTokens: number;
  completionTokens: number;
}

/** Normalize the AI SDK's usage shape, or undefined when absent. */
export function toLLMUsage(usage: {
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
} | undefined): LLMUsage | undefined {
  if (!usage) return undefined;
  return {
    promptTokens: usage.inputTokens ?? 0,
    completionTokens: usage.outputTokens ?? 0,
  };
}

export function calculateCostUsd(model: string, promptTokens: number, completionTokens: number): string {
  const rates = MODEL_COSTS[model] ?? MODEL_COSTS['gpt-4o'] ?? { promptPer1k: 0.0025, completionPer1k: 0.01 };
  const cost = (promptTokens / 1000) * rates.promptPer1k + (completionTokens / 1000) * rates.completionPer1k;
  return cost.toFixed(6);
}
