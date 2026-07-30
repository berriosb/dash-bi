import { describe, it, expect } from 'vitest';
import { TEMPLATE_CATALOG, getTemplateById, getTemplatesByCategory } from '@/lib/templates/catalog';
import { validateDashboardWithArchetype } from '@/lib/widgets/validator';

describe('Industry Dashboard Templates Catalog', () => {
  it('contains at least 5 curated industry templates', () => {
    expect(TEMPLATE_CATALOG.length).toBeGreaterThanOrEqual(5);
  });

  it('has unique template IDs', () => {
    const ids = TEMPLATE_CATALOG.map((t) => t.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('validates each template structure against validateDashboardWithArchetype', () => {
    for (const template of TEMPLATE_CATALOG) {
      const mockDashboard = {
        title: template.name,
        description: template.description,
        theme: template.theme,
        widgets: template.widgets,
        archetype: template.archetype,
        archetypeVariant: {
          density: template.density,
          accent: 'default',
          timeWindow: 'last_30d',
          comparativo: 'previous_period',
        },
      };

      const validation = validateDashboardWithArchetype(mockDashboard);
      expect(validation.zodValid, `Template ${template.id} Zod errors: ${validation.zodErrors.join(', ')}`).toBe(true);
      expect(validation.archetypeValid, `Template ${template.id} Archetype errors: ${JSON.stringify(validation.archetypeErrors)}`).toBe(true);
    }
  });

  it('allows fetching templates by ID and Category', () => {
    const saasTemplate = getTemplateById('saas-mrr-analytics');
    expect(saasTemplate).toBeDefined();
    expect(saasTemplate?.category).toBe('saas');

    const saasTemplates = getTemplatesByCategory('saas');
    expect(saasTemplates.length).toBeGreaterThanOrEqual(1);
    expect(saasTemplates[0]?.id).toBe('saas-mrr-analytics');
  });
});
