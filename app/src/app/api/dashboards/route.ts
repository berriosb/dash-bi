import { NextResponse } from 'next/server';
import { eq, desc } from 'drizzle-orm';
import { z } from 'zod';
import { db, withOrgContext } from '@/db/client';
import { dashboards } from '@/db/schema';
import { requirePermission } from '@/lib/auth/context';
import { logRequest } from '@/lib/logger';
import { audit } from '@/lib/audit/log';
import {
  toUserError,
  getOrGenerateCorrelationId,
} from '@/lib/errors/to-user-error';
import { statusFromCode } from '@/lib/errors/types';
import type { ThemeId } from '@/lib/widgets/types';

export const dynamic = 'force-dynamic';

const CreateDashboardSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  theme: z.enum(['moderno-saas', 'corporate']).optional(),
  widgets: z.array(z.unknown()).optional(),
});

function getAuthHeaders(req: Request): { orgId: string | null; userId: string | null } {
  const url = new URL(req.url);
  return {
    orgId: req.headers.get('x-org-id') || url.searchParams.get('orgId'),
    userId: req.headers.get('x-user-id'),
  };
}

function errorResponse(error: unknown, req: Request, fallbackStatus = 500) {
  const correlationId = getOrGenerateCorrelationId(req);
  const appError = toUserError(error, correlationId);
  const status = appError.code === 'internal_server_error' ? fallbackStatus : statusFromCode(appError.code);
  return NextResponse.json(appError, {
    status,
    headers: { 'x-correlation-id': correlationId },
  });
}

export async function GET(req: Request) {
  const { orgId, userId } = getAuthHeaders(req);
  if (!orgId || !userId) {
    return errorResponse(new Error('x-org-id and x-user-id headers required'), req);
  }

  const { correlationId, logger: reqLogger } = logRequest(req);

  try {
    await requirePermission(userId, orgId, 'dashboard.view');
    const result = await withOrgContext(orgId, userId, async () => {
      return db.select()
        .from(dashboards)
        .where(eq(dashboards.orgId, orgId))
        .orderBy(desc(dashboards.updatedAt));
    });

    reqLogger.info({ count: result.length }, 'dashboards listed');
    return NextResponse.json(
      { dashboards: result },
      { headers: { 'x-correlation-id': correlationId } },
    );
  } catch (error) {
    reqLogger.error({ err: error }, 'dashboards GET failed');
    return errorResponse(error, req);
  }
}

export async function POST(req: Request) {
  const { orgId, userId } = getAuthHeaders(req);
  if (!orgId || !userId) {
    return errorResponse(new Error('x-org-id and x-user-id headers required'), req);
  }

  const { correlationId, logger: reqLogger } = logRequest(req);

  try {
    await requirePermission(userId, orgId, 'dashboard.create');

    const body = await req.json();
    const parsed = CreateDashboardSchema.parse(body);

    const inserted = await withOrgContext(orgId, userId, async () => {
      return db.insert(dashboards).values({
        orgId,
        title: parsed.title,
        description: parsed.description ?? null,
        theme: (parsed.theme as ThemeId) ?? 'moderno-saas',
        widgets: parsed.widgets ?? [],
        createdBy: userId,
        updatedBy: userId,
      }).returning();
    });

    const created = inserted[0];
    if (!created) {
      throw new Error('Dashboard insert returned no row');
    }

    await audit(orgId, userId, 'dashboard.created', `dashboard:${created.id}`, {
      metadata: { title: parsed.title },
      req,
    });
    reqLogger.info({ dashboardId: created.id, title: parsed.title }, 'dashboard created');

    return NextResponse.json(
      { dashboard: created },
      {
        status: 201,
        headers: { 'x-correlation-id': correlationId },
      },
    );
  } catch (error) {
    reqLogger.error({ err: error }, 'dashboards POST failed');
    return errorResponse(error, req);
  }
}