import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withOrgContext } from '@/db/client';
import { scheduledReports, scheduledReportRuns } from '@/db/schema';
import { requireAuth } from '@/lib/auth/request';
import { toUserError, getOrGenerateCorrelationId } from '@/lib/errors/to-user-error';
import { parseCronAndNextRun, isValidCron } from '@/lib/reports/cron';
import { eq, and, desc } from 'drizzle-orm';

const updateReportSchema = z.object({
  cron: z.string().refine(isValidCron, { message: 'Expresión cron inválida' }).optional(),
  timezone: z.string().optional(),
  format: z.enum(['pdf', 'png-link']).optional(),
  includeBranding: z.boolean().optional(),
  recipients: z.array(
    z.object({
      email: z.string().email(),
      name: z.string().optional(),
    })
  ).min(1).optional(),
  enabled: z.boolean().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
});

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const correlationId = getOrGenerateCorrelationId(req);
  try {
    const { orgId, userId } = await requireAuth(req, 'dashboard.view');
    const { id } = await params;

    const report = await withOrgContext(orgId, userId, async (tx) => {
      const [found] = await tx
        .select()
        .from(scheduledReports)
        .where(and(eq(scheduledReports.id, id), eq(scheduledReports.orgId, orgId)));
      return found;
    });

    if (!report) {
      return NextResponse.json({ error: 'Reporte programado no encontrado' }, { status: 404 });
    }

    const runs = await withOrgContext(orgId, userId, async (tx) => {
      return tx
        .select()
        .from(scheduledReportRuns)
        .where(and(eq(scheduledReportRuns.scheduledReportId, id), eq(scheduledReportRuns.orgId, orgId)))
        .orderBy(desc(scheduledReportRuns.startedAt))
        .limit(20);
    });

    return NextResponse.json({ report, runs });
  } catch (err: unknown) {
    const userErr = toUserError(err, correlationId);
    return NextResponse.json({ error: userErr.message }, { status: 400 });
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const correlationId = getOrGenerateCorrelationId(req);
  try {
    const { orgId, userId } = await requireAuth(req, 'dashboard.edit');
    const { id } = await params;
    const body = await req.json();

    const parseResult = updateReportSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json({ error: 'Datos de actualización inválidos', details: parseResult.error.flatten() }, { status: 400 });
    }

    const payload = parseResult.data;
    const updateValues: Record<string, unknown> = {
      ...payload,
      updatedAt: new Date(),
    };

    if (payload.cron) {
      updateValues.nextRunAt = parseCronAndNextRun(payload.cron);
    }

    const [updated] = await withOrgContext(orgId, userId, async (tx) => {
      return tx
        .update(scheduledReports)
        .set(updateValues)
        .where(and(eq(scheduledReports.id, id), eq(scheduledReports.orgId, orgId)))
        .returning();
    });

    if (!updated) {
      return NextResponse.json({ error: 'Reporte programado no encontrado' }, { status: 404 });
    }

    return NextResponse.json({ report: updated });
  } catch (err: unknown) {
    const userErr = toUserError(err, correlationId);
    return NextResponse.json({ error: userErr.message }, { status: 400 });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const correlationId = getOrGenerateCorrelationId(req);
  try {
    const { orgId, userId } = await requireAuth(req, 'dashboard.delete');
    const { id } = await params;

    const [deleted] = await withOrgContext(orgId, userId, async (tx) => {
      return tx
        .delete(scheduledReports)
        .where(and(eq(scheduledReports.id, id), eq(scheduledReports.orgId, orgId)))
        .returning();
    });

    if (!deleted) {
      return NextResponse.json({ error: 'Reporte programado no encontrado' }, { status: 404 });
    }

    return NextResponse.json({ success: true, id });
  } catch (err: unknown) {
    const userErr = toUserError(err, correlationId);
    return NextResponse.json({ error: userErr.message }, { status: 400 });
  }
}
