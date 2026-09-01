# Spec: Alerts & Anomaly Notifications

> El usuario define reglas que disparan notificaciones cuando una métrica cruza un umbral o deja de llegar data. Recibe avisos por Slack, email, o webhook. **Feature Tier 2 competitiva** — presente en Metabase, Hex, Preset, Grafana; ausente en OSS BI. Es el #1 feature request post-MVP según feedback de early users.

**Status:** Draft v0.1
**Prioridad:** P1 — alto impacto en retención enterprise y diferenciador vs OSS BI genérico
**Responsable:** codehak
**Depende de:** `query-engine.md` (ejecuta la SQL de la métrica), `multi-tenant.md` (RLS), `audit/log.ts` (eventos), `email.md` (canal email), `scheduled-reports.md` (patrón BullMQ worker), `errors-ux.md`

---

## Cambios respecto a v0.1

> Primera versión. MVP cubre thresholds + Slack/email/webhook + UI mínima. Anomaly detection (rolling baseline, z-score) queda para Fase 2.

---

## 1. Objetivo

Que un usuario pueda:

1. **Definir una regla** sobre una métrica de un dashboard ("revenue < $50k", "orders count = 0 por 1h")
2. **Elegir canales** de notificación: Slack, email, o webhook custom
3. **Ver historial** de disparos (cuándo se cruzó el umbral, valor, canal usado, status)
4. **Pausar / reanudar / editar** reglas desde la UI
5. **Ver preview** del próximo check estimado

**Caso de uso típico:**
> "Si revenue diario baja de $50k durante 2 checks consecutivos, notificarme a Slack #revenue-alerts y por email al CFO."

**Caso secundario:**
> "Si no llegan orders en los últimos 30 min (data freshness), notificar a PagerDuty via webhook — el pipeline de ingest probablemente está caído."

---

## 2. Modelo de datos

### 2.1 Tabla `alert_rules`

```typescript
// db/schema.ts (extensión)
export const alertRules = pgTable('alert_rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
  dashboardId: uuid('dashboard_id').notNull().references(() => dashboards.id, { onDelete: 'cascade' }),
  createdBy: uuid('created_by').notNull().references(() => users.id),

  // Identidad humana
  name: text('name').notNull(),                       // ej: "Revenue diario bajo $50k"
  description: text('description'),

  // Definición de la métrica (query SQL)
  querySql: text('query_sql').notNull(),               // debe ser SELECT-only
  queryColumns: jsonb('query_columns').$type<{
    value: string;                                     // nombre de la columna del valor escalar
    timestamp?: string;                                // opcional, para series
  }>().notNull(),

  // Condición
  condition: jsonb('condition').$type<AlertCondition>().notNull(),
  // ver §2.4 — type discriminated union

  // Evaluación
  evaluationIntervalMinutes: integer('evaluation_interval_minutes').notNull().default(5),
  evaluationWindowMinutes: integer('evaluation_window_minutes').notNull().default(5),  // ventana de datos
  consecutiveBreachesToFire: integer('consecutive_breaches_to_fire').notNull().default(1),

  // Canales de notificación (1+ requerido)
  channels: jsonb('channels').$type<AlertChannelConfig[]>().notNull(),

  // Canales cifrados (Slack webhook URL, custom webhook secret)
  // Almacenamos cifrado, desciframos on-demand en worker

  // Estado
  enabled: boolean('enabled').notNull().default(true),

  // Throttling (evitar spam)
  cooldownMinutes: integer('cooldown_minutes').notNull().default(60),  // no re-disparar dentro de X min

  // Estado de la última evaluación
  lastEvaluatedAt: timestamp('last_evaluated_at'),
  lastEvaluationStatus: text('last_evaluation_status').$type<'ok' | 'breached' | 'error'>(),
  lastEvaluationError: text('last_evaluation_error'),
  consecutiveBreaches: integer('consecutive_breaches').notNull().default(0),  // counter interno
  lastFiredAt: timestamp('last_fired_at'),           // último disparo (resetea en cooldown)

  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  orgIdx: index('alert_rules_org_idx').on(t.orgId),
  dashboardIdx: index('alert_rules_dashboard_idx').on(t.dashboardId),
  dueIdx: index('alert_rules_due_idx').on(t.enabled, t.lastEvaluatedAt),
}));
```

### 2.2 Tabla `alert_events`

Historial de disparos (audit + debugging + UI):

```typescript
export const alertEvents = pgTable('alert_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
  alertRuleId: uuid('alert_rule_id').notNull().references(() => alertRules.id, { onDelete: 'cascade' }),

  firedAt: timestamp('fired_at').notNull().defaultNow(),
  breachedValue: jsonb('breached_value').$type<{ value: number | string | null; threshold: number | string }>().notNull(),

  // Delivery por canal
  deliveryStatus: jsonb('delivery_status').$type<Array<{
    channelType: 'slack' | 'email' | 'webhook';
    status: 'success' | 'failed' | 'skipped';
    error?: string;
    providerMessageId?: string;
  }>>().notNull(),

  correlationId: text('correlation_id').notNull(),

  // Resumen (cache para UI rápida)
  title: text('title').notNull(),                       // ej: "Revenue < $50k"
  dashboardTitle: text('dashboard_title').notNull(),
}, (t) => ({
  ruleIdx: index('alert_events_rule_idx').on(t.alertRuleId, t.firedAt),
  orgIdx: index('alert_events_org_idx').on(t.orgId, t.firedAt),
}));
```

### 2.3 Tabla `alert_subscriptions` (opt-in, MVP Fase 1.1)

Si los usuarios pueden subscribirse a reglas existentes (sin ser creadores):

```typescript
// MVP: NO incluir. Las reglas se notifican a canales fijos de la org.
// Fase 1.1: agregar `alert_subscriptions` para "subscribe to rule X, notify me at email Y"
```

### 2.4 Discriminated union para `condition`

```typescript
// lib/alerts/types.ts
export type AlertCondition =
  | {
      kind: 'threshold_above';
      threshold: number;          // value > threshold
    }
  | {
      kind: 'threshold_below';
      threshold: number;          // value < threshold
    }
  | {
      kind: 'threshold_outside_range';
      min: number;
      max: number;                // value < min OR value > max
    }
  | {
      kind: 'equals';
      value: number;               // value === value
    }
  | {
      kind: 'missing_data';
      windowMinutes: number;      // no hay rows en los últimos X min
    };

export type AlertChannelConfig =
  | {
      type: 'slack';
      webhookUrl: string;         // cifrado en DB (ver §6.3)
      channelLabel: string;       // ej: "#revenue-alerts"
    }
  | {
      type: 'email';
      recipients: string[];       // emails internos o externos
      subject: string;             // template subject
    }
  | {
      type: 'webhook';
      url: string;                 // cifrado en DB
      headers?: Record<string, string>;  // ej: { Authorization: 'Bearer xxx' }
    };
```

---

## 3. Arquitectura

### 3.1 Flujo end-to-end

```
[CRON every 1 minute — dispatcher]
        ↓
Worker `alert-due` (BullMQ repeatable job)
        ↓
Query: alert_rules WHERE enabled=true
        AND (lastEvaluatedAt IS NULL OR lastEvaluatedAt < now() - evaluationIntervalMinutes)
        ↓
Para cada regla due:
        ↓
[Per-rule evaluation job]
        ↓
[1] Load rule + descifrar channel secrets
        ↓
[2] Execute querySql (read-only DB role, validated por validateQuery)
        ↓
[3] Apply condition to result.value
        ↓
[4] Update consecutiveBreaches counter
        ↓ (if condition breached AND counter >= consecutiveBreachesToFire AND cooldown expired)
        ↓
[5] Create alert_event row
        ↓
[6] For each channel: send notification (Slack / email / webhook)
        ↓
[7] Update alert_rule.lastFiredAt + reset counter
        ↓
[8] Audit alert.fired + alert.delivered (one per channel)
        ↓ (else, only update lastEvaluatedAt + status)
```

### 3.2 Componentes

#### 3.2.1 `lib/alerts/cron.ts` — evaluation scheduler

Reusa `lib/reports/cron.ts` (validación cron). Para alertas MVP usamos interval simple (no cron expression).

```typescript
import { addMinutes } from 'date-fns';

export function isRuleDue(rule: AlertRule, now = new Date()): boolean {
  if (!rule.enabled) return false;
  if (!rule.lastEvaluatedAt) return true;
  const dueAt = addMinutes(rule.lastEvaluatedAt, rule.evaluationIntervalMinutes);
  return dueAt <= now;
}

export function isCooldownExpired(rule: AlertRule, now = new Date()): boolean {
  if (!rule.lastFiredAt) return true;
  const cooldownEnd = addMinutes(rule.lastFiredAt, rule.cooldownMinutes);
  return cooldownEnd <= now;
}
```

#### 3.2.2 `lib/alerts/condition.ts` — Evaluator

```typescript
import type { AlertCondition } from './types';

export interface ConditionResult {
  breached: boolean;
  value: number | string | null;
  threshold: number | string;
}

export function evaluateCondition(
  condition: AlertCondition,
  value: number | string | null,
): ConditionResult {
  if (value === null) {
    // Para threshold: null NO breach (asumimos data missing es caso aparte)
    return { breached: false, value, threshold: conditionThreshold(condition) };
  }

  const numValue = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(numValue)) {
    throw new Error(`Cannot evaluate condition on non-numeric value: ${value}`);
  }

  switch (condition.kind) {
    case 'threshold_above':
      return { breached: numValue > condition.threshold, value, threshold: condition.threshold };
    case 'threshold_below':
      return { breached: numValue < condition.threshold, value, threshold: condition.threshold };
    case 'threshold_outside_range':
      return {
        breached: numValue < condition.min || numValue > condition.max,
        value,
        threshold: `${condition.min}..${condition.max}`,
      };
    case 'equals':
      return { breached: numValue === condition.value, value, threshold: condition.value };
    case 'missing_data':
      // missing_data breach se evalúa ANTES del condition (en el worker)
      return { breached: false, value, threshold: condition.windowMinutes };
  }
}

function conditionThreshold(c: AlertCondition): number | string {
  switch (c.kind) {
    case 'threshold_above':
    case 'threshold_below':
      return c.threshold;
    case 'threshold_outside_range':
      return `${c.min}..${c.max}`;
    case 'equals':
      return c.value;
    case 'missing_data':
      return c.windowMinutes;
  }
}
```

#### 3.2.3 `lib/alerts/channels/` — Channel implementations

```typescript
// lib/alerts/channels/slack.ts
export interface SlackChannel {
  send(params: { webhookUrl: string; payload: SlackPayload }): Promise<{ ok: true; ts?: string } | { ok: false; error: string }>;
}

export async function sendSlackAlert(
  webhookUrl: string,
  rule: { name: string; dashboardTitle: string; breachedValue: any },
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text: `🚨 *${rule.name}*`,
        blocks: [
          { type: 'section', text: { type: 'mrkdwn', text: `🚨 *${rule.name}*` } },
          { type: 'section', fields: [
            { type: 'mrkdwn', text: `*Dashboard:*\n${rule.dashboardTitle}` },
            { type: 'mrkdwn', text: `*Valor actual:*\n\`${rule.breachedValue.value}\`` },
            { type: 'mrkdwn', text: `*Threshold:*\n\`${rule.breachedValue.threshold}\`` },
          ] },
        ],
      }),
    });
    if (!res.ok) return { ok: false, error: `Slack ${res.status}: ${await res.text()}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

// lib/alerts/channels/email.ts (reusa EmailProvider)
export async function sendEmailAlert(
  recipients: string[],
  subject: string,
  htmlBody: string,
): Promise<{ ok: boolean; error?: string }> {
  const provider = getEmailProvider();
  try {
    const result = await provider.send({ to: recipients.join(','), subject, html: htmlBody });
    return { ok: true, error: undefined };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

// lib/alerts/channels/webhook.ts
export async function sendWebhookAlert(
  url: string,
  headers: Record<string, string> | undefined,
  payload: object,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(headers ?? {}),
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return { ok: false, error: `Webhook ${res.status}: ${await res.text()}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}
```

#### 3.2.4 `lib/workers/alert-due.ts` — Dispatcher

```typescript
// BullMQ repeatable job que corre cada minuto
const dispatcherQueue = new Queue('alert-due', { connection: redis });

await dispatcherQueue.add(
  'dispatch',
  {},
  {
    repeat: { pattern: '* * * * *' },  // cada minuto
    removeOnComplete: 100,
    removeOnFail: 100,
  },
);

const dispatcherWorker = new Worker(
  'alert-due',
  async () => {
    const dueRules = await withSystemContext(async () => {
      return db
        .select()
        .from(alertRules)
        .where(eq(alertRules.enabled, true));
    });

    for (const rule of dueRules) {
      if (!isRuleDue(rule)) continue;
      // Lock para evitar double-dispatch
      const locked = await tryLock(`alert_rule:${rule.id}`, 60_000);
      if (!locked) continue;
      // Encolar evaluación
      await evaluateQueue.add('evaluate', { alertRuleId: rule.id });
    }
  },
  { connection: redis, concurrency: 1 },
);
```

#### 3.2.5 `lib/workers/alert-evaluate.ts` — Per-rule evaluator

```typescript
const evaluateQueue = new Queue('alert-evaluate', { connection: redis });

const evaluateWorker = new Worker(
  'alert-evaluate',
  async (job) => {
    const { alertRuleId } = job.data;
    const correlationId = `alert_${crypto.randomUUID()}`;

    // 1. Load rule + descifrar secrets
    const rule = await withOrgContext(rule.orgId, async (tx) => {
      return tx.query.alertRules.findFirst({ where: eq(alertRules.id, alertRuleId) });
    });
    if (!rule) throw new Error('Rule not found');

    // 2. Execute query SQL (read-only role + validated)
    let queryResult: { value: number | string | null };
    try {
      const result = await executeReadOnlyQuery(rule.querySql, rule.orgId, {
        maxRows: 1,
        timeoutMs: 30_000,
      });
      queryResult = extractValue(result, rule.queryColumns.value);
    } catch (err) {
      await updateRuleStatus(rule, 'error', errorMessage(err));
      await audit(rule.orgId, rule.createdBy, 'alert.evaluation_failed', `alert_rule:${rule.id}`, {
        correlationId, errorMessage: errorMessage(err),
      });
      throw err;
    }

    // 3. Apply condition
    const condResult = evaluateCondition(rule.condition, queryResult.value);
    const breached = condResult.breached;

    // 4. Update consecutiveBreaches
    const newCounter = breached ? rule.consecutiveBreaches + 1 : 0;
    const shouldFire = breached && newCounter >= rule.consecutiveBreachesToFire;

    await db.update(alertRules)
      .set({
        lastEvaluatedAt: new Date(),
        lastEvaluationStatus: 'ok',
        lastEvaluationError: null,
        consecutiveBreaches: newCounter,
      })
      .where(eq(alertRules.id, rule.id));

    // 5. Fire if needed
    if (!shouldFire) return { breached, fired: false };
    if (!isCooldownExpired(rule)) {
      await audit(rule.orgId, rule.createdBy, 'alert.evaluation_suppressed', `alert_rule:${rule.id}`, {
        correlationId, reason: 'cooldown', cooldownMinutes: rule.cooldownMinutes,
      });
      return { breached, fired: false };
    }

    // 6. Create alert_event
    const [event] = await db.insert(alertEvents).values({
      orgId: rule.orgId,
      alertRuleId: rule.id,
      breachedValue: { value: condResult.value, threshold: condResult.threshold },
      deliveryStatus: [],   // se actualiza después
      correlationId,
      title: rule.name,
      dashboardTitle: 'TODO: load dashboard title',
    }).returning();

    // 7. Deliver to channels
    const deliveryResults: Array<{ channelType: string; status: string; error?: string }> = [];
    for (const channel of rule.channels) {
      const decryptedChannel = decryptChannel(channel);
      const result = await deliverToChannel(decryptedChannel, rule, condResult);
      deliveryResults.push({ channelType: channel.type, ...result });
    }

    // 8. Update event + rule
    await db.update(alertEvents)
      .set({ deliveryStatus: deliveryResults })
      .where(eq(alertEvents.id, event.id));
    await db.update(alertRules)
      .set({ lastFiredAt: new Date(), consecutiveBreaches: 0 })
      .where(eq(alertRules.id, rule.id));

    // 9. Audit
    await audit(rule.orgId, rule.createdBy, 'alert.fired', `alert_rule:${rule.id}`, {
      correlationId, breachedValue: condResult.value, threshold: condResult.threshold,
      channelsDelivered: deliveryResults.filter(r => r.status === 'success').length,
    });

    return { breached, fired: true };
  },
  {
    connection: redis,
    concurrency: 5,           // hasta 5 reglas simultáneas
    limiter: { max: 100, duration: 60_000 },  // 100/min global
  },
);
```

### 3.3 Validación de `querySql`

Toda `querySql` debe pasar por `validate-query` (ver `specs/connectors.md` §4):

```typescript
import { validateQuery } from '@/lib/query-engine/validate-query';

function validateRuleQuery(sql: string): void {
  validateQuery({
    kind: 'sql',
    sql,
    dialect: 'postgres',
  });
  // validateQuery throws si falla:
  // - DDL/DML detectado
  // - Sin LIMIT
  // - Tablas del sistema (pg_*, information_schema)
  // - Funciones peligrosas
}
```

Adicional: al crear/editar la regla, **auto-inject LIMIT 1** si la query no tiene LIMIT.

### 3.4 Cifrado de channel secrets

```typescript
// lib/alerts/crypto.ts
import { encryptApiKey, decryptApiKey } from '@/lib/security/encryption';

function encryptChannelSecrets(rule: AlertRuleInsert): AlertRuleInsert {
  return {
    ...rule,
    channels: rule.channels.map(c => {
      if (c.type === 'slack') return { ...c, webhookUrl: encryptApiKey(c.webhookUrl) };
      if (c.type === 'webhook') return { ...c, url: encryptApiKey(c.url) };
      return c;
    }),
  };
}

function decryptChannel(channel: AlertChannelConfig): AlertChannelConfig {
  if (channel.type === 'slack') return { ...channel, webhookUrl: decryptApiKey(channel.webhookUrl) };
  if (channel.type === 'webhook') return { ...channel, url: decryptApiKey(channel.url) };
  return channel;
}
```

---

## 4. API endpoints

### 4.1 Crear regla

```typescript
// app/api/dashboards/[id]/alerts/route.ts

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { orgId, userId } = await getAuthContext(req);
  await requirePermission(userId, orgId, 'dashboard.alert');

  const body = await req.json();
  const validated = CreateAlertRuleSchema.parse(body);

  // Validar SQL
  validateRuleQuery(validated.querySql);
  // Auto-inject LIMIT 1 si falta
  const sqlWithLimit = ensureLimit(validated.querySql, 1);

  // Validar channels
  if (validated.channels.length === 0) throw new ValidationError('Al menos un canal requerido');
  for (const ch of validated.channels) {
    if (ch.type === 'email' && ch.recipients.length > 10) {
      throw new ValidationError('Máximo 10 destinatarios por canal email');
    }
  }

  // Validar cron (reusa reports/cron.ts)
  if (validated.evaluationIntervalMinutes < 1 || validated.evaluationIntervalMinutes > 1440) {
    throw new ValidationError('evaluationIntervalMinutes debe estar entre 1 y 1440 (24h)');
  }

  // Cifrar secrets
  const channelsEncrypted = encryptChannelSecrets(validated.channels);

  const [rule] = await withOrgContext(orgId, userId, async (tx) => {
    return tx.insert(alertRules).values({
      orgId,
      dashboardId: params.id,
      createdBy: userId,
      ...validated,
      querySql: sqlWithLimit,
      channels: channelsEncrypted,
    }).returning();
  });

  await audit(orgId, userId, 'alert.created', `alert_rule:${rule.id}`, { name: rule.name });
  return Response.json({ rule });
}
```

### 4.2 Listar reglas

```typescript
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const { orgId, userId } = await getAuthContext(req);
  await requirePermission(userId, orgId, 'dashboard.view');

  const rules = await withOrgContext(orgId, userId, async (tx) => {
    return tx.query.alertRules.findMany({
      where: eq(alertRules.dashboardId, params.id),
      orderBy: desc(alertRules.createdAt),
    });
  });

  // Devolver SIN secrets descifrados (webhookUrl cifrada se omite)
  const sanitized = rules.map(r => ({
    ...r,
    channels: r.channels.map(c => {
      if (c.type === 'slack') return { ...c, webhookUrl: '***' };
      if (c.type === 'webhook') return { ...c, url: '***' };
      return c;
    }),
  }));

  return Response.json({ rules: sanitized });
}
```

### 4.3 Test de canal (manual)

```typescript
// app/api/alert-rules/[id]/test-channel/route.ts

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { orgId, userId } = await getAuthContext(req);
  await requirePermission(userId, orgId, 'dashboard.alert');

  const body = await req.json();
  const { channelIndex } = body;

  const rule = await withOrgContext(orgId, userId, async (tx) => {
    return tx.query.alertRules.findFirst({ where: eq(alertRules.id, params.id) });
  });
  if (!rule) throw new NotFoundError();

  const channel = rule.channels[channelIndex];
  if (!channel) throw new ValidationError('Channel index inválido');

  const decrypted = decryptChannel(channel);
  const result = await deliverToChannel(decrypted, rule, {
    value: 42,
    threshold: rule.condition.kind === 'threshold_below' ? rule.condition.threshold : 'test',
  });

  return Response.json({ result });
}
```

### 4.4 Historial de disparos

```typescript
// app/api/alert-rules/[id]/events/route.ts

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const { orgId, userId } = await getAuthContext(req);
  await requirePermission(userId, orgId, 'dashboard.view');

  const limit = parseInt(req.nextUrl.searchParams.get('limit') ?? '50');

  const events = await withOrgContext(orgId, userId, async (tx) => {
    return tx.query.alertEvents.findMany({
      where: eq(alertEvents.alertRuleId, params.id),
      orderBy: desc(alertEvents.firedAt),
      limit,
    });
  });

  return Response.json({ events });
}
```

### 4.5 Toggle / update / delete

Estructura idéntica a `scheduled_reports` (PATCH para update, DELETE para eliminar, columna `enabled` para pausar).

---

## 5. UI: gestión de alertas

### 5.1 Modal "Crear alerta"

Accesible desde el dashboard detail (`/dashboards/[id]`) — botón "+ Nueva alerta".

```
┌──────────────────────────────────────────────────┐
│ Nueva alerta                                       │
│                                                    │
│ Nombre                                              │
│ [Revenue diario bajo $50k                      ]  │
│                                                    │
│ Descripción (opcional)                              │
│ [Cuando revenue < $50k por 2 checks seguidos  ]  │
│                                                    │
│ Métrica                                             │
│ ┌────────────────────────────────────────────┐   │
│ │ SQL:                                        │   │
│ │ SELECT SUM(amount) AS revenue                │   │
│ │ FROM orders                                  │   │
│ │ WHERE created_at > NOW() - INTERVAL '1 day' │   │
│ │ LIMIT 1                                     │   │
│ │                                              │   │
│ │ Columna del valor: [revenue           ▼]    │   │
│ │                                              │   │
│ │ [✓ Probar query]   Último valor: $48,200     │   │
│ └────────────────────────────────────────────┘   │
│                                                    │
│ Condición                                           │
│ ◉ Por debajo del umbral                             │
│ ● Por encima del umbral                             │
│ ○ Fuera del rango (min..max)                       │
│ ○ Igual a valor exacto                              │
│ ○ Sin datos (data freshness)                        │
│                                                    │
│ Umbral: [50000]                                     │
│ (ventana para "Sin datos": [30] minutos)            │
│                                                    │
│ Checks consecutivos para disparar: [2]              │
│ (evita alertas por un spike momentáneo)              │
│                                                    │
│ Frecuencia de evaluación                             │
│ ◉ Cada 5 min    ○ Cada 15 min    ○ Cada 1 h       │
│ ○ Custom: [15] minutos                              │
│                                                    │
│ Cooldown (no re-disparar antes de X)                │
│ [60] minutos                                         │
│                                                    │
│ Canales de notificación                             │
│ ┌────────────────────────────────────────────┐   │
│ │ ◉ Slack                                      │   │
│ │   Webhook URL: [https://hooks.slack.com/..]  │   │
│ │   Etiqueta: [#revenue-alerts              ]  │   │
│ │   [Probar Slack]                             │   │
│ │                                              │   │
│ │ ◉ Email                                      │   │
│ │   Destinatarios:                              │   │
│ │   - cfo@empresa.com                  [×]    │   │
│ │   - ceo@empresa.com                  [×]    │   │
│ │   [+ Agregar]                                │   │
│ │                                              │   │
│ │ ○ Webhook custom                             │   │
│ │   URL: [                                  ]  │   │
│ │   Headers (JSON): [                       ]  │   │
│ │                                              │   │
│ │ [+ Agregar canal]                            │   │
│ └────────────────────────────────────────────┘   │
│                                                    │
│ ⚠ Las alertas disparan notificaciones externas     │
│                                                    │
│ [Cancelar]                            [Crear →]    │
└──────────────────────────────────────────────────┘
```

### 5.2 Lista de alertas en dashboard detail

```
┌────────────────────────────────────────────────┐
│ 📊 Revenue Dashboard           [👁 View] [�]  │
├────────────────────────────────────────────────┤
│ 🚨 Alertas activas                              │
│ ┌────────────────────────────────────────────┐│
│ │ Revenue diario bajo $50k                    ││
│ │ Condición: revenue < $50k                   ││
│ │ Canales: Slack #revenue-alerts, Email CFO   ││
│ │ Evalúa cada 5 min · Cooldown 60 min         ││
│ │ Estado: enabled · 0 checks consecutivos     ││
│ │ Último disparo: 2026-08-15 14:35 (success)   ││
│ │ [Pausar] [Editar] [Historial] [× Eliminar]  ││
│ └────────────────────────────────────────────┘│
│ [+ Nueva alerta]                                │
└────────────────────────────────────────────────┘
```

### 5.3 Historial de disparos

```
Historial de alertas
┌─────────────────────────────────────────────────────┐
│ ✓ 2026-08-15 14:35   revenue=$48,200 (threshold: 50k)│
│   Slack ✓ · Email CFO ✓                            │
│   correlation_id: alert_a3f9...                     │
├─────────────────────────────────────────────────────┤
│ ✗ 2026-08-10 09:05   Slack delivery failed          │
│   revenue=$42,100 · Email CFO ✓                   │
│   Error: Slack webhook returned 410                │
├─────────────────────────────────────────────────────┤
│ ✓ 2026-08-05 16:20   revenue=$45,800              │
│   Slack ✓ · Email CFO ✓                            │
└─────────────────────────────────────────────────────┘
```

---

## 6. Permisos

```typescript
// lib/auth/permissions.ts (extensión)

const PERMISSIONS = {
  // ... existentes
  'dashboard.alert': ['admin', 'editor'],             // crear/editar/eliminar alertas
  'dashboard.viewAlerts': ['admin', 'editor', 'viewer'],
};
```

---

## 7. RLS

```sql
ALTER TABLE alert_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY org_isolation_alert_rules ON alert_rules
  USING (org_id = current_setting('app.current_org_id')::uuid);

CREATE POLICY org_isolation_alert_events ON alert_events
  USING (org_id = current_setting('app.current_org_id')::uuid);
```

---

## 8. Cuotas y rate limits

```typescript
const ALERT_LIMITS = {
  free:        { maxRules: 3,   maxChannelsPerRule: 2,  minIntervalMinutes: 15 },
  pro:         { maxRules: 30,  maxChannelsPerRule: 5,  minIntervalMinutes: 5  },
  enterprise:  { maxRules: -1,  maxChannelsPerRule: -1, minIntervalMinutes: 1  },
};
```

**Validación al crear regla:**

```typescript
const quota = ALERT_LIMITS[org.plan];

const count = await db.select({ count: count() })
  .from(alertRules)
  .where(and(eq(alertRules.orgId, orgId), eq(alertRules.enabled, true)));
if (count[0].count >= quota.maxRules) {
  throw new QuotaExceededError(`Máximo ${quota.maxRules} alertas activas en plan ${org.plan}`);
}

if (validated.evaluationIntervalMinutes < quota.minIntervalMinutes) {
  throw new ValidationError(`Intervalo mínimo: cada ${quota.minIntervalMinutes} minutos.`);
}

if (validated.channels.length > quota.maxChannelsPerRule) {
  throw new ValidationError(`Máximo ${quota.maxChannelsPerRule} canales por alerta.`);
}
```

---

## 9. Observabilidad

### 9.1 Logs estructurados

```typescript
logger.info({
  event: 'alert.fired',
  orgId, alertRuleId, correlationId,
  breachedValue, threshold,
  channelsDelivered, channelsFailed,
});

logger.warn({
  event: 'alert.evaluation_failed',
  orgId, alertRuleId,
  errorMessage,
});

logger.info({
  event: 'alert.evaluation_suppressed',
  orgId, alertRuleId, reason: 'cooldown',
});
```

### 9.2 Métricas Prometheus

```typescript
metrics.counter('alerts_evaluated_total', { org_id, status: 'ok' | 'breached' | 'error' });
metrics.counter('alerts_fired_total', { org_id, condition_kind });
metrics.counter('alerts_delivered_total', { org_id, channel_type, status: 'success' | 'failed' });
metrics.histogram('alerts_evaluation_ms', evaluationMs);
```

### 9.3 Audit events

```typescript
// Extender `lib/audit/events.ts`:

| 'alert.created'
| 'alert.updated'
| 'alert.deleted'
| 'alert.paused'
| 'alert.resumed'
| 'alert.fired'
| 'alert.delivered'           // one per successful channel delivery
| 'alert.delivery_failed'      // one per failed channel delivery
| 'alert.evaluation_failed'
| 'alert.evaluation_suppressed'  // cooldown active, breach not fired
```

---

## 10. Acceptance criteria

- [ ] User puede crear alerta con SQL + condición + 1+ canales
- [ ] `querySql` validada por `validate-query` (SELECT-only, LIMIT auto-inject)
- [ ] Canal Slack recibe mensaje con bloques (title, value, threshold, dashboard)
- [ ] Canal Email entrega al subject/body configurados
- [ ] Canal Webhook hace POST con payload JSON
- [ ] "Probar canal" funciona sin esperar el próximo check
- [ ] Evaluación corre cada X min (configurable, default 5)
- [ ] `consecutiveBreachesToFire` previene disparo por spike momentáneo
- [ ] `cooldownMinutes` previene spam
- [ ] Regla pausada (`enabled=false`) no se evalúa
- [ ] Regla eliminada hace cascade sobre `alert_events`
- [ ] Historial muestra últimos N disparos con status por canal
- [ ] Cuotas enforced (max rules, max channels, min interval)
- [ ] RLS activo: cross-tenant access bloqueado
- [ ] Channel secrets (webhook URLs) cifrados en DB
- [ ] Audit log de cada evento importante
- [ ] Métricas Prometheus: counter, histogram
- [ ] UI muestra preview del próximo check

---

## 11. Out of scope (MVP)

- ❌ Anomaly detection (rolling baseline, z-score) — Fase 2
- ❌ Composite conditions (`revenue < X AND orders > Y`) — Fase 2
- ❌ Rate-of-change (`revenue dropped > 20% vs yesterday`) — Fase 2
- ❌ Per-user subscriptions (`alert_subscriptions` table) — Fase 1.1
- ❌ Slack interactive (acknowledge button) — Fase 2
- ❌ Microsoft Teams / Discord / PagerDuty native integrations — Fase 2 (webhook custom cubre el caso)
- ❌ Anomaly-triggered scheduled reports (combination) — Fase 3
- ❌ Alert templates library ("revenue alerts") — Fase 2
- ❌ In-app notification center (bell icon) — Fase 2
- ❌ SMS / phone call channels — Fase 3

---

## 12. Riesgos

| Riesgo | Mitigación |
|--------|-----------|
| User crea query SQL pesada → DoS | `validate-query` (LIMIT + timeout) + read-only role + 30s timeout por query |
| Slack webhook leaked → spam externo | cifrado en DB + no loggear URLs + audit |
| Alert fire storm (condición rota dispara 1000 veces) | `cooldownMinutes` + `consecutiveBreachesToFire` + rate limit por org |
| Email provider caído bloquea notificaciones | Retry con backoff + circuit breaker + notificar admin tras N fallos |
| Eval loop se atasca con queries lentas | BullMQ concurrency: 5 + timeout 30s + métricas de latency |
| Regla queda "atascada" en breach permanente | Auto-reset consecutiveBreaches a 0 tras cada fire |
| Dashboard eliminado con alertas activas | `onDelete: cascade` borra reglas + eventos |
| Cooldown mal configurado (0 min) | Validación: `cooldownMinutes >= 1` |
| Canal email con 1000 destinatarios | Validación: `recipients.length <= 10` |

---

## 13. Roadmap (Fase 2+)

**Fase 1.1 (inmediato post-MVP):**
- `alert_subscriptions` (per-user subscribe a reglas existentes)
- "In-app notification center" (bell icon en Header)
- Slack interactive (acknowledge button via webhook)

**Fase 2:**
- Anomaly detection (rolling baseline 7-day window, z-score threshold)
- Composite conditions (`AND` / `OR`)
- Rate-of-change (`revenue dropped > X% vs previous period`)
- Alert templates library (preset rules per industry)
- Microsoft Teams / Discord / PagerDuty native channels

**Fase 3:**
- Anomaly-triggered scheduled reports
- ML-based threshold recommendation
- Alert root-cause correlation

---

## 14. Dependencias

```json
{
  "dependencies": {
    "bullmq": "^5.34.0",          // ya existente
    "ioredis": "^5.4.2",           // ya existente
    "date-fns": "^3.0.0"           // ya existente (vía otras deps)
  }
}
```

Reusa (ya existentes):
- `lib/reports/cron.ts` — patrón cron/interval helper
- `lib/email/index.ts` — EmailProvider (canal email)
- `lib/db/with-org.ts` — withOrgContext (multi-tenant RLS)
- `lib/audit/log.ts` — audit()
- `lib/security/encryption.ts` — encryptApiKey/decryptApiKey (Slack + webhook URLs)
- `lib/query-engine/validate-query.ts` — validación SQL (SELECT-only + LIMIT)
- `lib/db/system-context.ts` — dispatcher worker (no necesita org context)
- `lib/lock.ts` — tryLock distribuido (Redis SETNX)
- `lib/errors/to-user-error.ts` — errors-ux

---

## 15. Specs relacionados

- `scheduled-reports.md` — patrón idéntico (BullMQ dispatcher + per-job executor + cron helper)
- `multi-tenant.md` — `withOrgContext` + RLS policies
- `query-engine.md` — `validate-query` para SQL
- `email.md` — EmailProvider para canal email
- `audit/log.ts` — eventos `alert.*`
- `errors-ux.md` — errores tipificados
- `deployment.md` — workers corren en mismo Docker Compose
- `testing.md` — e2e: crear alerta, esperar evaluación, validar delivery (mock Slack)
