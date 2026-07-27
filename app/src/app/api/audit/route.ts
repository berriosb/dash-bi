import { NextResponse } from 'next/server';
import { eq, and, desc, gte, inArray, type SQL } from 'drizzle-orm';
import { db, withOrgContext } from '@/db/client';
import { auditLog } from '@/db/schema';
import { requirePermission } from '@/lib/auth/context';
import { AUDIT_EVENT_CATEGORIES, type AuditCategory } from '@/lib/audit/events';

export const dynamic = 'force-dynamic';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

type Entry = {
  id: string;
  action: string;
  userId: string | null;
  resource: string | null;
  metadata: unknown;
  ip: string | null;
  createdAt: Date;
};

function sanitizeLimit(raw: string | null): number {
  if (!raw) return DEFAULT_LIMIT;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

function sanitizeSinceDays(raw: string | null): Date | null {
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const orgId = req.headers.get('x-org-id') || url.searchParams.get('orgId');
  const userId = req.headers.get('x-user-id');

  if (!orgId || !userId) {
    return NextResponse.json(
      { error: 'x-org-id and x-user-id headers required' },
      { status: 400 }
    );
  }

  try {
    await requirePermission(userId, orgId, 'audit.read');

    const limit = sanitizeLimit(url.searchParams.get('limit'));
    const since = sanitizeSinceDays(url.searchParams.get('sinceDays'));
    const categoryRaw = url.searchParams.get('category');
    const category: AuditCategory | null =
      categoryRaw && categoryRaw in AUDIT_EVENT_CATEGORIES
        ? (categoryRaw as AuditCategory)
        : null;

    const entries = await withOrgContext(orgId, userId, async () => {
      const conditions: SQL[] = [eq(auditLog.orgId, orgId)];
      if (since) conditions.push(gte(auditLog.createdAt, since));
      if (category) {
        conditions.push(inArray(auditLog.action, [...AUDIT_EVENT_CATEGORIES[category]]));
      }

      const rows = await db
        .select({
          id: auditLog.id,
          action: auditLog.action,
          userId: auditLog.userId,
          resource: auditLog.resource,
          metadata: auditLog.metadata,
          ip: auditLog.ip,
          createdAt: auditLog.createdAt,
        })
        .from(auditLog)
        .where(and(...conditions))
        .orderBy(desc(auditLog.createdAt))
        .limit(limit);
      return rows as Entry[];
    });

    return NextResponse.json({ entries, count: entries.length });
  } catch (error) {
    const e = error as { message?: string; name?: string };
    return NextResponse.json(
      { error: e.message ?? 'Internal error' },
      { status: e.name === 'ForbiddenError' ? 403 : 500 }
    );
  }
}