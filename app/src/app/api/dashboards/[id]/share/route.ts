import { NextResponse } from 'next/server';
import { errorResponse } from '@/lib/errors/response';
import { and, eq } from 'drizzle-orm';
import { withOrgContext } from '@/db/client';
import { dashboards, publicLinks } from '@/db/schema';
import { requireAuth } from '@/lib/auth/request';
import { generatePublicToken } from '@/lib/sharing/token';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/http/client-ip';
import { audit } from '@/lib/audit/log';
import { AppErrorException } from '@/lib/errors/types';

export const dynamic = 'force-dynamic';

const DEFAULT_EXPIRY_DAYS = 30;
const MAX_EXPIRY_DAYS = 365;

/**
 * Two independent buckets, the same shape as `/api/dashboards/generate`.
 *
 * This route had no limit at all, and it mints a bearer token that grants
 * anonymous read access to a dashboard for up to a year. Minting them
 * without bound is how a link farm gets built out of one account. The org
 * bucket is the guarantee the threat model asks for ("rate limit per org");
 * the IP bucket blunts a single noisy client.
 */
const DASHBOARD_SHARE_PER_ORG = { capacity: 20, refillPerSecond: 20 / 3600 };
const DASHBOARD_SHARE_PER_IP = { capacity: 50, refillPerSecond: 50 / 3600 };

function sanitizeExpiresInDays(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_EXPIRY_DAYS;
  const days = Math.floor(value);
  if (days <= 0) return DEFAULT_EXPIRY_DAYS;
  if (days > MAX_EXPIRY_DAYS) return MAX_EXPIRY_DAYS;
  return days;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: dashboardId } = await params;

  try {
    const ctx = await requireAuth(req, 'dashboard.sharePublic');
    const ip = getClientIp(req);

    const orgLimit = checkRateLimit({
      ...DASHBOARD_SHARE_PER_ORG,
      key: `dashboard-share:org:${ctx.orgId}`,
    });
    if (!orgLimit.allowed) {
      return NextResponse.json(
        { error: 'rate_limited', scope: 'org', retryAfterSeconds: orgLimit.retryAfterSeconds },
        { status: 429, headers: { 'Retry-After': String(orgLimit.retryAfterSeconds) } },
      );
    }

    const ipLimit = checkRateLimit({
      ...DASHBOARD_SHARE_PER_IP,
      key: `dashboard-share:ip:${ip}`,
    });
    if (!ipLimit.allowed) {
      return NextResponse.json(
        { error: 'rate_limited', scope: 'ip', retryAfterSeconds: ipLimit.retryAfterSeconds },
        { status: 429, headers: { 'Retry-After': String(ipLimit.retryAfterSeconds) } },
      );
    }

    const body = await req.json().catch(() => ({}));
    const expiresInDays = sanitizeExpiresInDays(body.expiresInDays);
    const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);
    const token = generatePublicToken();

    // `public_links.dashboard_id` is an FK, not a tenant boundary: nothing
    // stops a caller from naming another org's dashboard and receiving a
    // working public URL for it. Ownership is proved before the insert.
    // A dashboard in another org is reported as "not found" so the
    // response never reveals that it exists.
    const [dashboard] = await withOrgContext(ctx.orgId, ctx.userId, ctx.role, async (tx) =>
      tx
        .select({ id: dashboards.id })
        .from(dashboards)
        .where(and(eq(dashboards.id, dashboardId), eq(dashboards.orgId, ctx.orgId)))
        .limit(1)
    );

    if (!dashboard) {
      throw new AppErrorException('not_found');
    }

    const [link] = await withOrgContext(ctx.orgId, ctx.userId, ctx.role, async (tx) =>
      tx.insert(publicLinks).values({
        orgId: ctx.orgId,
        dashboardId,
        token,
        expiresAt,
        createdBy: ctx.userId,
      }).returning()
    );

    if (!link) {
      return NextResponse.json({ error: 'Failed to create share link' }, { status: 500 });
    }

    await audit(ctx.orgId, ctx.userId, 'export.link_generated', `dashboard:${dashboardId}`, {
      metadata: { linkId: link.id, expiresInDays },
      req,
    });

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? '';
    return NextResponse.json(
      {
        url: `${baseUrl}/share/${link.token}`,
        token: link.token,
        expiresAt: link.expiresAt,
      },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error, req);
  }
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: dashboardId } = await params;

  try {
    const ctx = await requireAuth(req, 'dashboard.view');

    const links = await withOrgContext(ctx.orgId, ctx.userId, ctx.role, async (tx) =>
      tx.query.publicLinks.findMany({
        where: (t, { and, eq, isNull }) =>
          and(
            eq(t.orgId, ctx.orgId),
            eq(t.dashboardId, dashboardId),
            isNull(t.revokedAt),
          ),
        orderBy: (t, { desc }) => [desc(t.createdAt)],
      })
    );

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? '';
    const formatted = links.map((l) => ({
      id: l.id,
      token: l.token,
      url: `${baseUrl}/share/${l.token}`,
      expiresAt: l.expiresAt,
      viewCount: l.viewCount,
      lastViewedAt: l.lastViewedAt,
      createdAt: l.createdAt,
    }));

    return NextResponse.json({ links: formatted });
  } catch (error) {
    return errorResponse(error, req);
  }
}