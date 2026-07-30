'use client';

import React from 'react';
import ReactECharts from 'echarts-for-react';

export type HighDensityChartType = 'line' | 'bar' | 'area' | 'scatter';

export type HighDensityChartProps = {
  title?: string;
  type?: HighDensityChartType;
  data: Array<Record<string, unknown>>;
  xAxisKey: string;
  seriesKeys: string[];
  seriesLabels?: Record<string, string>;
  height?: number | string;
  sampling?: 'lttb' | 'average' | 'max' | 'min' | 'sum';
  forceCanvas?: boolean;
};

export const HIGH_DENSITY_THRESHOLD = 1000;

export function shouldComponentUseCanvas(dataLength: number, forceCanvas = false, threshold = HIGH_DENSITY_THRESHOLD): boolean {
  if (forceCanvas) return true;
  return dataLength >= threshold;
}

const DEFAULT_PALETTE = [
  '#6366f1', // Indigo
  '#10b981', // Emerald
  '#f59e0b', // Amber
  '#ef4444', // Red
  '#8b5cf6', // Purple
  '#06b6d4', // Cyan
];

export function HighDensityChart({
  title,
  type = 'line',
  data,
  xAxisKey,
  seriesKeys,
  seriesLabels = {},
  height = 350,
  sampling = 'lttb',
}: HighDensityChartProps) {
  const xAxisData = data.map((item) => String(item[xAxisKey] ?? ''));

  const series = seriesKeys.map((key, index) => {
    const isArea = type === 'area';
    const seriesType = isArea ? 'line' : type;

    return {
      name: seriesLabels[key] ?? key,
      type: seriesType,
      data: data.map((item) => Number(item[key] ?? 0)),
      sampling,
      symbol: data.length > 500 ? 'none' : 'circle',
      smooth: true,
      lineStyle: {
        width: 2,
      },
      areaStyle: isArea
        ? {
            opacity: 0.2,
          }
        : undefined,
      color: DEFAULT_PALETTE[index % DEFAULT_PALETTE.length],
    };
  });

  const option = {
    backgroundColor: 'transparent',
    title: title
      ? {
          text: title,
          textStyle: {
            color: '#f8fafc',
            fontSize: 14,
            fontWeight: '600',
          },
          top: 0,
          left: 0,
        }
      : undefined,
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#0f172a',
      borderColor: '#334155',
      textStyle: {
        color: '#f8fafc',
        fontSize: 12,
      },
      axisPointer: {
        type: 'cross',
        label: {
          backgroundColor: '#475569',
        },
      },
    },
    legend: {
      data: series.map((s) => s.name),
      textStyle: {
        color: '#94a3b8',
        fontSize: 11,
      },
      top: title ? 25 : 0,
      right: 0,
    },
    grid: {
      left: '3%',
      right: '4%',
      bottom: data.length > 500 ? '15%' : '8%',
      top: title ? '20%' : '12%',
      containLabel: true,
    },
    xAxis: {
      type: 'category',
      boundaryGap: type === 'bar',
      data: xAxisData,
      axisLine: {
        lineStyle: {
          color: '#334155',
        },
      },
      axisLabel: {
        color: '#94a3b8',
        fontSize: 10,
      },
    },
    yAxis: {
      type: 'value',
      axisLine: {
        show: false,
      },
      splitLine: {
        lineStyle: {
          color: '#1e293b',
        },
      },
      axisLabel: {
        color: '#94a3b8',
        fontSize: 10,
      },
    },
    dataZoom:
      data.length > 500
        ? [
            {
              type: 'inside',
              start: 0,
              end: 100,
            },
            {
              type: 'slider',
              show: true,
              backgroundColor: '#0f172a',
              borderColor: '#334155',
              fillerColor: 'rgba(99, 102, 241, 0.2)',
              handleStyle: {
                color: '#6366f1',
              },
              textStyle: {
                color: '#94a3b8',
              },
              bottom: 5,
              height: 20,
            },
          ]
        : undefined,
    series,
  };

  return (
    <div className="w-full relative" style={{ height }}>
      <ReactECharts
        option={option}
        style={{ height: '100%', width: '100%' }}
        opts={{ renderer: 'canvas' }}
      />
    </div>
  );
}
