import { NextResponse } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { requireAuth } from '@/lib/auth/request';
import { withOrgContext } from '@/db/client';
import { dashboards } from '@/db/schema';
import { generateEmbedToken, buildIframeSnippet } from '@/lib/embed/token';
import { audit } from '@/lib/audit/log';
import { toUserError, getOrGenerateCorrelationId } from '@/lib/errors/to-user-error';
import { statusFromCode } from '@/lib/errors/types';

export const dynamic = 'force-dynamic';

const embedSchema = z.object({
  allowedOrigins: z.array(z.string()).default(['*']),
  theme: z.enum(['moderno-saas', 'corporate', 'transparent']).default('moderno-saas'),
  hideTitle: z.boolean().default(false),
  allowExport: z.boolean().default(false),
  expiresInDays: z.number().min(1).max(365).optional(),
});

function errorResponse(error: unknown, req: Request) {
  const correlationId = getOrGenerateCorrelationId(req);
  const appError = toUserError(error, correlationId);
  return NextResponse.json(appError, {
    status: statusFromCode(appError.code),
    headers: { 'x-correlation-id': correlationId },
  });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: dashboardId } = await params;

  try {
    const ctx = await requireAuth(req, 'dashboard.embed');

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
