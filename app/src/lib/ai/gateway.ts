import { generateObject } from 'ai';
import { z } from 'zod';
import { getLanguageModel } from './router';
import { selectArchetype } from '@/lib/widgets/selector';
import { ARCHETYPES } from '@/lib/widgets/archetypes';
import { validateDashboardWithArchetype } from '@/lib/widgets/validator';
import type { LLMProvider, GenerateDashboardInput } from './types';
import type { Dashboard, Widget, WidgetType } from '@/lib/widgets/types';

type GeneratedWidget = {
  type: WidgetType;
  title: string;
  subtitle?: string;
  slotId?: string;
  query: unknown;
};

const generatedWidgetSchema = z.object({
  type: z.enum(['kpi', 'line-chart', 'bar-chart', 'pie-chart', 'area-chart', 'scatter', 'table']),
  title: z.string().min(1).max(120),
  subtitle: z.string().max(200).optional(),
  slotId: z.string().max(80).optional(),
  query: z.union([
    z.object({ kind: z.literal('sql'), sql: z.string() }),
    z.object({
      kind: z.literal('stripe'),
      operation: z.object({
        type: z.string(),
        params: z.unknown().optional(),
      }),
    }),
    z.object({
      kind: z.literal('sheets'),
      spreadsheetId: z.string(),
      range: z.string(),
    }),
  ]),
});

const generatedDashboardSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(500).optional(),
  theme: z.enum(['moderno-saas', 'corporate']),
  archetypeVariant: z.object({
    density: z.enum(['spacious', 'balanced', 'dense']).optional(),
    accent: z.enum(['default', 'accent', 'muted']).optional(),
    timeWindow: z.enum(['last_24h', 'last_7d', 'last_30d', 'last_quarter', 'last_90d', 'last_6mo', 'last_year', 'all_time']).optional(),
    comparativo: z.enum(['none', 'previous_period', 'previous_month', 'previous_quarter', 'previous_year', 'last_year_same_week']).optional(),
  }).optional(),
  widgets: z.array(generatedWidgetSchema).min(1).max(12),
});

// ─────────────────────────────────────────────────────────────────
// NLQA — Natural Language Q&A (Sprint 3)
// ─────────────────────────────────────────────────────────────────
//
// Pipeline de 2 llamadas LLM orquestadas:
//   1. SQL agent: pregunta → SQL (con reasoning opcional).
//   2. Answer agent: pregunta + SQL + resultado → texto + chart suggestion.
//
// Esta separación da:
// - Streaming más granular (podemos emitir `sql_generated` antes de ejecutar)
// - Mejor debugging (reasoning visible)
// - Mayor reliability (re-validamos SQL contra validateQuery antes de ejecutar)

const nlqaSqlSchema = z.object({
  reasoning: z.string().max(500).optional(),
  sql: z.string().nullable(),
  params: z.array(z.unknown()).optional(),
  fallbackAnswer: z.string().max(500).optional(),
});

const nlqaAnswerSchema = z.object({
  answer: z.string().min(1).max(500),
  chartSuggestion: z
    .object({
      type: z.enum(['kpi', 'line-chart', 'bar-chart', 'pie-chart', 'area-chart', 'scatter', 'table']),
      rationale: z.string().max(200),
      config: z.record(z.unknown()).optional(),
    })
    .nullable(),
});

export type NLQASqlResult = z.infer<typeof nlqaSqlSchema>;
export type NLQAAnswerResult = z.infer<typeof nlqaAnswerSchema>;

export interface NLQAHistoryTurn {
  role: 'user' | 'assistant';
  content: string;
  sql?: string | null;
}

export interface NLQAGenerateSqlInput {
  question: string;
  schemaInfo: string;
  dataSourceType: 'postgres' | 'stripe' | 'sheets';
  history?: NLQAHistoryTurn[];
}

export interface NLQAGenerateAnswerInput {
  question: string;
  sql: string;
  result: {
    rows: unknown[];
    rowCount: number;
  };
  history?: NLQAHistoryTurn[];
}

export interface NLQAGenerateEditInput {
  prompt: string;
  existingDashboard: {
    title: string;
    description?: string;
    widgets: Widget[];
  };
  schemaInfo: string;
  dataSourceType: 'postgres' | 'stripe' | 'sheets';
}

export interface NLQAEditResult {
  action: 'add' | 'modify' | 'remove' | 'noop';
  reasoning: string;
  widgets?: Widget[];
  modifyWidgetId?: string;
}

export class AiGateway {
  constructor(
    private provider: LLMProvider = 'openai',
    private modelName: string = 'gpt-4o',
    private encryptedApiKey?: string,
  ) {}

  async generateDashboard(input: GenerateDashboardInput): Promise<Dashboard> {
    const selection = selectArchetype({
      prompt: input.prompt,
      dataSourceType: input.dataSourceType,
      recentArchetypes: input.recentArchetypes as never[],
    });

    const archetypeId = (selection.archetype in ARCHETYPES ? selection.archetype : 'kpi-grid') as keyof typeof ARCHETYPES;
    const archetypeTemplate = ARCHETYPES[archetypeId];
    const model = getLanguageModel(this.provider, this.modelName, this.encryptedApiKey);

    const systemPrompt = `
Eres un analista de Business Intelligence experto y diseñador de dashboards SaaS modernos.
Genera un dashboard estructurado basado en la solicitud del usuario y el arquetipo seleccionado: "${archetypeTemplate.name}".

Arquetipo: ${archetypeTemplate.description}
Estructura sugerida: ${archetypeTemplate.tagline} (Patrones: ${archetypeTemplate.atomicPatterns.join(', ')})
Slots disponibles: ${archetypeTemplate.slots.map((slot) => `${slot.id}=${slot.minCount}-${slot.maxCount} ${slot.allowedTypes.join('|')}`).join('; ')}

Esquema de la Fuente de Datos (${input.dataSourceType}):
${input.schemaInfo}

Reglas estrictas:
1. NUNCA generes SQL destructivo (DROP, DELETE, UPDATE, INSERT, ALTER). Solo SELECT de solo lectura.
2. Cada widget debe tener un 'query' válido alineado a la fuente de datos (${input.dataSourceType}).
3. Usa solamente widgets permitidos por los slots del arquetipo y respeta min/max de cada slot.
4. Para cada widget, indica 'slotId' usando uno de los slots disponibles.
5. Títulos claros y descriptivos en español.
6. El tema debe ser moderno-saas o corporate. Si el usuario no lo pide, usa la recomendación del arquetipo.
7. La variante solo puede usar density, accent, timeWindow y comparativo de los enums del schema.
8. No generes colores, fuentes, radios, sombras, gradientes, animaciones ni clases CSS. El renderer resuelve todo desde tokens semánticos.
`;

    const result = await generateObject({
      model,
      schema: generatedDashboardSchema,
      prompt: `Prompt del usuario: "${input.prompt}"`,
      system: systemPrompt,
    });

    const generatedObj = result.object;
    const theme = archetypeTemplate.recommendedTheme === 'auto'
      ? generatedObj.theme
      : archetypeTemplate.recommendedTheme;
    const archetypeVariant = {
      density: generatedObj.archetypeVariant?.density ?? archetypeTemplate.recommendedDensity,
      accent: generatedObj.archetypeVariant?.accent ?? archetypeTemplate.recommendedAccent,
      timeWindow: generatedObj.archetypeVariant?.timeWindow ?? archetypeTemplate.recommendedTimeWindow,
      comparativo: generatedObj.archetypeVariant?.comparativo ?? archetypeTemplate.recommendedComparativo,
    };
    const widgets = placeWidgetsInArchetype(generatedObj.widgets, archetypeTemplate, input.dataSourceId);

    const dashboard: Dashboard = {
      title: generatedObj.title,
      description: generatedObj.description,
      theme,
      archetype: selection.archetype,
      archetypeVariant,
      widgets,
    };
    const validation = validateDashboardWithArchetype(dashboard);

    if (!validation.zodValid || !validation.archetypeValid) {
      const details = [...validation.zodErrors, ...validation.archetypeErrors.map((error) => error.message)].join('; ');
      throw new Error(`La IA generó una composición inválida para el archetype seleccionado: ${details}`);
    }

    return dashboard;
  }

  // ─── NLQA: paso 1 — pregunta → SQL ──────────────────────────────

  async generateNLQASql(input: NLQAGenerateSqlInput): Promise<NLQASqlResult> {
    const model = getLanguageModel(this.provider, this.modelName, this.encryptedApiKey);

    const systemPrompt = `
# ROLE
Sos un agente SQL. Tu única tarea: convertir preguntas en lenguaje natural a SQL válido para responder la pregunta sobre la fuente de datos del usuario.

# DATA SOURCE (${input.dataSourceType})
${input.schemaInfo}

# RULES (estrictas)
1. SIEMPRE devuelve JSON con este shape: { "reasoning": "...", "sql": "SELECT ...", "params": [] }
2. Solo SELECT/WITH. NUNCA INSERT/UPDATE/DELETE/DROP/ALTER/TRUNCATE.
3. SIEMPRE incluí LIMIT 10000 si no hay LIMIT explícito.
4. Si la pregunta es ambigua, hacé la interpretación MÁS COMÚN y mencionala en "reasoning".
5. Si NO podés contestar con SQL (pregunta conceptual, sin datos), devolvé:
   { "reasoning": "...", "sql": null, "fallbackAnswer": "..." }

${input.history?.length ? `# CONVERSATION HISTORY\n${input.history.map((h) => `${h.role.toUpperCase()}: ${h.content}${h.sql ? `\nSQL usado: ${h.sql}` : ''}`).join('\n\n')}\n\n` : ''}# QUESTION
${input.question}

# OUTPUT (solo JSON válido, sin texto extra)
`;

    const result = await generateObject({
      model,
      schema: nlqaSqlSchema,
      prompt: systemPrompt,
      temperature: 0.1,
    });

    return result.object;
  }

  // ─── NLQA: paso 2 — pregunta + SQL + resultado → texto + chart ──

  async generateNLQAAnswer(input: NLQAGenerateAnswerInput): Promise<NLQAAnswerResult> {
    const model = getLanguageModel(this.provider, this.modelName, this.encryptedApiKey);
    const sample = input.result.rows.slice(0, 50);

    const systemPrompt = `
# ROLE
Sos un agente de respuesta. Convertís resultados SQL en respuestas cortas en español + sugerencia de chart.

# QUESTION ORIGINAL
${input.question}

# SQL EJECUTADO
${input.sql}

# RESULTADOS (max 50 filas)
${JSON.stringify(sample, null, 2)}

# TAREA
Devolvé JSON con:
{
  "answer": "Respuesta corta en español, máximo 2 frases, con números concretos.",
  "chartSuggestion": {
    "type": "kpi" | "line-chart" | "bar-chart" | "pie-chart" | "table" | null,
    "rationale": "Por qué este chart (1 frase)",
    "config": { ... }   // config específico del chart type
  } | null
}

# REGLAS
- "answer" SIEMPRE en español, conciso (<300 chars), con números reales del result.
- "chartSuggestion" SOLO si el result tiene sentido visual (>= 1 row con dato numérico).
- Si solo hay 1 valor (KPIs), sugerir type "kpi".
- Si hay time series (columna label tipo fecha), sugerir "line-chart".
- Si hay categorías discretas, sugerir "bar-chart".
- Si hay distribución partes/total, sugerir "pie-chart".
- Si hay >10 filas sin estructura clara, sugerir "table".
- Si el result tiene 0 filas, chartSuggestion = null.

${input.history?.length ? `# HISTORIAL (contexto)\n${input.history.map((h) => `${h.role.toUpperCase()}: ${h.content}`).join('\n')}\n\n` : ''}`;

    const result = await generateObject({
      model,
      schema: nlqaAnswerSchema,
      prompt: systemPrompt,
      temperature: 0.3,
    });

    return result.object;
  }

  // ─── Edit iterativo — modifica dashboard existente ─────────────

  async generateNLQAEdit(input: NLQAGenerateEditInput): Promise<NLQAEditResult> {
    const model = getLanguageModel(this.provider, this.modelName, this.encryptedApiKey);

    const widgetIds = input.existingDashboard.widgets.map((w) => w.id);
    const widgetsSummary = input.existingDashboard.widgets.map((w) => ({
      id: w.id,
      type: w.type,
      title: w.config.title ?? '(sin título)',
      position: w.position,
    }));

    const systemPrompt = `
# ROLE
Sos un agente de edición de dashboards. El usuario quiere MODIFICAR un dashboard existente.

# DASHBOARD ACTUAL
Título: ${input.existingDashboard.title}
Descripción: ${input.existingDashboard.description ?? '(sin descripción)'}
Widgets actuales (${widgetIds.length}):
${JSON.stringify(widgetsSummary, null, 2)}

IDs de widgets disponibles para "modify" o "remove": ${JSON.stringify(widgetIds)}

# DATA SOURCE (${input.dataSourceType})
${input.schemaInfo}

# SOLICITUD DEL USUARIO
${input.prompt}

# OUTPUT — JSON estricto
{
  "action": "add" | "modify" | "remove" | "noop",
  "reasoning": "Por qué esta acción (1-2 frases)",
  "widgets": [...],   // Solo si action="add" o "modify"
  "modifyWidgetId": "..."  // Solo si action="modify"
}

# REGLAS
1. Si el usuario pide "agregá un KPI de X", action="add" y devolvé un widget NUEVO en "widgets".
2. Si el usuario pide "cambiá el título de Y", action="modify" + modifyWidgetId=ID de Y + widgets=[Y modificado].
3. Si el usuario pide "eliminá el chart de Z", action="remove" + modifyWidgetId=ID de Z (sin widgets).
4. Si no está claro, action="noop" + reasoning explicando.
5. Solo SELECT queries.
6. Para nuevos widgets, position debe ser válida (1<=col<=12, row>=1).
`;

    const editResultSchema = z.object({
      action: z.enum(['add', 'modify', 'remove', 'noop']),
      reasoning: z.string().max(500),
      widgets: z.array(z.unknown()).optional(),
      modifyWidgetId: z.string().optional(),
    });

    const result = await generateObject({
      model,
      schema: editResultSchema,
      prompt: systemPrompt,
      temperature: 0.2,
    });

    return result.object as NLQAEditResult;
  }
}

function placeWidgetsInArchetype(
  generatedWidgets: GeneratedWidget[],
  archetypeTemplate: (typeof ARCHETYPES)[keyof typeof ARCHETYPES],
  dataSourceId: string,
): Widget[] {
  const assignments = generatedWidgets.map((widget) => {
    const requestedSlot = widget.slotId ? archetypeTemplate.slots.find((slot) => slot.id === widget.slotId) : undefined;
    const fallbackSlot = archetypeTemplate.slots.find((slot) => slot.allowedTypes.includes(widget.type));
    const slot = requestedSlot?.allowedTypes.includes(widget.type) ? requestedSlot : fallbackSlot;

    if (!slot) {
      throw new Error(`No existe un slot compatible para el widget "${widget.title}" (${widget.type})`);
    }

    return { widget, slot };
  });
  const grouped = new Map<string, typeof assignments>();

  for (const assignment of assignments) {
    const current = grouped.get(assignment.slot.id) ?? [];
    current.push(assignment);
    grouped.set(assignment.slot.id, current);
  }

  return assignments.map(({ widget, slot }) => {
    const group = grouped.get(slot.id)!;
    const index = group.findIndex((entry) => entry.widget === widget);
    const baseSpan = Math.floor(slot.colSpan / group.length);
    const remainder = slot.colSpan % group.length;
    const colSpan = baseSpan + (index < remainder ? 1 : 0);
    const col = slot.col + group.slice(0, index).reduce((total, _, itemIndex) => {
      const previousSpan = baseSpan + (itemIndex < remainder ? 1 : 0);
      return total + previousSpan;
    }, 0);

    return {
      id: `widget-${index + 1}-${slot.id}`,
      type: widget.type,
      position: {
        col,
        row: slot.row,
        colSpan,
        rowSpan: slot.rowSpan,
      },
      config: {
        title: widget.title,
        subtitle: widget.subtitle,
      },
      data: null,
      source: {
        kind: 'query' as const,
        dataSourceId,
        query: widget.query as never,
        refresh: {
          mode: 'cached-ttl' as const,
          ttlSeconds: 60,
        },
      },
    } as Widget;
  });
}
