// @vitest-environment happy-dom

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { HighDensityChart, shouldComponentUseCanvas } from '@/components/widgets/HighDensityChart';

vi.mock('echarts-for-react', () => ({
  default: vi.fn(({ option, style }: { option: Record<string, unknown>; style: Record<string, unknown> }) => {
    const series = (option.series as Array<{ type?: string }>) ?? [];
    return (
      <div data-testid="echarts-canvas-wrapper" style={style as React.CSSProperties}>
        <span data-testid="chart-series-count">{series.length}</span>
        <span data-testid="chart-type">{series[0]?.type ?? 'none'}</span>
      </div>
    );
  }),
}));

describe('HighDensityChart & threshold utility', () => {
  it('detects when to use Canvas rendering based on dataset size or forced prop', () => {
    expect(shouldComponentUseCanvas(100)).toBe(false);
    expect(shouldComponentUseCanvas(1500)).toBe(true);
    expect(shouldComponentUseCanvas(100, true)).toBe(true);
  });

  it('renders ECharts canvas wrapper for high-density datasets', () => {
    const mockData = Array.from({ length: 2000 }, (_, i) => ({
      timestamp: `2026-01-01 ${i}:00`,
      value: Math.sin(i / 10) * 100,
      value2: Math.cos(i / 10) * 50,
    }));

    render(
      <HighDensityChart
        title="Serie Temporal de Alta Densidad"
        type="line"
        data={mockData}
        xAxisKey="timestamp"
        seriesKeys={['value', 'value2']}
      />,
    );

    const wrapper = screen.getByTestId('echarts-canvas-wrapper');
    expect(wrapper).toBeDefined();

    const seriesCount = screen.getByTestId('chart-series-count');
    expect(seriesCount.textContent).toBe('2');

    const chartType = screen.getByTestId('chart-type');
    expect(chartType.textContent).toBe('line');
  });
});
