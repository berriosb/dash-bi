import type { QueryResult } from '@/lib/connectors/types';
import type { Widget } from '@/lib/widgets/types';

export function hydrateWidget(widget: Widget, result: QueryResult): Widget {
  const rows = result.rows ?? [];

  switch (widget.type) {
    case 'kpi': {
      const row = (rows[0] as Record<string, unknown>) ?? {};
      const firstValueKey = Object.keys(row).find((k) => typeof row[k] === 'number') ?? Object.keys(row)[0];
      const value = firstValueKey ? Number(row[firstValueKey] ?? 0) : 0;
      const delta = row.delta !== undefined ? Number(row.delta) : undefined;
      const target = row.target !== undefined ? Number(row.target) : undefined;

      return {
        ...widget,
        data: { value, delta, target },
      };
    }

    case 'line-chart':
    case 'bar-chart':
    case 'area-chart':
    case 'scatter': {
      return {
        ...widget,
        data: rows,
      };
    }

    case 'pie-chart': {
      return {
        ...widget,
        data: rows.map((r) => {
          const rec = r as Record<string, unknown>;
          const name = String(rec.name ?? rec.label ?? rec.category ?? Object.values(rec)[0] ?? 'Item');
          const value = Number(rec.value ?? rec.amount ?? rec.count ?? Object.values(rec)[1] ?? 0);
          return { name, value };
        }),
      };
    }

    case 'table': {
      return {
        ...widget,
        data: rows,
      };
    }
  }
}
