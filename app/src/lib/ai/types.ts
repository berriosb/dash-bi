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
