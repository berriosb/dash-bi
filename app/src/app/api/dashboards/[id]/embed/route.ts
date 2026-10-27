import { NextResponse } from 'next/server';
import { errorResponse } from '@/lib/errors/response';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { requireAuth } from '@/lib/auth/request';
import { withOrgContext } from '@/db/client';
import { dashboards } from '@/db/schema';
import { generateEmbedToken, buildIframeSnippet } from '@/lib/embed/token';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/http/client-ip';
import { audit } from '@/lib/audit/log';

export const dynamic = 'force-dynamic';

/**
 * Two independent buckets, the same shape as `/api/dashboards/generate`.
 *
 * This route had no limit at all, and it mints an embed token that lets a
 * third-party site frame the dashboard. Minting them without bound is how
 * a token farm gets built out of one account. The org bucket is the
 * guarantee the threat model asks for ("rate limit per org"); the IP bucket
 * blunts a single noisy client.
 */
const DASHBOARD_EMBED_PER_ORG = { capacity: 20, refillPerSecond: 20 / 3600 };
const DASHBOARD_EMBED_PER_IP = { capacity: 50, refillPerSecond: 50 / 3600 };

const embedSchema = z.object({
  allowedOrigins: z.array(z.string()).default(['*']),
  theme: z.enum(['moderno-saas', 'corporate', 'transparent']).default('moderno-saas'),
  hideTitle: z.boolean().default(false),
  allowExport: z.boolean().default(false),
  expiresInDays: z.number().min(1).max(365).optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: dashboardId } = await params;

  try {
    const ctx = await requireAuth(req, 'dashboard.embed');
    const ip = getClientIp(req);

    const orgLimit = checkRateLimit({
      ...DASHBOARD_EMBED_PER_ORG,
      key: `dashboard-embed:org:${ctx.orgId}`,
    });
    if (!orgLimit.allowed) {
      return NextResponse.json(
        { error: 'rate_limited', scope: 'org', retryAfterSeconds: orgLimit.retryAfterSeconds },
        { status: 429, headers: { 'Retry-After': String(orgLimit.retryAfterSeconds) } },
      );
    }

    const ipLimit = checkRateLimit({
      ...DASHBOARD_EMBED_PER_IP,
      key: `dashboard-embed:ip:${ip}`,
    });
    if (!ipLimit.allowed) {
      return NextResponse.json(
        { error: 'rate_limited', scope: 'ip', retryAfterSeconds: ipLimit.retryAfterSeconds },
        { status: 429, headers: { 'Retry-After': String(ipLimit.retryAfterSeconds) } },
      );
    }

    const dashboard = await withOrgContext(ctx.orgId, ctx.userId, ctx.role, async (tx) =>
      tx.query.dashboards.findFirst({
        where: eq(dashboards.id, dashboardId),
      })
    );

    if (!dashboard) {
      return NextResponse.json(
        { error: 'Not Found', message: 'Dashboard no encontrado' },
        { status: 404 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const parsed = embedSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid body', details: parsed.error.format() },
        { status: 400 }
      );
    }

    const { allowedOrigins, theme, hideTitle, allowExport, expiresInDays } = parsed.data;

    const expiresAt = expiresInDays
      ? new Date(Date.now() + expiresInDays * 86400 * 1000).toISOString()
      : null;

    const { token } = await generateEmbedToken({
      dashboardId,
      orgId: ctx.orgId,
      allowedOrigins,
      theme,
      hideTitle,
      allowExport,
      expiresAt,
    });

    await audit(ctx.orgId, ctx.userId, 'embed.generated', `dashboard:${dashboardId}`, {
      req,
      metadata: {
        allowedOrigins,
        theme,
      },
    });

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const embedUrl = `${appUrl.replace(/\/$/, '')}/embed/${token}`;
    const iframeSnippet = buildIframeSnippet(token, appUrl);

    return NextResponse.json(
      {
        token,
        embedUrl,
        iframeSnippet,
        expiresAt,
        allowedOrigins,
        theme,
        hideTitle,
      },
      { status: 201 }
    );
  } catch (error) {
    return errorResponse(error, req);
  }
}
