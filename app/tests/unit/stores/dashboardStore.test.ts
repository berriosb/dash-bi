import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useDashboardStore } from '@/stores/dashboardStore';
import type { Widget } from '@/lib/widgets/types';

const buildWidget = (id: string, overrides: Partial<Widget> = {}): Widget => ({
  id,
  type: 'kpi',
  position: { col: 1, row: 1, colSpan: 4, rowSpan: 2 },
  config: { title: 'Test' },
  data: { value: 0 },
  source: {
    kind: 'query',
    dataSourceId: 'ds_default',
    query: { kind: 'sql', sql: '' },
  },
  ...overrides,
} as Widget);

describe('useDashboardStore', () => {
  beforeEach(() => {
    act(() => {
      useDashboardStore.getState().resetDraft();
    });
  });

  it('adds a widget', () => {
    const widget = buildWidget('w1');
    act(() => {
      useDashboardStore.getState().addWidget(widget);
    });
    expect(useDashboardStore.getState().widgets).toHaveLength(1);
    expect(useDashboardStore.getState().widgets[0]?.id).toBe('w1');
  });

  it('updates a widget config', () => {
    act(() => {
      useDashboardStore.getState().addWidget(buildWidget('w1'));
    });
    act(() => {
      useDashboardStore.getState().updateWidget('w1', {
        config: { title: 'Updated' },
      } as Partial<Widget>);
    });
    expect(useDashboardStore.getState().widgets[0]?.config.title).toBe('Updated');
  });

  it('removes a widget', () => {
    act(() => {
      useDashboardStore.getState().addWidget(buildWidget('w1'));
      useDashboardStore.getState().addWidget(buildWidget('w2'));
    });
    act(() => {
      useDashboardStore.getState().removeWidget('w1');
    });
    expect(useDashboardStore.getState().widgets).toHaveLength(1);
    expect(useDashboardStore.getState().widgets[0]?.id).toBe('w2');
  });

  it('reorders widgets', () => {
    act(() => {
      useDashboardStore.getState().addWidget(buildWidget('w1'));
      useDashboardStore.getState().addWidget(buildWidget('w2'));
    });
    const reordered = [buildWidget('w2'), buildWidget('w1')];
    act(() => {
      useDashboardStore.getState().reorderWidgets(reordered);
    });
    expect(useDashboardStore.getState().widgets[0]?.id).toBe('w2');
  });

  it('exposes undo/redo via zundo temporal store', () => {
    act(() => {
      useDashboardStore.getState().addWidget(buildWidget('w1'));
    });
    const temporal = useDashboardStore.temporal.getState();

    expect(temporal.pastStates.length).toBeGreaterThan(0);

    act(() => {
      useDashboardStore.temporal.getState().undo();
    });
    expect(useDashboardStore.getState().widgets).toHaveLength(0);

    act(() => {
      useDashboardStore.temporal.getState().redo();
    });
    expect(useDashboardStore.getState().widgets).toHaveLength(1);
  });

  it('round-trips archetype and variant through setDashboard / updateArchetype', () => {
    act(() => {
      useDashboardStore.getState().setDashboard({
        id: 'd-1',
        title: 'Sales',
        theme: 'moderno-saas',
        widgets: [],
        archetype: 'finance-report',
        archetypeVariant: {
          density: 'dense',
          accent: 'accent',
          timeWindow: 'last_quarter',
          comparativo: 'previous_quarter',
        },
      });
    });
    expect(useDashboardStore.getState().archetype).toBe('finance-report');
    expect(useDashboardStore.getState().archetypeVariant.density).toBe('dense');

    act(() => {
      useDashboardStore.getState().updateArchetype('hero-focus');
    });
    expect(useDashboardStore.getState().archetype).toBe('hero-focus');

    act(() => {
      useDashboardStore.getState().updateArchetypeVariant({ density: 'spacious' });
    });
    expect(useDashboardStore.getState().archetypeVariant.density).toBe('spacious');
    // Other variant axes are preserved when patching one.
    expect(useDashboardStore.getState().archetypeVariant.accent).toBe('accent');
  });
});