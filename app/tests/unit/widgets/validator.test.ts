import { describe, it, expect } from 'vitest';
import {
  validateArchetype,
  widgetsOverlap,
  validateDashboardWithArchetype,
  DashboardZodSchema,
  type ArchetypeValidationError,
} from '@/lib/widgets/validator';
import type { Dashboard, Widget } from '@/lib/widgets/types';

function makeWidget(overrides: Partial<Widget> & Pick<Widget, 'id' | 'type' | 'position'>): Widget {
  return {
    config: {},
    data: null,
    source: {
      kind: 'query',
      dataSourceId: 'ds-1',
      query: { kind: 'sql', sql: 'SELECT 1' },
    },
    ...overrides,
  } as Widget;
}

function makeDashboard(overrides: Partial<Dashboard> & Pick<Dashboard, 'widgets'>): Dashboard {
  return {
    title: 'Test Dashboard',
    theme: 'moderno-saas',
    ...overrides,
  } as Dashboard;
}

describe('widgetsOverlap helper', () => {
  it('returns false for non-overlapping widgets', () => {
    const a = { col: 1, row: 1, colSpan: 4, rowSpan: 2 };
    const b = { col: 5, row: 1, colSpan: 4, rowSpan: 2 };
    expect(widgetsOverlap(a, b)).toBe(false);
  });

  it('returns false for vertically separated widgets', () => {
    const a = { col: 1, row: 1, colSpan: 12, rowSpan: 2 };
    const b = { col: 1, row: 3, colSpan: 12, rowSpan: 2 };
    expect(widgetsOverlap(a, b)).toBe(false);
  });

  it('returns true for partial horizontal overlap', () => {
    const a = { col: 1, row: 1, colSpan: 6, rowSpan: 2 };
    const b = { col: 5, row: 1, colSpan: 6, rowSpan: 2 };
    expect(widgetsOverlap(a, b)).toBe(true);
  });

  it('returns true for full overlap (identical positions)', () => {
    const a = { col: 1, row: 1, colSpan: 4, rowSpan: 2 };
    const b = { col: 1, row: 1, colSpan: 4, rowSpan: 2 };
    expect(widgetsOverlap(a, b)).toBe(true);
  });

  it('returns true for vertical overlap (same col, overlapping rows)', () => {
    const a = { col: 1, row: 1, colSpan: 4, rowSpan: 4 };
    const b = { col: 1, row: 3, colSpan: 4, rowSpan: 4 };
    expect(widgetsOverlap(a, b)).toBe(true);
  });

  it('returns false when widgets are adjacent (touching edges)', () => {
    const a = { col: 1, row: 1, colSpan: 4, rowSpan: 2 };
    const b = { col: 5, row: 1, colSpan: 4, rowSpan: 2 }; // starts exactly where a ends
    expect(widgetsOverlap(a, b)).toBe(false);
  });
});

describe('validateArchetype — overlap + bounds (Sprint 1 v0.2)', () => {
  it('flags widgets_overlap error when two widgets share cells', () => {
    const dashboard = makeDashboard({
      archetype: 'kpi-grid',
      widgets: [
        makeWidget({ id: 'w1', type: 'kpi', position: { col: 1, row: 1, colSpan: 6, rowSpan: 2 } }),
        makeWidget({ id: 'w2', type: 'kpi', position: { col: 5, row: 1, colSpan: 6, rowSpan: 2 } }),
      ],
    });

    const result = validateArchetype(dashboard);
    expect(result.valid).toBe(false);
    const overlapErrors = result.errors.filter(e => e.kind === 'widgets_overlap');
    expect(overlapErrors.length).toBeGreaterThan(0);
    expect(overlapErrors[0]?.widgetA).toBe('w1');
    expect(overlapErrors[0]?.widgetB).toBe('w2');
  });

  it('accepts non-overlapping widgets', () => {
    const dashboard = makeDashboard({
      archetype: 'kpi-grid',
      widgets: [
        makeWidget({ id: 'w1', type: 'kpi', position: { col: 1, row: 1, colSpan: 4, rowSpan: 2 } }),
        makeWidget({ id: 'w2', type: 'kpi', position: { col: 5, row: 1, colSpan: 4, rowSpan: 2 } }),
        makeWidget({ id: 'w3', type: 'line-chart', position: { col: 9, row: 1, colSpan: 4, rowSpan: 4 } }),
      ],
    });

    const result = validateArchetype(dashboard);
    const overlapErrors = result.errors.filter(e => e.kind === 'widgets_overlap');
    expect(overlapErrors.length).toBe(0);
  });

  it('flags widget_out_of_bounds when col exceeds 12', () => {
    const dashboard = makeDashboard({
      archetype: 'kpi-grid',
      widgets: [
        makeWidget({ id: 'w1', type: 'kpi', position: { col: 11, row: 1, colSpan: 4, rowSpan: 2 } }),
      ],
    });

    const result = validateArchetype(dashboard);
    const boundsErrors = result.errors.filter(e => e.kind === 'widget_out_of_bounds');
    expect(boundsErrors.length).toBeGreaterThan(0);
    expect(boundsErrors[0]?.axis).toBe('colSpan');
  });

  it('flags widget_out_of_bounds when rowSpan > 6', () => {
    const dashboard = makeDashboard({
      archetype: 'kpi-grid',
      widgets: [
        makeWidget({ id: 'w1', type: 'kpi', position: { col: 1, row: 1, colSpan: 4, rowSpan: 10 } }),
      ],
    });

    const result = validateArchetype(dashboard);
    const boundsErrors = result.errors.filter(e => e.kind === 'widget_out_of_bounds' && e.axis === 'rowSpan');
    expect(boundsErrors.length).toBeGreaterThan(0);
  });

  it('flags widget_out_of_bounds when row < 1', () => {
    const dashboard = makeDashboard({
      archetype: 'kpi-grid',
      widgets: [
        makeWidget({ id: 'w1', type: 'kpi', position: { col: 1, row: 0, colSpan: 4, rowSpan: 2 } }),
      ],
    });

    const result = validateArchetype(dashboard);
    const boundsErrors = result.errors.filter(e => e.kind === 'widget_out_of_bounds' && e.axis === 'row');
    expect(boundsErrors.length).toBeGreaterThan(0);
  });

  it('skips overlap check for custom archetype (manual editing bypasses)', () => {
    const dashboard = makeDashboard({
      archetype: 'custom',
      widgets: [
        makeWidget({ id: 'w1', type: 'kpi', position: { col: 1, row: 1, colSpan: 6, rowSpan: 2 } }),
        makeWidget({ id: 'w2', type: 'kpi', position: { col: 5, row: 1, colSpan: 6, rowSpan: 2 } }),
      ],
    });

    const result = validateArchetype(dashboard);
    expect(result.errors.some(e => e.kind === 'widgets_overlap')).toBe(false);
  });

  it('returns multiple errors when multiple overlaps exist', () => {
    const dashboard = makeDashboard({
      archetype: 'kpi-grid',
      widgets: [
        makeWidget({ id: 'w1', type: 'kpi', position: { col: 1, row: 1, colSpan: 6, rowSpan: 2 } }),
        makeWidget({ id: 'w2', type: 'kpi', position: { col: 5, row: 1, colSpan: 6, rowSpan: 2 } }),
        makeWidget({ id: 'w3', type: 'kpi', position: { col: 1, row: 1, colSpan: 6, rowSpan: 2 } }),
      ],
    });

    const result = validateArchetype(dashboard);
    const overlapErrors = result.errors.filter(e => e.kind === 'widgets_overlap');
    // 3 widgets → C(3,2) = 3 pairs
    expect(overlapErrors.length).toBe(3);
  });
});

describe('DashboardZodSchema — bounds via Zod', () => {
  it('rejects widget with col > 12 via PositionSchema', () => {
    const result = DashboardZodSchema.safeParse({
      title: 'X',
      theme: 'moderno-saas',
      widgets: [
        {
          id: 'w1',
          type: 'kpi',
          position: { col: 15, row: 1, colSpan: 4, rowSpan: 2 },
          config: {},
          data: null,
          source: { kind: 'query', dataSourceId: 'ds-1', query: { kind: 'sql', sql: 'SELECT 1' } },
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('accepts widget at col 1, colSpan 12 (full width)', () => {
    const result = DashboardZodSchema.safeParse({
      title: 'X',
      theme: 'moderno-saas',
      widgets: [
        {
          id: 'w1',
          type: 'kpi',
          position: { col: 1, row: 1, colSpan: 12, rowSpan: 2 },
          config: {},
          data: null,
          source: { kind: 'query', dataSourceId: 'ds-1', query: { kind: 'sql', sql: 'SELECT 1' } },
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('accepts widget at col 12, colSpan 1 (rightmost)', () => {
    const result = DashboardZodSchema.safeParse({
      title: 'X',
      theme: 'moderno-saas',
      widgets: [
        {
          id: 'w1',
          type: 'kpi',
          position: { col: 12, row: 1, colSpan: 1, rowSpan: 2 },
          config: {},
          data: null,
          source: { kind: 'query', dataSourceId: 'ds-1', query: { kind: 'sql', sql: 'SELECT 1' } },
        },
      ],
    });
    expect(result.success).toBe(true);
  });
});

describe('validateDashboardWithArchetype — combined checks', () => {
  it('reports both zod and archetype errors', () => {
    const result = validateDashboardWithArchetype({
      title: 'X',
      theme: 'moderno-saas',
      archetype: 'kpi-grid',
      widgets: [
        {
          id: 'w1',
          type: 'kpi',
          position: { col: 1, row: 1, colSpan: 6, rowSpan: 2 },
          config: {},
          data: null,
          source: { kind: 'query', dataSourceId: 'ds-1', query: { kind: 'sql', sql: 'SELECT 1' } },
        },
        {
          id: 'w2',
          type: 'kpi',
          position: { col: 5, row: 1, colSpan: 6, rowSpan: 2 },
          config: {},
          data: null,
          source: { kind: 'query', dataSourceId: 'ds-1', query: { kind: 'sql', sql: 'SELECT 1' } },
        },
      ],
    });

    expect(result.zodValid).toBe(true);
    expect(result.archetypeValid).toBe(false);
    expect(result.archetypeErrors.some(e => e.kind === 'widgets_overlap')).toBe(true);
  });
});