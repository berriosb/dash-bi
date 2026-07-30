import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withOrgContext } from '@/db/client';
import { scheduledReports } from '@/db/schema';
import { requireAuth } from '@/lib/auth/request';
import { toUserError, getOrGenerateCorrelationId } from '@/lib/errors/to-user-error';
import { parseCronAndNextRun, isValidCron } from '@/lib/reports/cron';
import { eq, desc } from 'drizzle-orm';

const createReportSchema = z.object({
  dashboardId: z.string().uuid(),
  cron: z.string().refine(isValidCron, { message: 'Expresión cron inválida (debe tener 5 campos estándar)' }),
  timezone: z.string().optional().default('America/Santiago'),
  format: z.enum(['pdf', 'png-link']).optional().default('pdf'),
  includeBranding: z.boolean().optional().default(true),
  recipients: z.array(
    z.object({
      email: z.string().email(),
      name: z.string().optional(),
    })
  ).min(1, 'Debe especificar al menos un destinatario'),
  title: z.string().optional(),
  description: z.string().optional(),
});

export async function GET(req: Request) {
  const correlationId = getOrGenerateCorrelationId(req);
  try {
    const { orgId, userId } = await requireAuth(req, 'dashboard.view');

    const reports = await withOrgContext(orgId, userId, async (tx) => {
      return tx
        .select()
        .from(scheduledReports)
        .where(eq(scheduledReports.orgId, orgId))
        .orderBy(desc(scheduledReports.createdAt));
    });

    return NextResponse.json({ reports });
  } catch (err: unknown) {
    const userErr = toUserError(err, correlationId);
    return NextResponse.json({ error: userErr.message }, { status: 400 });
  }
}

export async function POST(req: Request) {
  const correlationId = getOrGenerateCorrelationId(req);
  try {
    const { orgId, userId } = await requireAuth(req, 'dashboard.create');
    const body = await req.json();

    const parseResult = createReportSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Datos inválidos', details: parseResult.error.flatten() },
        { status: 400 }
      );
    }

    const payload = parseResult.data;
    const nextRunAt = parseCronAndNextRun(payload.cron);

    const [report] = await withOrgContext(orgId, userId, async (tx) => {
      return tx
        .insert(scheduledReports)
        .values({
          orgId,
          dashboardId: payload.dashboardId,
          createdBy: userId,
          cron: payload.cron,
          timezone: payload.timezone,
          format: payload.format,
          includeBranding: payload.includeBranding,
          recipients: payload.recipients,
          enabled: true,
          nextRunAt,
          title: payload.title,
          description: payload.description,
        })
        .returning();
    });

    return NextResponse.json({ report }, { status: 201 });
  } catch (err: unknown) {
    const userErr = toUserError(err, correlationId);
    return NextResponse.json({ error: userErr.message }, { status: 400 });
  }
}
