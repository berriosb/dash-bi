import { eq } from 'drizzle-orm';
import { withOrgContext } from '@/db/client';
import { dashboards } from '@/db/schema';
import { verifyEmbedToken, getCspFrameAncestors } from '@/lib/embed/token';
import { audit } from '@/lib/audit/log';

export type EmbedDashboardResult =
  | { status: 'invalid_token' }
  | { status: 'expired' }
  | { status: 'invalid_origin' }
  | { status: 'not_found' }
  | {
      status: 'ok';
      dashboard: {
        id: string;
        orgId: string;
        title: string;
        description: string | null;
        theme: string;
        widgets: unknown[];
      };
      config: {
        theme?: 'moderno-saas' | 'corporate' | 'transparent';
        hideTitle: boolean;
        allowExport: boolean;
        cspHeader: string;
      };
    };

/**
 * Resolve an embed token to a dashboard and its embedding configuration.
 */
export async function getEmbedDashboard(
  token: string,
  requestOrigin?: string
): Promise<EmbedDashboardResult> {
  const verification = await verifyEmbedToken(token, requestOrigin);

  if (!verification.valid || !verification.payload) {
    if (verification.error === 'expired') return { status: 'expired' };
    if (verification.error === 'invalid_origin') return { status: 'invalid_origin' };
    return { status: 'invalid_token' };
  }

  const { payload } = verification;

  const dashboard = await withOrgContext(payload.orgId, null, 'viewer', async (tx) =>
    tx.query.dashboards.findFirst({ where: eq(dashboards.id, payload.dashboardId) })
  );

  if (!dashboard) {
    return { status: 'not_found' };
  }

  void audit(payload.orgId, null, 'embed.viewed', `dashboard:${payload.dashboardId}`);

  return {
    status: 'ok',
    dashboard: {
      id: dashboard.id,
      orgId: dashboard.orgId,
      title: dashboard.title,
      description: dashboard.description ?? null,
      theme: dashboard.theme,
      widgets: Array.isArray(dashboard.widgets) ? dashboard.widgets : [],
    },
    config: {
      theme: payload.theme ?? 'moderno-saas',
      hideTitle: Boolean(payload.hideTitle),
      allowExport: Boolean(payload.allowExport),
      cspHeader: getCspFrameAncestors(payload.allowedOrigins),
    },
  };
}
