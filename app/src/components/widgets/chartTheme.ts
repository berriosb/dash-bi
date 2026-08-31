export const CHART_COLORS = [
  'hsl(var(--color-primary-hsl))',
  'hsl(var(--color-secondary-hsl))',
  'hsl(var(--color-success-hsl))',
  'hsl(var(--color-warning-hsl))',
  'hsl(var(--color-accent-hsl))',
  'hsl(var(--color-primary-hsl) / 0.7)',
  'hsl(var(--color-secondary-hsl) / 0.7)',
];

export const chartTooltipContentStyle: React.CSSProperties = {
  backgroundColor: 'hsl(var(--color-surface-hsl))',
  borderColor: 'hsl(var(--color-border-hsl))',
  borderRadius: '8px',
  color: 'hsl(var(--color-text-hsl))',
  fontSize: '12px',
  fontVariantNumeric: 'tabular-nums',
  boxShadow: 'var(--shadow-card)',
  padding: '8px 12px',
};

export const chartTooltipItemStyle: React.CSSProperties = {
  color: 'hsl(var(--color-text-hsl))',
  fontSize: '12px',
  padding: '2px 0',
};

export const chartAxisTickStyle = {
  fill: 'hsl(var(--color-text-muted-hsl))',
  fontSize: 11,
  fontVariantNumeric: 'tabular-nums',
};

export const chartGridStyle = {
  stroke: 'hsl(var(--color-border-hsl))',
  strokeDasharray: '3 3',
};
