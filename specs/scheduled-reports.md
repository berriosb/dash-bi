# Spec: Scheduled Reports

> El usuario programa un dashboard para recibirlo por email (PDF/PNG) o Slack en una frecuencia específica. Reusa el PDF worker + EmailProvider + query-engine. **Feature Tier 1 competitivo** — presente en Metabase, Preset, Hex, Omni; ausente en OSS BI. Es la razón #1 por la que gerencias pagan herramientas BI.

**Status:** Draft v0.1
**Prioridad:** P1 — alto impacto en retención y revenue enterprise
**Responsable:** codehak
**Depende de:** `export.md` (PDF worker), `email.md` (EmailProvider), `query-engine.md`, `multi-tenant.md`, `errors-ux.md`

---

## Cambios respecto a v0.1

> Primera versión. Promoción de Fase 2 a MVP (análisis competitivo 2026-07-22).

---

## 1. Objetivo

Que un usuario pueda:

1. **Programar un dashboard** para que se envíe cada lunes 9am a una lista de emails
2. **Elegir formato**: PDF (con branding) o link público a PNG
3. **Elegir cadencia**: diaria / semanal / mensual / cron custom
4. **Elegir destinatarios**: emails internos + externos (no requieren cuenta en dash-bi)
5. **Ver historial** de envíos: status (success/failed), correlation ID, preview
6. **Pausar / reanudar / eliminar** schedules desde la UI

**Caso de uso típico:**
> "Gerencia pide el dashboard de revenue cada lunes a primera hora. Lo programo con 3 destinatarios (CFO, CEO, board@empresa.com), formato PDF con branding, cadencia semanal."

---

## 2. Modelo de datos

### 2.1 Tabla `scheduled_reports`

```typescript
// db/schema.ts (extensión)
export const scheduledReports = pgTable('scheduled_reports', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
  dashboardId: uuid('dashboard_id').notNull().references(() => dashboards.id, { onDelete: 'cascade' }),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  
  // Schedule (cron-like)
  cron: text('cron').notNull(),                  // ej: '0 9 * * 1' (lunes 9am)
  timezone: text('timezone').notNull().default('America/Argentina/Buenos_Aires'),
  
  // Format
  format: text('format').$type<'pdf' | 'png-link'>().notNull().default('pdf'),
  includeBranding: boolean('include_branding').notNull().default(true),
  
  // Delivery
  recipients: jsonb('recipients').$type<Array<{
    email: string;
    name?: string;
  }>>().notNull(),
  
  // Slack delivery (opcional, Fase 1.1)
  slackWebhookUrl: text('slack_webhook_url'),     // cifrado en DB
  
  // State
  enabled: boolean('enabled').notNull().default(true),
  
  // Last run + next run
  lastRunAt: timestamp('last_run_at'),
  lastRunStatus: text('last_run_status').$type<'success' | 'failed' | 'skipped'>(),
  lastRunErrorCode: text('last_run_error_code'),
  lastRunCorrelationId: text('last_run_correlation_id'),
  nextRunAt: timestamp('next_run_at').notNull(),
  
  // Metadata
  title: text('title'),                            // ej: "Reporte semanal de Revenue"
  description: text('description'),
  
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  orgIdx: index('scheduled_reports_org_idx').on(t.orgId),
  nextRunIdx: index('scheduled_reports_next_run_idx').on(t.nextRunAt).where(sql`enabled = true`),
}));
```

### 2.2 Tabla `scheduled_report_runs`

Historial de ejecuciones (audit + debugging):

```typescript
export const scheduledReportRuns = pgTable('scheduled_report_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
  scheduledReportId: uuid('scheduled_report_id').notNull().references(() => scheduledReports.id, { onDelete: 'cascade' }),
  
  startedAt: timestamp('started_at').notNull().defaultNow(),
  completedAt: timestamp('completed_at'),
  status: text('status').$type<'running' | 'success' | 'failed' | 'skipped'>().notNull(),
  
  // Output
  fileUrl: text('file_url'),                       // signed URL del PDF (Fase 2: R2/S3; MVP: FS local)
  fileSizeBytes: integer('file_size_bytes'),
  
  // Recipients result
  deliveredTo: jsonb('delivered_to').$type<Array<{
    email: string;
    status: 'success' | 'failed';
    providerMessageId?: string;
    error?: string;
  }>>(),
  
  // Error tracking
  errorCode: text('error_code'),
  errorMessage: text('error_message'),
  correlationId: text('correlation_id').notNull(),
  
  // Metrics
  pdfRenderMs: integer('pdf_render_ms'),
  emailDeliveryMs: integer('email_delivery_ms'),
}, (t) => ({
  scheduleIdx: index('scheduled_report_runs_schedule_idx').on(t.scheduledReportId),
  statusIdx: index('scheduled_report_runs_status_idx').on(t.status, t.startedAt),
}));
```

---

## 3. Arquitectura

### 3.1 Flujo end-to-end

```
[CRON every 1 minute]
        ↓
Worker `scheduler-due` (BullMQ repeatable job)
        ↓
Para cada `scheduled_reports` con `nextRunAt <= now()`:
        ↓
Encola job `run-scheduled-report-{reportId}` en BullMQ
        ↓
[Job processor]
        ↓
[1] Mark `running` + correlation ID
        ↓
[2] Render PDF via PDF worker (reusa `enqueuePdfExport` de export.md)
        ↓
[3] Espera completion (polling o webhook)
        ↓
[4] Envía email con PDF adjunto (reusa EmailProvider)
        ↓ (opcional) Slack delivery
        ↓
[5] Mark `success` o `failed` + audit log
        ↓
[6] Compute `nextRunAt` based on cron + timezone
        ↓
[7] Update `scheduled_reports.lastRunAt` + `nextRunAt`
```

### 3.2 Componentes

#### 3.2.1 `lib/scheduler/cron.ts` — Cron parser

```typescript
import { CronExpressionParser } from 'cron-parser';

export function nextRunAt(cron: string, timezone: string, from = new Date()): Date {
  const interval = CronExpressionParser.parse(cron, {
    currentDate: from,
    tz: timezone,
  });
  return interval.next().toDate();
}

export function validateCron(cron: string): boolean {
  try {
    CronExpressionParser.parse(cron);
    return true;
  } catch {
    return false;
  }
}
```

#### 3.2.2 `lib/workers/scheduler-due.ts` — Cron dispatcher

```typescript
// BullMQ repeatable job que corre cada minuto
import { Queue, Worker } from 'bullmq';

const schedulerQueue = new Queue('scheduler-due', { connection: redis });

// Repetible: corre cada 60 segundos
await schedulerQueue.add(
  'dispatch',
  {},
  {
    repeat: { pattern: '* * * * *' },  // cada minuto
    removeOnComplete: 100,
    removeOnFail: 100,
  }
);

// Worker
const dispatcherWorker = new Worker(
  'scheduler-due',
  async () => {
    const dueReports = await withSystemContext(async () => {
      return db
        .select()
        .from(scheduledReports)
        .where(
          and(
            eq(scheduledReports.enabled, true),
            lte(scheduledReports.nextRunAt, new Date())
          )
        );
    });
    
    for (const report of dueReports) {
      // Lock para evitar doble dispatch (otro worker podría estar procesando)
      const locked = await tryLock(`scheduled_report:${report.id}`, 60_000);
      if (!locked) continue;
      
      // Encolar job de ejecución
      await runQueue.add('execute', { scheduledReportId: report.id });
    }
  },
  { connection: redis, concurrency: 1 }
);
```

#### 3.2.3 `lib/workers/run-scheduled-report.ts` — Executor

```typescript
const runQueue = new Queue('scheduled-report-run', { connection: redis });

const runWorker = new Worker(
  'scheduled-report-run',
  async (job) => {
    const { scheduledReportId } = job.data;
    const correlationId = `sched_${crypto.randomUUID()}`;
    
    // 1. Cargar report
    const report = await db.query.scheduledReports.findFirst({
      where: eq(scheduledReports.id, scheduledReportId),
    });
    if (!report) throw new Error('Report not found');
    
    // 2. Crear row de run
    const [run] = await db.insert(scheduledReportRuns).values({
      orgId: report.orgId,
      scheduledReportId,
      status: 'running',
      correlationId,
    }).returning();
    
    try {
      // 3. Render PDF via PDF worker (sync wait)
      const pdfJobId = await enqueuePdfExport({
        dashboardId: report.dashboardId,
        orgId: report.orgId,
        userId: report.createdBy,
        pageSize: 'Letter',
      });
      
      const pdfBuffer = await waitForPdfJob(pdfJobId, { timeoutMs: 60_000 });
      const pdfRenderMs = Date.now();
      
      // 4. Enviar emails
      const emailProvider = getEmailProvider();
      const deliveredTo: Array<{ email: string; status: string; providerMessageId?: string; error?: string }> = [];
      
      for (const recipient of report.recipients) {
        try {
          const result = await emailProvider.send({
            to: recipient.email,
            subject: subjectForReport(report),
            html: emailBodyForReport(report),
            attachments: [{
              filename: `${report.title ?? 'dashboard'}-${formatDate(new Date())}.pdf`,
              content: pdfBuffer,
              contentType: 'application/pdf',
            }],
          });
          deliveredTo.push({ email: recipient.email, status: 'success', providerMessageId: result.id });
        } catch (err) {
          deliveredTo.push({ email: recipient.email, status: 'failed', error: errorMessage(err) });
        }
      }
      
      // 5. (Opcional) Slack delivery
      if (report.slackWebhookUrl) {
        await deliverToSlack(report.slackWebhookUrl, pdfBuffer, report);
      }
      
      // 6. Update run as success
      const allFailed = deliveredTo.every(d => d.status === 'failed');
      await db.update(scheduledReportRuns)
        .set({
          status: allFailed ? 'failed' : 'success',
          completedAt: new Date(),
          deliveredTo,
          fileSizeBytes: pdfBuffer.byteLength,
          pdfRenderMs: pdfRenderMs - run.startedAt.getTime(),
          emailDeliveryMs: Date.now() - pdfRenderMs,
        })
        .where(eq(scheduledReportRuns.id, run.id));
      
      // 7. Compute next run + update parent
      const nextRun = nextRunAt(report.cron, report.timezone);
      await db.update(scheduledReports)
        .set({
          lastRunAt: new Date(),
          lastRunStatus: allFailed ? 'failed' : 'success',
          lastRunCorrelationId: correlationId,
          nextRunAt: nextRun,
        })
        .where(eq(scheduledReports.id, scheduledReportId));
      
      // 8. Audit
      await audit(report.orgId, report.createdBy, 'scheduled_report.executed', 
        `scheduled_report:${scheduledReportId}`,
        { correlationId, recipients: deliveredTo.length, status: allFailed ? 'failed' : 'success' }
      );
      
      return { success: true, correlationId };
    } catch (err) {
      // Mark as failed
      const userError = toUserError(err, correlationId);
      await db.update(scheduledReportRuns)
        .set({
          status: 'failed',
          completedAt: new Date(),
          errorCode: userError.code,
          errorMessage: userError.message,
        })
        .where(eq(scheduledReportRuns.id, run.id));
      
      await db.update(scheduledReports)
        .set({
          lastRunAt: new Date(),
          lastRunStatus: 'failed',
          lastRunErrorCode: userError.code,
          lastRunCorrelationId: correlationId,
          nextRunAt: nextRunAt(report.cron, report.timezone, new Date()),
        })
        .where(eq(scheduledReports.id, scheduledReportId));
      
      await audit(report.orgId, report.createdBy, 'scheduled_report.failed',
        `scheduled_report:${scheduledReportId}`,
        { correlationId, errorCode: userError.code, errorMessage: userError.message }
      );
      
      throw err;
    }
  },
  {
    connection: redis,
    concurrency: 3,        // max 3 reports simultáneos
    limiter: { max: 30, duration: 60_000 },  // 30/min global
  }
);

function waitForPdfJob(jobId: string, { timeoutMs }: { timeoutMs: number }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('PDF timeout')), timeoutMs);
    
    const interval = setInterval(async () => {
      const job = await pdfQueue.getJob(jobId);
      if (!job) {
        clearInterval(interval);
        clearTimeout(timer);
        return reject(new Error('PDF job not found'));
      }
      const state = await job.getState();
      if (state === 'completed') {
        clearInterval(interval);
        clearTimeout(timer);
        resolve((await job.returnvalue).buffer);
      } else if (state === 'failed') {
        clearInterval(interval);
        clearTimeout(timer);
        reject(new Error('PDF job failed'));
      }
    }, 1000);
  });
}
```

#### 3.2.4 Email templates

```typescript
// lib/email/templates/scheduled-report.ts
export const ScheduledReportEmail = (params: {
  title: string;
  dashboardUrl: string;
  orgName: string;
  frequency: string;
}) => ({
  subject: `${params.title} — ${formatDate(new Date())}`,
  html: `
    <!DOCTYPE html>
    <body style="font-family: -apple-system, system-ui, sans-serif; padding: 40px;">
      <div style="max-width: 600px; margin: 0 auto; background: white; padding: 32px;">
        <h1>${params.title}</h1>
        <p>Reporte programado de <strong>${params.orgName}</strong>.</p>
        <p>Frecuencia: ${params.frequency}</p>
        <p>📎 PDF adjunto a este email.</p>
        <p>📊 <a href="${params.dashboardUrl}">Ver dashboard interactivo →</a></p>
        <hr />
        <p style="font-size: 12px; color: #6b7280;">
          Para dejar de recibir estos reportes, contactá al administrador de ${params.orgName}.
        </p>
      </div>
    </body>
  `,
  text: `${params.title}\n\nReporte de ${params.orgName}.\nFrecuencia: ${params.frequency}\n\nVer dashboard: ${params.dashboardUrl}`,
});
```

---

## 4. API endpoints

### 4.1 Crear schedule

```typescript
// app/api/dashboards/[id]/schedules/route.ts

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { orgId, userId } = await getAuthContext(req);
  await requirePermission(userId, orgId, 'dashboard.schedule');
  
  const body = await req.json();
  const validated = CreateScheduledReportSchema.parse(body);
  
  // Validar cron
  if (!validateCron(validated.cron)) {
    throw new ValidationError('Invalid cron expression');
  }
  
  // Validar recipients (max 20)
  if (validated.recipients.length > 20) {
    throw new ValidationError('Máximo 20 destinatarios por schedule');
  }
  
  // Cifrar Slack webhook si existe
  const slackWebhookUrlEncrypted = validated.slackWebhookUrl 
    ? encryptApiKey(validated.slackWebhookUrl) 
    : null;
  
  const [schedule] = await db.insert(scheduledReports).values({
    orgId,
    dashboardId: params.id,
    createdBy: userId,
    cron: validated.cron,
    timezone: validated.timezone ?? 'America/Argentina/Buenos_Aires',
    format: validated.format,
    includeBranding: validated.includeBranding,
    recipients: validated.recipients,
    slackWebhookUrlEncrypted,
    title: validated.title,
    description: validated.description,
    nextRunAt: nextRunAt(validated.cron, validated.timezone ?? 'UTC'),
  }).returning();
  
  await audit(orgId, userId, 'scheduled_report.created', `scheduled_report:${schedule.id}`);
  return Response.json({ schedule });
}
```

### 4.2 Listar schedules

```typescript
// app/api/dashboards/[id]/schedules/route.ts
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const { orgId, userId } = await getAuthContext(req);
  await requirePermission(userId, orgId, 'dashboard.view');
  
  const schedules = await withOrgContext(orgId, userId, async () => {
    return db.query.scheduledReports.findMany({
      where: eq(scheduledReports.dashboardId, params.id),
      orderBy: desc(scheduledReports.createdAt),
    });
  });
  
  return Response.json({ schedules });
}
```

### 4.3 Historial de runs

```typescript
// app/api/scheduled-reports/[id]/runs/route.ts
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const { orgId, userId } = await getAuthContext(req);
  await requirePermission(userId, orgId, 'dashboard.view');
  
  const limit = parseInt(req.nextUrl.searchParams.get('limit') ?? '20');
  
  const runs = await withOrgContext(orgId, userId, async () => {
    return db.query.scheduledReportRuns.findMany({
      where: eq(scheduledReportRuns.scheduledReportId, params.id),
      orderBy: desc(scheduledReportRuns.startedAt),
      limit,
    });
  });
  
  return Response.json({ runs });
}
```

### 4.4 Toggle / delete / update

```typescript
// app/api/scheduled-reports/[id]/route.ts

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { orgId, userId } = await getAuthContext(req);
  await requirePermission(userId, orgId, 'dashboard.schedule');
  
  const body = await req.json();
  const validated = UpdateScheduledReportSchema.parse(body);
  
  if (validated.cron && !validateCron(validated.cron)) {
    throw new ValidationError('Invalid cron expression');
  }
  
  await withOrgContext(orgId, userId, async () => {
    await db.update(scheduledReports)
      .set({
        ...validated,
        nextRunAt: validated.cron ? nextRunAt(validated.cron, validated.timezone ?? 'UTC') : undefined,
        updatedAt: new Date(),
      })
      .where(eq(scheduledReports.id, params.id));
  });
  
  return Response.json({ ok: true });
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  // Soft delete o hard? Por default: pausa (enabled=false)
  // Hard delete solo si user lo pide explícito (botón "Eliminar definitivamente")
}
```

---

## 5. UI: gestión de schedules

### 5.1 Modal "Programar envío"

```
┌────────────────────────────────────────────────┐
│ Programar envío                                 │
│                                                │
│ Título del reporte                              │
│ [Reporte semanal de Revenue                 ]  │
│                                                │
│ Frecuencia                                     │
│ ◉ Semanal    ○ Diario    ○ Mensual    ○ Custom │
│                                                │
│ Día de la semana (si semanal)                    │
│ [Lunes ▼]                                      │
│                                                │
│ Hora                                           │
│ [09:00]  Timezone: [America/Argentina/BA ▼]    │
│                                                │
│ Formato                                         │
│ ● PDF adjunto                                  │
│ ○ Link a PNG                                   │
│                                                │
│ Branding                                        │
│ [✓] Incluir logo + colores de la org            │
│                                                │
│ Destinatarios (emails)                          │
│ ┌────────────────────────────────────────┐   │
│ │ cfo@empresa.com                     [×] │   │
│ │ ceo@empresa.com                     [×] │   │
│ │ board@empresa.com                    [×] │   │
│ └────────────────────────────────────────┘   │
│ [+ Agregar destinatario]                       │
│                                                │
│ Slack (opcional)                                │
│ [https://hooks.slack.com/services/...     ]    │
│ [✓] Enviar también a Slack                      │
│                                                │
│ Próximo envío: lunes 28 de julio, 09:00        │
│                                                │
│ [Cancelar]                       [Programar →]  │
└────────────────────────────────────────────────┘
```

### 5.2 Vista de detalle del dashboard

```
┌────────────────────────────────────────────────┐
│ 📊 Revenue Dashboard           [👁 View] [⚙]  │
├────────────────────────────────────────────────┤
│ ⏰ Schedules activos                           │
│ ┌────────────────────────────────────────────┐│
│ │ Reporte semanal — cfo@, ceo@, board@       ││
│ │ Cada lunes 9:00 · PDF                       ││
│ │ Próximo: 2026-07-28 09:00                   ││
│ │ Último: success el 2026-07-21 09:00:34     ││
│ │ [Pausar] [Editar] [Historial] [× Eliminar] ││
│ └────────────────────────────────────────────┘│
│ [+ Programar envío]                            │
└────────────────────────────────────────────────┘
```

### 5.3 Historial de runs

```
Historial de envíos
┌─────────────────────────────────────────────────────┐
│ ✓ 2026-07-21 09:00:34   3 destinatarios · 245KB   │
│   cfo@ ✓ · ceo@ ✓ · board@ ✓    [Ver PDF]         │
├─────────────────────────────────────────────────────┤
│ ✗ 2026-07-14 09:00:12   Error: connector.timeout   │
│   Reintentado 3 veces sin éxito   [Ver logs]      │
├─────────────────────────────────────────────────────┤
│ ✓ 2026-07-07 09:00:08   3 destinatarios · 198KB   │
│   cfo@ ✓ · ceo@ ✓ · board@ ✓    [Ver PDF]         │
└─────────────────────────────────────────────────────┘
```

---

## 6. Permisos

```typescript
// lib/auth/permissions.ts (extensión)

const PERMISSIONS = {
  // ... existentes
  'dashboard.schedule': ['admin', 'editor'],       // crear/editar/eliminar schedules
  'dashboard.viewSchedules': ['admin', 'editor', 'viewer'],
};
```

**Importante:** solo `admin` puede crear schedules (para evitar spam — un editor no debería poder agregar 100 destinatarios sin supervisión).

Actually, reconsidering: editor también es razonable para equipos chicos. Mantener ambos roles.

---

## 7. RLS

```sql
ALTER TABLE scheduled_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_report_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY org_isolation_scheduled_reports ON scheduled_reports
  USING (org_id = current_setting('app.current_org_id')::uuid);

CREATE POLICY org_isolation_scheduled_report_runs ON scheduled_report_runs
  USING (org_id = current_setting('app.current_org_id')::uuid);

-- Soft delete: cascade desde scheduled_reports cuando se elimina dashboard
-- (definido en schema con onDelete: 'cascade')
```

---

## 8. Cuotas y rate limits

```typescript
const SCHEDULED_REPORT_LIMITS = {
  free:        { maxSchedules: 2,   maxRecipientsPerSchedule: 5,  cronMinIntervalMinutes: 60 },   // max cada 1h
  pro:         { maxSchedules: 20,  maxRecipientsPerSchedule: 20, cronMinIntervalMinutes: 15 },   // max cada 15min
  enterprise:  { maxSchedules: -1,  maxRecipientsPerSchedule: -1, cronMinIntervalMinutes: 1 },    // sin límite
};
```

**Validación al crear schedule:**

```typescript
const quota = SCHEDULED_REPORT_LIMITS[org.plan];

// Count existing schedules
const count = await db.select({ count: count() })
  .from(scheduledReports)
  .where(and(
    eq(scheduledReports.orgId, orgId),
    eq(scheduledReports.enabled, true),
  ));
if (count[0].count >= quota.maxSchedules) {
  throw new QuotaExceededError(`Máximo ${quota.maxSchedules} schedules activos en plan ${org.plan}`);
}

// Validate cron interval
const intervalMinutes = getCronIntervalMinutes(validated.cron);
if (intervalMinutes < quota.cronMinIntervalMinutes) {
  throw new ValidationError(`Frecuencia mínima: cada ${quota.cronMinIntervalMinutes} minutos.`);
}

// Validate recipients
if (validated.recipients.length > quota.maxRecipientsPerSchedule) {
  throw new ValidationError(`Máximo ${quota.maxRecipientsPerSchedule} destinatarios.`);
}
```

---

## 9. Observabilidad

### 9.1 Logs estructurados

```typescript
logger.info({
  event: 'scheduled_report.executed',
  orgId: report.orgId,
  scheduledReportId: report.id,
  correlationId,
  pdfRenderMs,
  emailDeliveryMs,
  recipientsSuccess: deliveredTo.filter(d => d.status === 'success').length,
  recipientsFailed: deliveredTo.filter(d => d.status === 'failed').length,
  fileSizeBytes: pdfBuffer.byteLength,
});
```

### 9.2 Métricas Prometheus

```typescript
metrics.counter('scheduled_reports_executed_total', { org_id, status: 'success' | 'failed' });
metrics.histogram('scheduled_reports_pdf_render_ms', pdfRenderMs);
metrics.histogram('scheduled_reports_email_delivery_ms', emailDeliveryMs);
metrics.gauge('scheduled_reports_active', count);
```

### 9.3 Audit events

```typescript
// Audit events
'scheduled_report.created' | 'scheduled_report.updated' | 'scheduled_report.deleted'
| 'scheduled_report.executed' | 'scheduled_report.failed'
| 'scheduled_report.paused' | 'scheduled_report.resumed'
```

---

## 10. Acceptance criteria

- [ ] User puede crear schedule con cron, formato, recipients
- [ ] Validación de cron syntax + timezone
- [ ] Cron se ejecuta a la hora exacta (timezone-aware)
- [ ] Email se envía con PDF adjunto + branding
- [ ] Slack delivery funciona con webhook configurado
- [ ] Cada ejecución genera row en `scheduled_report_runs` con correlation ID
- [ ] History page muestra últimos 20 runs con status + error
- [ ] Retry automático: si falla 1 vez, reintentar 1 vez con backoff (no 3, para no spamear)
- [ ] Si falla definitivamente, email de notificación al admin de la org (no a destinatarios)
- [ ] Pausa / resume funciona (cambia `enabled` y respeta `nextRunAt`)
- [ ] Hard delete elimina schedule + runs (cascade)
- [ ] Cuotas enforced (max schedules, max recipients, min interval)
- [ ] RLS activo: cross-tenant access bloqueado
- [ ] Audit log de cada evento importante
- [ ] Métricas Prometheus: count, latency, error rate
- [ ] UI muestra preview del próximo envío (cron + recipients)
- [ ] Manual "Run now" button (debugging, MVP opcional)

---

## 11. Out of scope (MVP)

- ❌ Slack delivery (Fase 1.1 — schema ya está, implementación MVP es email-only)
- ❌ Webhooks personalizados (Microsoft Teams, Discord, etc.)
- ❌ HTML email con el dashboard embed (link al PDF, no inline)
- ❌ Custom email templates por org (default template en MVP)
- ❌ Calendar invite (.ics) attachment
- ❌ Digest mode (combinar múltiples dashboards en un email)
- ❌ Per-dashboard "send to all viewers" masivo
- ❌ Storage S3/R2 (Fase 2 — MVP usa FS local + URL firmada con TTL)
- ❌ Timezone per-recipient (MVP: 1 timezone por schedule)

---

## 12. Riesgos

| Riesgo | Mitigación |
|--------|-----------|
| Cron se dispara tarde (worker colgado) | Monitoring de "stuck runs" + alerta si `nextRunAt < now() - 5min` y no hay `lastRunAt` |
| Email provider caído bloquea envíos | Retry con backoff + notificación al admin tras N fallos + circuit breaker |
| PDF generation timeout >60s | Timeout 60s + cancel + retry 1 vez |
| Slack webhook inválido | Validación al crear + test opcional ("Send test message") |
| Cron malicioso (cada 1 minuto) | Quota `cronMinIntervalMinutes` enforced |
| Spam desde cuenta comprometida | Rate limit + alertas de volumen inusual |
| Destinatarios externos reciben data sensible | Warning al crear schedule: "Los destinatarios externos verán data del dashboard" |
| Re-run duplicado si worker crashea mid-job | Lock distribuido (Redis SETNX) + idempotency key por run |

---

## 13. Roadmap (Fase 2+)

**Fase 1.1 (semana siguiente al MVP):**
- Slack delivery implementation
- Manual "Run now" button
- Storage S3/R2 con signed URLs

**Fase 2:**
- Digest mode (combinar N dashboards en 1 email)
- HTML email inline con previews
- Custom templates por org
- Calendar invite (.ics)

**Fase 3:**
- Anomaly-triggered reports ("si revenue baja >10% esta semana, envíame alerta")
- Slack bot interactivo ("/dash-bi latest revenue")

---

## 14. Dependencias

```json
{
  "dependencies": {
    "cron-parser": "^4.9.0",
    "bullmq": "^5.34.0",
    "ioredis": "^5.4.2"
  }
}
```

Reusa (ya existentes):
- `lib/export/enqueue-pdf.ts` (PDF worker)
- `lib/email/index.ts` (EmailProvider)
- `lib/db/with-org.ts` (withOrgContext)
- `lib/audit/log.ts` (audit)
- `lib/errors/to-user-error.ts` (errors-ux)
- `lib/encryption.ts` (cifrado de Slack webhook)

---

## 15. Specs relacionados

- `export.md` — reusa `enqueuePdfExport` + pdf-worker
- `email.md` — reusa `EmailProvider` + `ScheduledReportEmail` template
- `multi-tenant.md` — `withOrgContext` + RLS policies
- `query-engine.md` — queries se ejecutan al renderizar el PDF
- `errors-ux.md` — `export.timeout`, `email.*` errors
- `dashboard-archetypes.md` — respeta archetype al renderizar
- `deployment.md` — workers corren en el mismo Docker Compose
- `testing.md` — e2e test: crear schedule, esperar ejecución, validar email (mock)
