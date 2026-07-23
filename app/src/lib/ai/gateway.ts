import { generateObject } from 'ai';
import { z } from 'zod';
import { getLanguageModel } from './router';
import { selectArchetype } from '@/lib/widgets/selector';
import { ARCHETYPES } from '@/lib/widgets/archetypes';
import type { LLMProvider, GenerateDashboardInput } from './types';
import type { Dashboard } from '@/lib/widgets/types';

const generatedWidgetSchema = z.object({
  type: z.enum(['kpi', 'line-chart', 'bar-chart', 'pie-chart', 'area-chart', 'scatter', 'table']),
  title: z.string(),
  subtitle: z.string().optional(),
  colSpan: z.number().min(1).max(12),
  rowSpan: z.number().min(1).max(12),
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
  title: z.string(),
  description: z.string().optional(),
  theme: z.enum(['moderno-saas', 'corporate']),
  widgets: z.array(generatedWidgetSchema),
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

Esquema de la Fuente de Datos (${input.dataSourceType}):
${input.schemaInfo}

Reglas estrictas:
1. NUNCA generes SQL destructivo (DROP, DELETE, UPDATE, INSERT, ALTER). Solo SELECT de solo lectura.
2. Cada widget debe tener un 'query' válido alineado a la fuente de datos (${input.dataSourceType}).
3. Ajusta colSpan y rowSpan dentro de una cuadrícula de 12 columnas.
4. Títulos claros y descriptivos en español.
`;

    const result = await generateObject({
      model,
      schema: generatedDashboardSchema,
      prompt: `Prompt del usuario: "${input.prompt}"`,
      system: systemPrompt,
    });

    const generatedObj = result.object;

    let currentRow = 1;
    let currentCol = 1;

    const widgets = generatedObj.widgets.map((w, idx) => {
      const colSpan = w.colSpan;
      const rowSpan = w.rowSpan;

      if (currentCol + colSpan > 13) {
        currentCol = 1;
        currentRow += 4;
      }

      const pos = {
        col: currentCol,
        row: currentRow,
        colSpan,
        rowSpan,
      };

      currentCol += colSpan;

      return {
        id: `widget-${idx + 1}`,
        type: w.type,
        position: pos,
        config: {
          title: w.title,
          subtitle: w.subtitle,
        },
        data: null,
        source: {
          kind: 'query' as const,
          dataSourceId: input.dataSourceId,
          query: w.query as never,
          refresh: {
            mode: 'cached-ttl' as const,
            ttlSeconds: 60,
          },
        },
      } as Dashboard['widgets'][number];
    });

    return {
      title: generatedObj.title,
      description: generatedObj.description,
      theme: generatedObj.theme,
      archetype: selection.archetype,
      widgets,
    };
  }
}
