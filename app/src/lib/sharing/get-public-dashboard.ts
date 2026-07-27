import { eq, sql } from 'drizzle-orm';
import { db, withOrgContext } from '@/db/client';
import { publicLinks, dashboards } from '@/db/schema';
import { audit } from '@/lib/audit/log';
import { logger } from '@/lib/logger';

export type PublicDashboardResult =
  | { status: 'not_found' }
  | { status: 'expired' }
  | { status: 'revoked' }
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
    };

/**
 * Resolve a public share token to a dashboard.
 *
 * Behavior:
 * - Returns 'not_found' if the token doesn't exist
 * - Returns 'expired' if expiresAt < now (revokedAt wins if both)
 * - Returns 'revoked' if revokedAt is set
 * - Otherwise returns 'ok' with the dashboard payload
 *
 * Side effects on success:
 * - Increments view_count + lastViewedAt (fire-and-forget, errors logged)
 * - Writes audit log entry `public_link.viewed` with null userId (public)
 */
export async function getPublicDashboard(token: string): Promise<PublicDashboardResult> {
  const link = await db.query.publicLinks.findFirst({
    where: eq(publicLinks.token, token),
  });

  if (!link) return { status: 'not_found' };
  if (link.revokedAt) return { status: 'revoked' };
  if (link.expiresAt && link.expiresAt < new Date()) return { status: 'expired' };

  const dashboard = await withOrgContext(link.orgId, null, async () => {
    const row = await db.query.dashboards.findFirst({
      where: eq(dashboards.id, link.dashboardId),
    });
    return row;
  });

  // Fire-and-forget view counter + audit
  void incrementViewCount(link.id);
  void audit(link.orgId, null, 'public_link.viewed', `public_link:${link.id}`);

  if (!dashboard) return { status: 'not_found' };

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
  };
}

async function incrementViewCount(linkId: string): Promise<void> {
  try {
    await db
      .update(publicLinks)
      .set({
        viewCount: sql`${publicLinks.viewCount} + 1`,
        lastViewedAt: new Date(),
      })
      .where(eq(publicLinks.id, linkId));
  } catch (error) {
    logger.error({ err: error, linkId }, 'failed to increment public link view count');
  }
}