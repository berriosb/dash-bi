import type { ThemeId, ArchetypeId, Density, Widget } from '@/lib/widgets/types';

export type TemplateCategory = 'saas' | 'ecommerce' | 'marketing' | 'finance' | 'operations';

export type DashboardTemplate = {
  id: string;
  name: string;
  description: string;
  category: TemplateCategory;
  icon: string;
  theme: ThemeId;
  archetype: ArchetypeId;
  density: Density;
  recommendedSourceTypes: Array<'postgres' | 'stripe' | 'sheets' | 'spreadsheet'>;
  widgets: Widget[];
};
