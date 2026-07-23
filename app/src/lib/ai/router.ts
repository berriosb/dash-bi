import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { decryptApiKey } from '@/lib/security/encryption';
import type { LLMProvider } from './types';

export function getLanguageModel(
  provider: LLMProvider,
  modelName: string,
  encryptedKey?: string | null,
) {
  const apiKey = encryptedKey ? decryptApiKey(encryptedKey) : undefined;

  switch (provider) {
    case 'openai': {
      const openai = createOpenAI({
        apiKey: apiKey || process.env.OPENAI_API_KEY,
      });
      return openai(modelName);
    }

    case 'anthropic': {
      const anthropic = createAnthropic({
        apiKey: apiKey || process.env.ANTHROPIC_API_KEY,
      });
      return anthropic(modelName);
    }

    case 'gemini': {
      const google = createGoogleGenerativeAI({
        apiKey: apiKey || process.env.GOOGLE_GENERATIVE_AI_API_KEY,
      });
      return google(modelName);
    }

    default:
      throw new Error(`Unsupported LLM provider: ${provider}`);
  }
}
