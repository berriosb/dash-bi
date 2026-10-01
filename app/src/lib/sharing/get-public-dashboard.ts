import { eq, sql } from 'drizzle-orm';
import { db, withOrgContext } from '@/db/client';
import { publicLinks, dashboards } from '@/db/schema';
import { audit } from '@/lib/audit/log';
import { logger } from '@/lib/logger';

/** `public_links` as raw SQL returns it: column names, not Drizzle keys. */
interface PublicLinkRow {
  id: string;
  org_id: string;
  dashboard_id: string;
  token: string;
  expires_at: Date | null;
  revoked_at: Date | null;
  [key: string]: unknown;
}

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
 * Sprint 1.5: el lookup inicial del `public_links` por token corre en
 * `withSystemContext` (RLS FORZADO acepta la fila solo si el caller es
 * un rol admin — el rol `dashbi` actual lo es, pero `FORCE` se saltea
 * para table owners en versiones recientes). Para mantener el threat
 * model T6 consistente, hacemos el lookup por token único (no requiere
 * membership) y luego cargamos el dashboard en `withOrgContext(orgId,
 * null)`, de modo que las RLS policies filtren correctamente.
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
  // Resolving the token to its org is the one step that cannot be org-scoped:
  // nobody knows the org until the link is resolved. It is safe because the
  // token is the credential and is unguessable, and because it happens through
  // a named SECURITY DEFINER function (migration 0014) whose search_path and
  // EXECUTE grant are pinned, rather than a transaction that silently reads
  // whatever RLS allows. Everything after this runs under `withOrgContext`.
  const link = (
    await db.execute<PublicLinkRow>(sql`SELECT * FROM dashbi_resolve_public_link(${token})`)
  )[0];

  if (!link) return { status: 'not_found' };
  if (link.revoked_at) return { status: 'revoked' };
  if (link.expires_at && link.expires_at < new Date()) return { status: 'expired' };

  const dashboard = await withOrgContext(link.org_id, null, 'editor', async (tx) =>
    tx.query.dashboards.findFirst({ where: eq(dashboards.id, link.dashboard_id) })
  );

  void incrementViewCount(link.id, link.org_id);
  void audit(link.org_id, null, 'public_link.viewed', `public_link:${link.id}`);

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

async function incrementViewCount(linkId: string, orgId: string): Promise<void> {
  try {
    await withOrgContext(orgId, null, 'editor', async (tx) => {
      await tx
        .update(publicLinks)
        .set({
          viewCount: sql`${publicLinks.viewCount} + 1`,
          lastViewedAt: new Date(),
        })
        .where(eq(publicLinks.id, linkId));
    });
  } catch (error) {
    logger.error({ err: error, linkId }, 'failed to increment public link view count');
  }
}