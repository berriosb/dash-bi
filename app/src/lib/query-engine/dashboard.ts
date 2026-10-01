import { resolveConnector } from './resolve';
import { generateCacheKey, cacheGet, cacheSet } from './cache';
import { executeWithTimeout } from './execute';
import { hydrateWidget } from './hydrate';
import type { Widget } from '@/lib/widgets/types';
import type { OrgRole } from '@/lib/auth/permissions';

export type HydratedWidget = Widget & {
  error?: {
    kind: string;
    message: string;
  };
};

/**
 * `role` is REQUIRED, not optional. Every route that hydrates a dashboard
 * already holds `ctx.role`; when the parameter was optional the compiler
 * accepted the call sites that dropped it, the role never reached
 * `validateQuery`, and `assertRolePermissions` never ran. Making it
 * required turns "forgot to pass the role" into a type error.
 */
export async function hydrateWidgetFromQuery(
  orgId: string,
  userId: string,
  widget: Widget,
  role: OrgRole,
): Promise<HydratedWidget> {
  if (widget.source?.kind !== 'query') {
    return widget as HydratedWidget;
  }

  const { dataSourceId, query, refresh } = widget.source;
  const ttlSeconds = refresh?.ttlSeconds ?? 60;
  const cacheKey = generateCacheKey(orgId, dataSourceId, query, role);

  try {
    if (refresh?.mode !== 'live') {
      const cached = await cacheGet(cacheKey);
      if (cached) {
        return hydrateWidget(widget, cached) as HydratedWidget;
      }
    }

    const connector = await resolveConnector(orgId, userId, dataSourceId, role);
    const result = await executeWithTimeout(connector, dataSourceId, query, { role });

    await cacheSet(cacheKey, result, ttlSeconds);
    return hydrateWidget(widget, result) as HydratedWidget;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error executing widget query';
    return {
      ...widget,
      data: null,
      error: {
        kind: 'execution_error',
        message,
      },
    };
  }
}

export async function hydrateDashboard(
  orgId: string,
  userId: string,
  widgets: Widget[],
  role: OrgRole,
): Promise<HydratedWidget[]> {
  const results = await Promise.allSettled(
    widgets.map((widget) => hydrateWidgetFromQuery(orgId, userId, widget, role)),
  );

  return widgets.map((widget, i) => {
    const res = results[i];
    if (res && res.status === 'fulfilled') {
      return res.value;
    }
    const errorMsg = res && res.status === 'rejected' && res.reason instanceof Error ? res.reason.message : 'Failed to hydrate widget';
    return {
      ...widget,
      data: null,
      error: {
        kind: 'unknown_error',
        message: errorMsg,
      },
    };
  });
}
