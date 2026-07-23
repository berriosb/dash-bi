export type WidgetType =
  | 'kpi'
  | 'line-chart'
  | 'bar-chart'
  | 'pie-chart'
  | 'area-chart'
  | 'scatter'
  | 'table';

export type ThemeId = 'moderno-saas' | 'corporate';

export type ArchetypeId =
  | 'kpi-grid'
  | 'hero-focus'
  | 'cohort-matrix'
  | 'sales-pipeline'
  | 'executive-summary'
  | 'operations-live'
  | 'finance-report'
  | 'growth-metrics'
  | 'custom';

export type Density = 'spacious' | 'balanced' | 'dense';

export type ThemeAccent = 'default' | 'accent' | 'muted';

export type TimeWindow =
  | 'last_24h'
  | 'last_7d'
  | 'last_30d'
  | 'last_quarter'
  | 'last_90d'
  | 'last_6mo'
  | 'last_year'
  | 'all_time';

export type Comparativo =
  | 'none'
  | 'previous_period'
  | 'previous_month'
  | 'previous_quarter'
  | 'previous_year'
  | 'last_year_same_week';

export type Position = {
  col: number;
  row: number;
  colSpan: number;
  rowSpan: number;
};

export type ThemeColor =
  | 'primary'
  | 'secondary'
  | 'success'
  | 'warning'
  | 'danger'
  | 'muted'
  | 'accent';

export type BaseConfig = {
  title?: string;
  subtitle?: string;
  showLegend?: boolean;
  colorScheme?: ThemeColor[];
};

export type QueryKind = 'sql' | 'stripe' | 'sheets';

export type StripeOperation =
  | { type: 'listCharges'; params: any }
  | { type: 'listSubscriptions'; params: any }
  | { type: 'listCustomers'; params: any }
  | { type: 'listInvoices'; params: any }
  | { type: 'getRevenue'; params: { period: 'day' | 'week' | 'month' | 'year'; count: number } };

export type Query =
  | { kind: 'sql'; sql: string; params?: unknown[] }
  | { kind: 'stripe'; operation: StripeOperation; params: unknown }
  | { kind: 'sheets'; spreadsheetId: string; range: string };

export type RefreshMode = 'live' | 'cached-ttl' | 'manual';

export type DataSource = {
  kind: 'query';
  dataSourceId: string;
  query: Query;
  refresh?: {
    mode: RefreshMode;
    ttlSeconds?: number;
  };
};

export type KPIWidgetConfig = BaseConfig & {
  format?: 'currency' | 'number' | 'percent';
  deltaFormat?: 'currency' | 'number' | 'percent';
  showDelta?: boolean;
  deltaType?: 'absolute' | 'percent';
  comparisonPeriod?: 'previous' | 'last_year' | 'last_month' | 'last_week';
  icon?: string;
};

export type ChartConfig = BaseConfig & {
  xAxis?: 'time' | 'category' | 'number';
  yAxis?: 'linear' | 'log';
  showGrid?: boolean;
  smooth?: boolean;
  showPoints?: boolean;
  stacked?: boolean;
  orientation?: 'vertical' | 'horizontal';
  showValues?: boolean;
  variant?: 'pie' | 'donut';
  showLabels?: boolean;
  showPercent?: boolean;
  gradient?: boolean;
  xLabel?: string;
  yLabel?: string;
  showTrendline?: boolean;
};

export type TableConfig = BaseConfig & {
  columns: Array<{
    key: string;
    label: string;
    format?: 'currency' | 'number' | 'percent' | 'date' | 'text';
    align?: 'left' | 'center' | 'right';
    sortable?: boolean;
  }>;
  pagination?: boolean;
  pageSize?: number;
  searchable?: boolean;
};

export type Widget =
  | { type: 'kpi'; id: string; position: Position; config: KPIWidgetConfig; data: any; source: DataSource }
  | { type: 'line-chart'; id: string; position: Position; config: ChartConfig; data: any; source: DataSource }
  | { type: 'bar-chart'; id: string; position: Position; config: ChartConfig; data: any; source: DataSource }
  | { type: 'pie-chart'; id: string; position: Position; config: ChartConfig; data: any; source: DataSource }
  | { type: 'area-chart'; id: string; position: Position; config: ChartConfig; data: any; source: DataSource }
  | { type: 'scatter'; id: string; position: Position; config: ChartConfig; data: any; source: DataSource }
  | { type: 'table'; id: string; position: Position; config: TableConfig; data: any; source: DataSource };

export type KPIWidget = Extract<Widget, { type: 'kpi' }>;
export type LineChartWidget = Extract<Widget, { type: 'line-chart' }>;
export type BarChartWidget = Extract<Widget, { type: 'bar-chart' }>;
export type PieChartWidget = Extract<Widget, { type: 'pie-chart' }>;
export type AreaChartWidget = Extract<Widget, { type: 'area-chart' }>;
export type ScatterWidget = Extract<Widget, { type: 'scatter' }>;
export type TableWidget = Extract<Widget, { type: 'table' }>;

export type ArchetypeVariant = {
  density: Density;
  accent: ThemeAccent;
  timeWindow: TimeWindow;
  comparativo: Comparativo;
};

export type Dashboard = {
  title: string;
  description?: string;
  theme: ThemeId;
  widgets: Widget[];
  archetype?: ArchetypeId;
  archetypeVariant?: ArchetypeVariant;
};

export const DEFAULT_VARIANT: ArchetypeVariant = {
  density: 'balanced',
  accent: 'default',
  timeWindow: 'last_30d',
  comparativo: 'previous_period',
};
