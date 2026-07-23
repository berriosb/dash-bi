# Spec: Export & Sharing

> Sistema de exportación de dashboards a PDF, PNG y link público compartible. Output presentable listo para enviar a clientes/jefes.

**Status:** Draft v0.3 (sync 2026-07-21)
**Prioridad:** P0 — feature core para "enviar reportes"
**Responsable:** codehak
**Depende de:** `widget-system.md`, `layouts-themes.md`

---

## Cambios respecto a v0.2 (sync 2026-07-21)

**v0.3 (correcciones de consistencia):**
- ✅ §3.1-§3.3 actualizadas: **Puppeteer corre en worker service separado** (no en el proceso Next.js principal). Arquitectura decidida en IMPLEMENTATION-PLAN-v1.0.md.
- ✅ §3 añadida: protocolo HTTP `POST /pdf/render` del worker
- ✅ §3 añadida: queue con BullMQ + Redis (concurrencia limitada a 3)
- ✅ §5.1 schema `public_links` actualizado: **sin `passwordHash`** (decisión post-auditoría confirmada)
- ✅ §5 acceptance criteria actualizado: eliminado "password protect funciona"
- ✅ §11 Dependencias: `puppeteer` movido a `pdf-worker/` package.json (no en la app principal)
- ✅ §3.1 añadida: storage de PDFs generados (FS local en MVP, R2/S3 en Fase 2)

**Decisiones aplicadas (post-auditoría 2026-07-21):**
- ❌ Eliminado: `@react-pdf/renderer` para charts (Recharts no funciona en react-pdf, +2 semanas reescribir cada chart).
- ✅ Adoptado: **Puppeteer headless Chrome** para PDF (renderiza el dashboard HTML real, fidelidad 100%).
- ❌ Eliminado: link público con password (complejo, edge case raro).
- ✅ Link público solo con token random (sin password).

## 1. Objetivo

Permitir que un usuario:

1. **Exporte un dashboard a PDF** — con branding de su org (logo + colors), presentable para cliente
2. **Exporte un dashboard a PNG** — imagen rápida para Slack/email
3. **Genere un link público** — compartir con stakeholders sin que necesiten cuenta
4. **Programe exports recurrentes** (Fase 2) — "mandame este PDF cada lunes a las 9am"

## 2. Formatos soportados

### 2.1 PDF — El más importante

**Caso de uso:** "Tengo que mandar un reporte trimestral al cliente."

**Características:**
- Multi-página automático si el dashboard es largo
- Branding de la org (logo, colors primary)
- Header con título del dashboard + fecha de generación
- Footer con "Generado con dash-bi" + URL al dashboard
- Charts renderizados como vector (no pixelados al zoom)
- Tablas con paginación automática
- Letter size o A4 (auto-detect por locale del usuario)

### 2.2 PNG — Para Slack/email rápido

**Caso de uso:** "Mira este KPI que subimos 30% este mes 👀"

**Características:**
- Single image, dimensiones del viewport
- Sin branding (opcional toggle)
- Sin header/footer
- Tamaño optimizado para email (<500KB)

### 2.3 Link público — Compartir sin cuenta

**Caso de uso:** "El cliente quiere ver el dashboard pero no le quiero dar acceso al sistema."

**Características:**
- URL única tipo `dash-bi.com/share/[token]`
- Sin auth requerida
- Token aleatorio de 32+ chars
- Sin password (decisión v0.2, ver §5)
- Expiration date opcional (default 30 días)
- Read-only, no edit
- Live data (refresh en tiempo real si está abierto)

## 3. Implementación: PDF (worker service separado)

> **v0.3 arquitectura:** El PDF NO se genera en el proceso Next.js. Hay un **worker service separado** (`pdf-worker/`) que corre Puppeteer. El Next.js encola jobs en Redis (BullMQ) y el worker los procesa. Esto evita que exports concurrentes bloqueen la app principal y aísla ~200MB de Chrome.

```
┌────────────────┐    HTTP     ┌─────────────────┐
│  Next.js app   │ ──────────► │  pdf-worker     │
│  (encola jobs) │  POST /pdf  │  (Puppeteer)    │
└────────┬───────┘             └─────────────────┘
         │                              ▲
         │ BullMQ (Redis)               │
         ▼                              │
   ┌──────────┐                  Consumer
   │  Redis   │ ◄─────────────────┘
   └──────────┘
```

### 3.1 Stack

- **Worker service `pdf-worker/`** — Puppeteer headless Chrome (instalado por separado)
- **BullMQ + Redis** — queue, concurrencia limitada a 3 simultáneos
- **Storage de PDFs** — FS local en MVP (`/var/lib/dash-bi/exports/`), R2/S3 en Fase 2
- **Timeout** — 30s por export (configurable)
- **Alternativa serverless** — `@sparticuz/chromium` para AWS Lambda (Fase 2)

### 3.2 Componentes

#### 3.2.1 `pdf-worker/server.ts` (HTTP entrypoint)

```typescript
import { Worker } from 'bullmq';
import puppeteer from 'puppeteer';
import IORedis from 'ioredis';

const connection = new IORedis({ host: 'redis', port: 6379 });

const worker = new Worker('pdf-export', async (job) => {
  const { url, options, branding } = job.data;
  return await renderPdf({ url, options, branding });
}, {
  connection,
  concurrency: 3,        // máximo 3 PDFs simultáneos
  limiter: { max: 10, duration: 60_000 },  // 10/min global
});

async function renderPdf({ url, options, branding }) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({
      width: options.pageSize === 'A4' ? 794 : 816,
      height: 1056,
    });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForSelector('[data-dashboard-ready="true"]', { timeout: 15_000 });

    if (branding.logoUrl) {
      await page.evaluate((url) => {
        const header = document.createElement('div');
        header.innerHTML = `<img src="${url}" style="height: 40px; margin: 16px;" />`;
        document.body.prepend(header);
      }, branding.logoUrl);
    }

    const pdf = await page.pdf({
      format: options.pageSize || 'Letter',
      printBackground: true,
      margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' },
    });
    return { buffer: Buffer.from(pdf) };
  } finally {
    await browser.close();
  }
}
```

#### 3.2.2 Cliente: encolar job desde Next.js

```typescript
// lib/export/enqueue-pdf.ts

import { Queue } from 'bullmq';
import IORedis from 'ioredis';

const connection = new IORedis({ host: process.env.REDIS_HOST });
const pdfQueue = new Queue('pdf-export', { connection });

export async function enqueuePdfExport(opts: {
  dashboardId: string;
  orgId: string;
  userId: string;
  pageSize: 'A4' | 'Letter';
}): Promise<string> {
  // Print URL con token server-side (no requiere auth de usuario, el token es de un solo uso)
  const url = `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/${opts.dashboardId}/print?token=${await generatePrintToken(opts.dashboardId, opts.orgId)}`;
  const org = await getOrg(opts.orgId);

  const job = await pdfQueue.add('render', {
    url,
    options: { pageSize: opts.pageSize },
    branding: { logoUrl: org.brandLogoUrl },
  }, {
    timeout: 30_000,
    removeOnComplete: 100,
    removeOnFail: 100,
  });

  return job.id!;
}
```

#### 3.2.3 API endpoint async (v0.3)

```typescript
// app/api/dashboards/[id]/export/pdf/route.ts

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { orgId, userId } = await getAuthContext(req);
  await requirePermission(userId, orgId, 'export.pdf');

  const body = await req.json();
  const pageSize = body.pageSize ?? 'Letter';

  const jobId = await enqueuePdfExport({
    dashboardId: params.id,
    orgId,
    userId,
    pageSize,
  });

  await audit(orgId, userId, 'export.pdf.requested', `dashboard:${params.id}`, { jobId });

  return Response.json({ jobId, status: 'queued' });
}

// GET endpoint para chequear status y descargar cuando complete
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const jobId = req.nextUrl.searchParams.get('jobId');
  const result = await pdfQueue.getJob(jobId!);

  if (!result) return Response.json({ status: 'not_found' }, { status: 404 });
  if (await result.isCompleted()) {
    const buffer = (await result.returnvalue).buffer;
    return new Response(buffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="dashboard-${params.id}.pdf"`,
      },
    });
  }
  return Response.json({ status: await result.getState() });
}
```

### 3.3 Print route autenticado

```typescript
// app/dashboard/[id]/print/page.tsx

export default async function PrintDashboardPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { token: string };
}) {
  // Token server-side un solo uso (vive 30min en Redis, se invalida al consumir)
  const isValid = await validatePrintToken(searchParams.token, params.id);
  if (!isValid) return <Unauthorized />;

  // Renderizar dashboard en modo print (sin chrome UI, sin chat panel, sin drag handles)
  return <DashboardPrintView dashboardId={params.id} hideChrome />;
}
```

### 3.4 Docker Compose (v0.3)

```yaml
services:
  app:
    build: .
    ports: ["3000:3000"]
    depends_on: [postgres, redis]
    environment:
      - REDIS_HOST=redis

  pdf-worker:
    build:
      context: .
      dockerfile: Dockerfile.worker    # instala Chromium + Puppeteer
    depends_on: [redis]
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 2G
    volumes:
      - exports:/var/lib/dash-bi/exports   # PDFs generados

  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]

volumes:
  exports:
```

**Por qué Puppeteer en vez de react-pdf:**
- Recharts usa SVG que **no funciona en react-pdf** (confirmado por auditoría)
- Reescribir cada chart en primitives de react-pdf = +2-3 semanas
- Puppeteer renderiza el HTML real → fidelidad 100% con cero trabajo extra
- Costo: binario de Chrome ~200MB en Docker del worker (NO afecta la app principal)
- Para serverless (Vercel/Cloudflare Workers): `@sparticuz/chromium` en Fase 2

## 4. Implementación: PNG

### 4.1 Stack

- `html2canvas` — captura el DOM como canvas → PNG
- Solo el cliente puede capturar el DOM

### 4.2 Client-side capture

```typescript
// components/dashboard/ExportPNGButton.tsx
'use client';

import html2canvas from 'html2canvas';

export function ExportPNGButton({ dashboardRef }: { dashboardRef: React.RefObject<HTMLDivElement> }) {
  const handleExport = async () => {
    if (!dashboardRef.current) return;
    
    const canvas = await html2canvas(dashboardRef.current, {
      backgroundColor: null,
      scale: 2,                    // 2x para retina
      logging: false,
    });
    
    canvas.toBlob(async (blob) => {
      if (!blob) return;
      
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${dashboard.title}.png`;
      a.click();
      URL.revokeObjectURL(url);
    }, 'image/png', 0.95);
  };
  
  return <Button onClick={handleExport}>Exportar PNG</Button>;
}
```

### 4.3 Limitaciones

- Solo captura el viewport visible (no scroll completo)
- Charts interactivos (tooltips) no se capturan
- Para "full page", usar scroll + captura multiple + stitching (Fase 2)

## 5. Implementación: Link público

### 5.1 Schema (v0.3, sin password)

```typescript
// db/schema.ts (alineado con src/db/schema.ts)

export const publicLinks = pgTable('public_links', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
  dashboardId: uuid('dashboard_id').notNull().references(() => dashboards.id, { onDelete: 'cascade' }),

  token: text('token').notNull().unique(),            // 32 chars random
  // v0.3: SIN passwordHash — decisión congelada post-auditoría 2026-07-21

  expiresAt: timestamp('expires_at', { withTimezone: true }),    // null = nunca expira
  revokedAt: timestamp('revoked_at', { withTimezone: true }),    // manual revoke

  viewCount: integer('view_count').notNull().default(0),
  lastViewedAt: timestamp('last_viewed_at', { withTimezone: true }),

  createdBy: uuid('created_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  tokenIdx: unique('public_links_token_unique').on(t.token),
  orgIdx: index('public_links_org_idx').on(t.orgId),
}));
```

### 5.2 Generación de token

```typescript
import crypto from 'crypto';

export function generatePublicToken(): string {
  return crypto.randomBytes(24).toString('base64url');  // 32 chars random
}
```

### 5.3 API: crear link público

```typescript
// app/api/dashboards/[id]/share/route.ts

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  const { orgId, userId } = await getAuthContext(req);
  await requirePermission(userId, orgId, 'dashboard.sharePublic');

  const body = await req.json();
  const { expiresInDays } = body;  // v0.3: SIN password

  const [link] = await db.insert(publicLinks).values({
    orgId,
    dashboardId: params.id,
    token: generatePublicToken(),
    expiresAt: expiresInDays
      ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),  // default 30 días
    createdBy: userId,
  }).returning();

  return Response.json({
    url: `${process.env.NEXT_PUBLIC_APP_URL}/share/${link.token}`,
    token: link.token,
    expiresAt: link.expiresAt,
  });
}
```

### 5.4 Página pública

```typescript
// app/share/[token]/page.tsx

export default async function PublicDashboardPage({ params }: { params: { token: string } }) {
  const link = await db.query.publicLinks.findFirst({
    where: eq(publicLinks.token, params.token),
  });

  if (!link) return <NotFound />;
  if (link.expiresAt && link.expiresAt < new Date()) return <Expired />;
  if (link.revokedAt) return <Revoked />;

  // Incrementar view count (fire and forget)
  void db.update(publicLinks)
    .set({
      viewCount: sql`${publicLinks.viewCount} + 1`,
      lastViewedAt: new Date(),
    })
    .where(eq(publicLinks.id, link.id));

  // Cargar dashboard via withOrgContext
  const dashboard = await withOrgContext(link.orgId, undefined, async () =>
    db.query.dashboards.findFirst({
      where: eq(dashboards.id, link.dashboardId),
    })
  );

  if (!dashboard) return <NotFound />;

  return <DashboardView dashboard={dashboard} readOnly />;
}
```

### 5.5 Revocar link

```typescript
// app/api/public-links/[id]/route.ts

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const { orgId, userId } = await getAuthContext(req);
  await requirePermission(userId, orgId, 'dashboard.sharePublic');

  await withOrgContext(orgId, userId, async () => {
    await db.update(publicLinks)
      .set({ revokedAt: new Date() })
      .where(eq(publicLinks.id, params.id));
  });

  await audit(orgId, userId, 'export.link_revoked', `public_link:${params.id}`);
  return Response.json({ ok: true });
}
```

## 6. UI: dialog de export/share

```
┌────────────────────────────────────────────────┐
│ Export & Share                                  │
│                                                │
│ Format:                                         │
│ ○ PDF (con branding)                            │
│ ○ PNG (imagen rápida)                           │
│ ● Link público                                  │
│                                                │
│ ─── Link público ─────────────────────────────  │
│                                                │
│ ☐ Expira en [30] días (default)                 │
│                                                │
│ [Generar link]                                  │
│                                                │
│ Links activos:                                  │
│ ┌────────────────────────────────────────────┐ │
│ │ https://dash-bi.com/share/abc...            │ │
│ │ Creado: 2026-07-15 · 23 vistas · [Copiar] [×]│ │
│ └────────────────────────────────────────────┘ │
│ ┌────────────────────────────────────────────┐ │
│ │ https://dash-bi.com/share/xyz...            │ │
│ │ Expira: 2026-08-15 · [Copiar] [×]          │ │
│ └────────────────────────────────────────────┘ │
└────────────────────────────────────────────────┘
```

> **v0.3:** la sección "Password protect" removida de la UI (decisión congelada post-auditoría).

## 7. Performance

- **PDF generation (con worker):** 3-5s p50, 8s p95 para dashboard con 6 widgets
- **PDF queue wait time:** <2s en condiciones normales (3 workers concurrentes)
- **PNG capture:** 0.5-1 segundo (client-side)
- **Public link load:** <500ms p50
- **PDF file size típico:** 200-800KB
- **PNG file size típico:** 100-500KB

## 8. Acceptance criteria

- [ ] PDF se genera con branding de la org (logo + colors)
- [ ] PDF tiene header con título + fecha + footer con page numbers
- [ ] PDF es multi-página si el dashboard es largo
- [ ] PDF se genera en worker service separado (NO en el proceso Next.js principal)
- [ ] Exports concurrentes respetan max 3 simultáneos (BullMQ limiter)
- [ ] PNG se descarga con 1 click (html2canvas client-side)
- [ ] Link público se genera con token random ≥32 chars
- [ ] Link público funciona sin auth
- [ ] Expiration date funciona (link muerto después)
- [ ] Revoke manual funciona
- [ ] View count se incrementa (fire and forget)
- [ ] Audit log guarda exports y shares
- [ ] Rate limit en PDF generation (10/min por org)
- [ ] PDF NO aparece con password en ningún lado (sin password en MVP)

## 9. Out of scope (MVP)

- ❌ Scheduled exports (email cada lunes) (Fase 2)
- ❌ Excel export (.xlsx) (Fase 2)
- ❌ Custom PDF templates por org (Fase 3)
- ❌ Watermark en PDF (Fase 2)
- ❌ QR code en PDF para escanear (Fase 3)
- ❌ Embed mode (iframe en otros sitios) (Fase 3)
- ❌ Real-time collaboration en link público (Fase 3)
- ❌ **Password protect en link público** (Fase 2 si se pide por feedback de usuarios enterprise)
- ❌ Storage S3/R2 (Fase 2)

## 10. Riesgos

| Riesgo | Mitigación |
|--------|-----------|
| PDF generation timeout | BullMQ job timeout 30s + retry 1 vez + audit `export.failed` |
| Puppeteer consume mucha RAM | Worker con `memory: 2G` limit + concurrencia 3 |
| Link público indexado por Google | Noindex header, robots.txt en `/share/` |
| Token brute force | 32 chars random = 2^192 combinaciones, no factible |
| View count abuse | No confiar en view count como métrica de billing |
| File size excesivo | Comprimir PDF, optimizar PNG |
| Worker se cae | BullMQ reintenta el job, si falla N veces → audit `export.failed` |
| Disco lleno (PDFs en FS) | Cleanup job corre semanal, Fase 2 S3/R2 con lifecycle |

## 11. Dependencias

```json
{
  // App Next.js (NO tiene Puppeteer)
  "dependencies": {
    "html2canvas": "^1.4.1",
    "bullmq": "^5.34.0",
    "ioredis": "^5.4.2"
  }
}
```

```json
{
  // pdf-worker/ — separado
  "dependencies": {
    "puppeteer": "^24.0.0",
    "bullmq": "^5.34.0",
    "ioredis": "^5.4.2"
  }
}
```

## 12. Specs relacionados

- `widget-system.md` — widgets base para PDF y web
- `layouts-themes.md` — themes aplicados al PDF
- `multi-tenant.md` — branding por org + RLS para acceso a PDFs
- `auth.md` — permisos para exportar/compartir
- `query-engine.md` — los widgets del PDF ejecutan sus queries antes de renderear
- `IMPLEMENTATION-PLAN-v1.0.md` §"Decisiones arquitectónicas finales" — arquitectura worker PDF