import { describe, expect, it } from 'vitest';
import { getActiveNavigationHref, platformNavigation } from '@/components/layout/navigation';

describe('platform navigation', () => {
  it('groups the product around the main work areas', () => {
    expect(platformNavigation.map((section) => section.label)).toEqual([
      'Analizar',
      'Preparar',
      'Administrar',
    ]);
  });

  it('keeps nested dashboard routes active under dashboards', () => {
    expect(getActiveNavigationHref('/dashboards/weekly-revenue', '')).toBe('/dashboards');
    expect(getActiveNavigationHref('/data-sources')).toBe('/data-sources');
    expect(getActiveNavigationHref('/settings/llm-usage')).toBe('/settings');
    expect(getActiveNavigationHref('/onboarding')).toBeNull();
  });

  it('uses query context when dashboard routes share the same pathname', () => {
    expect(getActiveNavigationHref('/dashboards', '')).toBe('/dashboards');
    expect(getActiveNavigationHref('/dashboards', '?ask=true')).toBe('/dashboards?ask=true');
    expect(getActiveNavigationHref('/dashboards', '?tab=templates')).toBe('/dashboards?tab=templates');
  });
});
