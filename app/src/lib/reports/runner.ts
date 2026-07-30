import { db, withOrgContext } from '@/db/client';
import { scheduledReports, scheduledReportRuns } from '@/db/schema';
import { parseCronAndNextRun } from './cron';
import { enqueuePdfExport } from '@/lib/export/pdf-enqueue';
import { sendEmail } from '@/lib/email';
import { logger } from '@/lib/logger';
import { eq, lte, and } from 'drizzle-orm';

export interface ProcessDueReportsOptions {
  now?: Date;
}

export async function processDueScheduledReports(options: ProcessDueReportsOptions = {}) {
  const now = options.now ?? new Date();

  // 1. Fetch all enabled reports where nextRunAt <= now
  const dueReports = await db
    .select()
    .from(scheduledReports)
    .where(and(eq(scheduledReports.enabled, true), lte(scheduledReports.nextRunAt, now)));

  logger.info({ count: dueReports.length, now: now.toISOString() }, 'Running processDueScheduledReports');

  const results: Array<{ reportId: string; status: 'success' | 'failed'; runId: string }> = [];

  for (const report of dueReports) {
    const correlationId = `report-run-${report.id}-${Date.now()}`;
    let runId = '';

    try {
      // Create initial run record
      const [runRecord] = await withOrgContext(report.orgId, report.createdBy, async (tx) => {
        return tx
          .insert(scheduledReportRuns)
          .values({
            orgId: report.orgId,
            scheduledReportId: report.id,
            startedAt: new Date(),
            status: 'running',
            correlationId,
          })
          .returning();
      });

      runId = runRecord?.id ?? '';

      // Enqueue PDF generation job
      const jobId = await enqueuePdfExport({
        dashboardId: report.dashboardId,
        orgId: report.orgId,
        userId: report.createdBy,
      });

      // Send email to recipients
      const recipients = report.recipients.map((r) => r.email);
      await sendEmail({
        to: recipients,
        subject: `[dash-bi] Reporte programado: ${report.title || 'Dashboard Export'}`,
        html: `
          <div style="font-family: sans-serif; color: #1e293b;">
            <h2>Hola,</h2>
            <p>Adjunto encontrarás el reporte del dashboard programado.</p>
            <p><strong>Job ID:</strong> ${jobId}</p>
            <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
            <p style="font-size: 12px; color: #64748b;">Generado automáticamente por dash-bi.</p>
          </div>
        `,
      });

      // Update run status to success
      await withOrgContext(report.orgId, report.createdBy, async (tx) => {
        return tx
          .update(scheduledReportRuns)
          .set({
            status: 'success',
            completedAt: new Date(),
          })
          .where(eq(scheduledReportRuns.id, runId));
      });

      // Compute nextRunAt and update report
      const nextRunAt = parseCronAndNextRun(report.cron, now);
      await withOrgContext(report.orgId, report.createdBy, async (tx) => {
        return tx
          .update(scheduledReports)
          .set({
            lastRunAt: new Date(),
            lastRunStatus: 'success',
            lastRunCorrelationId: correlationId,
            nextRunAt,
            updatedAt: new Date(),
          })
          .where(eq(scheduledReports.id, report.id));
      });

      results.push({ reportId: report.id, status: 'success', runId });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error({ reportId: report.id, error: errMsg }, 'Scheduled report run failed');

      if (runId) {
        await withOrgContext(report.orgId, report.createdBy, async (tx) => {
          return tx
            .update(scheduledReportRuns)
            .set({
              status: 'failed',
              errorMessage: errMsg,
              completedAt: new Date(),
            })
            .where(eq(scheduledReportRuns.id, runId));
        });
      }

      results.push({ reportId: report.id, status: 'failed', runId });
    }
  }

  return { processed: results.length, results };
}
