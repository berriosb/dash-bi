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
