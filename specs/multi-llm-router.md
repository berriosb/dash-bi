# Spec: Multi-LLM Router

> Sistema que permite a cada organización elegir su proveedor de LLM (OpenAI, Anthropic, Gemini) desde la UI, sin redeploy. Diferenciador clave: dash-bi es el único BI OSS con multi-provider switch.

**Status:** Draft v0.3 (sync post-auditoría 2026-07-21)
**Prioridad:** P0 — feature diferenciador
**Responsable:** codehak
**Depende de:** ninguno

---

## Cambios respecto a v0.2 (sync 2026-07-21)

**Sync v0.3:**
- ✅ Defaults LLM corregidos a versiones que son GA al 2026-07-21: `gpt-4o`, `claude-3-5-sonnet-latest`, `gemini-1.5-pro`
- ❌ Removida sección de `Ollama` (provider no oficial, retrasa 2 semanas)
- ❌ Removida sección `minimax` (provider community, abandonarware risk)
- ❌ Removido wrapper custom para `minimax` (§3.4 de v0.2)
- ✅ `MODELS_BY_PROVIDER` simplificado: solo providers con SDK oficial
- ✅ `MODEL_COSTS` actualizado a precios reales por 1M tokens (USD)

**Decisiones aplicadas (v0.2 post-auditoría 2026-07-21):**
- ❌ Eliminado: `minimax` (provider community, riesgo de abandonware).
- ❌ Eliminado: `Ollama` local (retrasa deploy 2 semanas, complexity alta).
- ✅ Quedan **3 providers oficiales** con SDK estables: OpenAI, Anthropic, Gemini.
- Ollama y minimax quedan como **roadmap Fase 2+** (después de validar el producto).

## 1. Objetivo

Permitir que cada `organization` en dash-bi:

1. **Configure su proveedor LLM preferido** desde la UI de settings (sin tocar código)
2. **Switch entre 3 providers** sin redeploy de la app
3. **Traiga su propia API key** (BYOK) — las keys se guardan cifradas en DB
4. **Tenga fallbacks** automáticos si el provider principal falla (resiliencia)

## 2. Providers soportados (MVP = 3)

| Provider | Modelos default | Modelos rápidos (NLQA / low latency) | Caso de uso principal |
|----------|-----------------|--------------------------------------|-----------------------|
| **OpenAI** | `gpt-4o` | `gpt-4o-mini` | Default balanceado, generación completa |
| **Anthropic** | `claude-3-5-sonnet-latest` | `claude-3-5-haiku-latest` | Prompts estructurados largos y SQL complejo |
| **Google Gemini** | `gemini-1.5-pro` | `gemini-1.5-flash` / `gemini-2.0-flash` | Más económico, excelente para NLQA y streaming |

**Estrategia de ruteo por subsistema:**
- **Generación de Dashboards (`/api/dashboards/generate`)**: Utiliza el modelo configurado por la organización (`gpt-4o`, `claude-3-5-sonnet`, `gemini-1.5-pro`) para asegurar la máxima calidad en selección de archetype y queries SQL complejas.
- **Natural-Language Q&A (`/api/nlqa/ask`)**: Optimizado para latencia sub-5s utilizando tiers rápidos (`gpt-4o-mini`, `claude-3-5-haiku`, `gemini-1.5-flash`).

**Por qué estos 3 y no 5:**
- OpenAI: standard de la industria, default del usuario
- Anthropic: alternativa seria con JSON mode excelente
- Gemini: provider oficial de Google, más rápido y costo-eficiente
- ❌ Ollama: requiere GPU + binario + modelos 4-70GB, retrasa MVP 2 semanas (Fase 2)
- ❌ minimax: provider community sin garantía de mantenimiento (Fase 2 si aparece provider oficial)

**Roadmap Fase 2+:** Ollama (cuando validemos el producto), minimax (cuando haya provider oficial estable).

## 3. Arquitectura técnica

### 3.1 Router core

```typescript
// lib/llm/router.ts

import { openai } from '@ai-sdk/openai';
import { anthropic } from '@ai-sdk/anthropic';
import { google } from '@ai-sdk/google';

type Provider = 'openai' | 'anthropic' | 'gemini';

type OrgLLMConfig = {
  provider: Provider;
  model: string;          // ej: 'gpt-4o', 'claude-3-5-sonnet-latest'
  apiKey?: string;        // BYOK, cifrado
  fallbackProvider?: Provider;
  fallbackModel?: string;
  maxRetries?: number;
  timeoutMs?: number;
};

export async function getLLMForOrg(orgId: string) {
  const config = await getOrgLLMConfig(orgId);
  return buildLLM(config);
}

function buildLLM(config: OrgLLMConfig) {
  const modelMap = {
    openai: () => openai(config.model, { apiKey: config.apiKey }),
    anthropic: () => anthropic(config.model, { apiKey: config.apiKey }),
    gemini: () => google(config.model, { apiKey: config.apiKey }),
  };

  const builder = modelMap[config.provider];
  if (!builder) {
    throw new Error(`Provider no soportado: ${config.provider}. Providers MVP: openai, anthropic, gemini.`);
  }
  return builder();
}
```

> **Nota v0.3:** la rama `Provider` no incluye `minimax` ni `ollama`. Si la org tiene esa config heredada en DB, el `throw` arriba es el fail-loud correcto en vez de fallback silencioso.

### 3.2 Schema de DB

```typescript
// db/schema.ts

export const orgs = pgTable('orgs', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  
  // LLM config (multi-provider)
  llmProvider: text('llm_provider').notNull().default('openai'),
  llmModel: text('llm_model').notNull().default('gpt-4o'),
  llmApiKeyEncrypted: text('llm_api_key_encrypted'),  // BYOK, cifrado
  llmFallbackProvider: text('llm_fallback_provider'),
  llmFallbackModel: text('llm_fallback_model'),
  
  createdAt: timestamp('created_at').notNull().defaultNow(),
});
```

### 3.3 Cifrado de API keys

Las API keys se cifran antes de guardar en DB usando AES-256-GCM con una master key del environment.

```typescript
// lib/crypto.ts
import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const MASTER_KEY = Buffer.from(process.env.LLM_KEY_ENCRYPTION_KEY!, 'hex'); // 32 bytes

export function encryptApiKey(plaintext: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, MASTER_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

export function decryptApiKey(ciphertext: string): string {
  const buffer = Buffer.from(ciphertext, 'base64');
  const iv = buffer.subarray(0, 16);
  const authTag = buffer.subarray(16, 32);
  const encrypted = buffer.subarray(32);
  const decipher = crypto.createDecipheriv(ALGORITHM, MASTER_KEY, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(encrypted) + decipher.final('utf8');
}
```

**Master key management:**
- En dev: variable de entorno `.env.local`
- En prod: secret manager (Cloudflare Workers Secrets, Vercel Env, AWS Secrets Manager)
- Nunca commitear al repo
- Rotar cada 6-12 meses

### 3.4 (Eliminado en v0.3)

> Wrapper custom de `minimax` eliminado. Si en el futuro hay provider oficial estable (`@ai-sdk/minimax` mantenido por Vercel), se agrega siguiendo el mismo patrón que los otros 3 providers en §3.1.

## 4. UI: Settings de LLM

### 4.1 Página de configuración

```
┌────────────────────────────────────────────────┐
│ Settings → AI Configuration                    │
│                                                │
│ Current provider: ● Anthropic Claude 3.5      │
│                                                │
│ Provider:                                       │
│ ○ OpenAI                                       │
│ ● Anthropic                                    │
│ ○ Google Gemini                                │
│                                                │
│ Model: [claude-3-5-sonnet-latest ▼]            │
│                                                │
│ API Key: [sk-ant-...           ] [Test]        │
│ Status: ✓ Valid                                │
│                                                │
│ Fallback provider: [None          ▼]           │
│ Fallback model: [gpt-4o-mini      ▼]           │
│                                                │
│ ⓘ Your API key is encrypted at rest with        │
│   AES-256-GCM. We never see it.                 │
│                                                │
│ [Save changes]                                 │
└────────────────────────────────────────────────┘
```

### 4.2 Modelo dinámico por provider

```typescript
const MODELS_BY_PROVIDER: Record<Provider, Array<{ id: string; label: string }>> = {
  openai: [
    { id: 'gpt-4o', label: 'GPT-4o (mejor calidad)' },
    { id: 'gpt-4o-mini', label: 'GPT-4o Mini (más barato)' },
    { id: 'o1', label: 'o1 (razonamiento avanzado)' },
    { id: 'o1-mini', label: 'o1-mini (razonamiento económico)' },
  ],
  anthropic: [
    { id: 'claude-3-5-sonnet-latest', label: 'Claude 3.5 Sonnet (mejor calidad)' },
    { id: 'claude-3-5-haiku-latest', label: 'Claude 3.5 Haiku (rápido)' },
    { id: 'claude-3-opus-latest', label: 'Claude 3 Opus (máximo razonamiento)' },
  ],
  gemini: [
    { id: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
    { id: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash (rápido)' },
  ],
};
```

> **Nota v0.3:** Los IDs siguen la nomenclatura real del provider al 2026-07-21. Los precios en §7.3 usan IDs que ya están en producción. Si en el futuro cambia el catálogo, actualizar `MODELS_BY_PROVIDER` y `MODEL_COSTS` juntos.

### 4.3 Test de API key

```typescript
// app/api/orgs/[orgId]/llm/test/route.ts
export async function POST(req: Request) {
  const { provider, model, apiKey } = await req.json();
  
  try {
    const llm = buildLLM({ provider, model, apiKey });
    
    // Test mínimo: pedir un JSON trivial
    const result = await generateObject({
      model: llm,
      schema: z.object({ ok: z.boolean() }),
      prompt: 'Return { ok: true }',
    });
    
    return Response.json({ valid: true, latencyMs: ... });
  } catch (error) {
    return Response.json({ valid: false, error: error.message }, { status: 400 });
  }
}
```

## 5. Validación de capabilities por provider

No todos los providers soportan todo. Necesitamos capability flags:

```typescript
type ProviderCapabilities = {
  streaming: boolean;          // todos lo soportan
  jsonMode: boolean;           // generateObject con Zod schema
  toolCalling: boolean;        // para Fase 2+
  vision: boolean;             // para Fase 3+
  longContext: boolean;        // >100k tokens
  maxContextWindow: number;    // tokens
};

const CAPABILITIES: Record<Provider, ProviderCapabilities> = {
  openai: { streaming: true, jsonMode: true, toolCalling: true, vision: true, longContext: true, maxContextWindow: 128000 },
  anthropic: { streaming: true, jsonMode: true, toolCalling: true, vision: true, longContext: true, maxContextWindow: 200000 },
  gemini: { streaming: true, jsonMode: true, toolCalling: true, vision: true, longContext: true, maxContextWindow: 1000000 },
};
```

## 6. Fallback automático

Si el provider principal falla (timeout, rate limit, error), intentar con el fallback:

```typescript
// lib/llm/router.ts
export async function generateWithFallback<T>({
  orgId,
  prompt,
  schema,
  system,
}: GenerateOptions): Promise<{ object: T; usedProvider: string }> {
  const config = await getOrgLLMConfig(orgId);
  const providers: Array<{ provider: Provider; model: string }> = [
    { provider: config.provider, model: config.model },
  ];
  
  if (config.fallbackProvider) {
    providers.push({ provider: config.fallbackProvider, model: config.fallbackModel! });
  }
  
  let lastError: Error | null = null;
  
  for (const { provider, model } of providers) {
    try {
      const llm = buildLLM({ provider, model, apiKey: await getApiKey(orgId, provider) });
      const { object } = await generateObject({
        model: llm,
        schema,
        system,
        prompt,
      });
      return { object, usedProvider: `${provider}/${model}` };
    } catch (error) {
      lastError = error;
      console.warn(`Provider ${provider}/${model} failed:`, error.message);
      // continuar con el siguiente
    }
  }
  
  throw lastError || new Error('All providers failed');
}
```

## 7. Rate limits & costos

### 7.1 Rate limits por provider

Cada provider tiene sus propios límites. dash-bi no impone límites adicionales por provider, pero sí por org (ver §7.2).

| Provider | Límite típico |
|----------|---------------|
| OpenAI | según tier (free: 3 RPM, tier 1: 500 RPM) |
| Anthropic | según tier |
| Gemini | según tier, free tier generoso |

### 7.2 Rate limits por org (dash-bi)

```typescript
const ORG_RATE_LIMITS = {
  free: { generationsPerHour: 20, maxTokensPerDay: 100000 },
  pro: { generationsPerHour: 200, maxTokensPerDay: 5000000 },
  enterprise: { generationsPerHour: -1, maxTokensPerDay: -1 },
};
```

### 7.3 Tracking de costos

```typescript
// db/schema.ts
export const llmUsage = pgTable('llm_usage', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => orgs.id),
  userId: uuid('user_id'),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  promptTokens: integer('prompt_tokens').notNull(),
  completionTokens: integer('completion_tokens').notNull(),
  costUsd: numeric('cost_usd', { precision: 10, scale: 6 }),
  latencyMs: integer('latency_ms'),
  success: boolean('success').notNull(),
  error: text('error'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});
```

**Costos por modelo** (actualizados al 2026-07-21, USD por 1M tokens):

```typescript
const MODEL_COSTS: Record<string, { input: number; output: number }> = {
  // OpenAI
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'o1': { input: 15, output: 60 },
  'o1-mini': { input: 3, output: 12 },
  // Anthropic
  'claude-3-5-sonnet-latest': { input: 3, output: 15 },
  'claude-3-5-haiku-latest': { input: 0.8, output: 4 },
  'claude-3-opus-latest': { input: 15, output: 75 },
  // Google Gemini
  'gemini-1.5-pro': { input: 1.25, output: 5 },
  'gemini-1.5-flash': { input: 0.075, output: 0.3 },
};
```

> **Nota v0.3:** Todos los precios verificados contra las páginas públicas de pricing de los providers al 2026-07-21. Esta tabla se carga desde `MODEL_COSTS` env var para poder actualizarla sin deploy. Si un modelo deja de existir, el código debe fallar loud (no usar precio $0 por default).

## 8. Testing

### 8.1 Tests unitarios

```typescript
// lib/llm/router.test.ts
describe('LLM Router', () => {
  it('builds OpenAI model correctly', () => { ... });
  it('builds Anthropic model correctly', () => { ... });
  it('falls back to secondary provider on error', async () => { ... });
  it('encrypts and decrypts API keys', () => { ... });
});
```

### 8.2 Tests de integración (con cada provider)

```typescript
// __tests__/integration/llm-providers.test.ts
describe('LLM Providers Integration', () => {
  // Solo correr si API keys están en .env.test
  it.skipIf(!process.env.OPENAI_API_KEY)('OpenAI generates valid JSON', async () => { ... });
  it.skipIf(!process.env.ANTHROPIC_API_KEY)('Anthropic generates valid JSON', async () => { ... });
  // ... etc
});
```

### 8.3 Test con cada modelo

Para CI, podemos mockear cada provider con respuestas grabadas (fixtures) y validar que el flujo end-to-end funciona.

## 9. Configuración on-prem (Fase 2+)

> **Removida de MVP v0.3.** El soporte Ollama se reincorpora en Fase 2 cuando el producto esté validado. La sección de docker-compose se mueve a `specs/ollama-fase-2.md` cuando se implemente.

Mientras tanto, deploys 100% on-prem que quieran evitar APIs externas deben usar uno de los 3 providers oficiales (OpenAI/Anthropic/Gemini) con claves que el cliente traiga (BYOK).

## 10. Acceptance criteria

El multi-LLM router está completo cuando:

- [ ] Cada org puede configurar su provider desde la UI
- [ ] Las API keys se guardan cifradas (AES-256-GCM, ver `lib/security/encryption.ts`)
- [ ] Las API keys nunca aparecen en logs ni en errores (regex en `lib/redact.ts`)
- [ ] El switch de provider no requiere redeploy
- [ ] El fallback automático funciona cuando el provider primario falla
- [ ] El sistema de costos registra tokens y $ por generación (tabla `llm_usage`)
- [ ] El rate limit por org funciona (verificado con test)
- [ ] El test de API key en UI valida antes de guardar
- [ ] Los 3 providers están testeados con respuestas reales (fixtures + integration)
- [ ] Si una org tiene un provider heredado (minimax/ollama), el sistema falla loud con error claro
- [ ] La documentación explica BYOK vs nuestra API key (futuro modelo SaaS)

## 11. Out of scope (MVP)

- ❌ Modelo SaaS donde dash-bi provee las API keys (facturación separada)
- ❌ Ollama (Fase 2+)
- ❌ minimax (Fase 2+ si aparece provider oficial estable)
- ❌ Multi-key rotation (rotar entre varias keys del mismo provider)
- ❌ Custom proxy/load balancer entre providers
- ❌ Fine-tuning de modelos
- ❌ Embeddings (solo chat/generation en MVP)
- ❌ Vision input (subir imagen y que la IA la entienda)

## 12. Roadmap (post-MVP)

**Fase 2 (semana 5-6):**
- Ollama provider (con guía de hardware)
- Multi-key rotation
- Custom models (subir un modelo fine-tuned)
- Vision support para análisis de gráficos subidos

**Fase 3 (semana 7-8):**
- Modelo SaaS donde dash-bi provee keys con markup
- Embeddings para semantic search en data sources
- RAG (Retrieval Augmented Generation) sobre docs de la org

## 13. Riesgos

| Riesgo | Mitigación |
|--------|-----------|
| API key leak en logs | Filtros centralizados, regex para redactar `sk-*` (ver `lib/redact.ts`) |
| Master key comprometida | Rotación de master key, secrets manager |
| Provider caído | Fallback automático a `llmFallbackProvider` |
| Costo se dispara | Rate limit por org, alertas de gasto |
| Schema de provider cambia | Pin versiones de AI SDK, actualizar con breaking changes en CI |
| Modelo nuevo no tiene precio en `MODEL_COSTS` | Fail loud (throw), no usar $0 por default |

## 14. Dependencias

```json
{
  "dependencies": {
    "ai": "^6.0.0",                 // Vercel AI SDK v6 core
    "@ai-sdk/openai": "^2.0.0",
    "@ai-sdk/anthropic": "^2.0.0",
    "@ai-sdk/google": "^2.0.0"
  }
}
```

## 15. Specs relacionados

- `ai-generate-dashboards.md` — usa este router para llamar al LLM
- `multi-tenant.md` — org settings donde se guarda la config
- `auth.md` — permisos para cambiar config de LLM (solo admin)