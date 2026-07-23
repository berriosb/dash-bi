# Spec: Demo Mode (Datos Sintéticos)

> Permite al usuario ver dashboards reales con datos sintéticos generados, **sin conectar una sola fuente externa**. Acelera el funnel de onboarding 3-5x: del signup al "wow moment" en menos de 30 segundos.

**Status:** Draft v0.1 (Tier 1 — recomendación competitiva)
**Prioridad:** P0 — bloquea top-of-funnel onboarding
**Responsable:** codehak
**Depende de:** `connectors.md`, `query-engine.md`, `onboarding.md`

---

## 1. Objetivo

Permitir que un usuario nuevo:

1. **Vea un dashboard renderizado con datos realistas** dentro del primer minuto post-signup, sin configurar nada.
2. **Explore 3 personas** pre-cargadas: SaaS startup (Stripe-like), E-commerce (Postgres-like), B2B agency (Sheets-like).
3. **Itere con prompts reales** sobre esos datos sintéticos para entender el value prop antes de conectar su DB real.
4. **Conecte su data real cuando quiera**, descartando los demos con 1 click.

**Métricas target:**
- Signup → primera vista de demo dashboard: >95% (vs ~70% del funnel actual)
- Conversión demo → conexión de data real: >40% en 7 días
- Tiempo a "wow moment": <30 segundos

---

## 2. Concepto de diseño

### 2.1 Por qué funciona

- **Elimina fricción cero-config.** El usuario llega y ve valor inmediato (no "configurá tu DB primero").
- **El query-engine no cambia.** Los datos sintéticos viven en la misma Postgres del tenant — se ejecutan via el connector Postgres existente.
- **Los prompts demuestran el producto.** "¿Cuánto MRR tengo?" genera un dashboard real sobre datos ficticios, idéntico al que generará sobre datos reales después.
- **Sandbox seguro.** No compromete al usuario: puede tirar todo y empezar de cero sin perder nada.

### 2.2 Lo que NO es

- **No es un "tour guiado"** del producto (eso se mantiene como Fase 2).
- **No es un dataset público compartido** entre orgs (cada demo es único por usuario).
- **No es una versión trial** del SaaS con quotas diferentes (es lo mismo, los rates son iguales).

---

## 3. Las 3 personas

### 3.1 `saas-startup` — Revenue, growth, churn

**Modelo de datos sintético:**

```sql
-- 8 tablas, generadas determinísticamente por orgId seed
customers         (12,000 rows): id, name, country, plan, signup_date, churn_date
subscriptions     (15,000 rows): id, customer_id, plan, mrr_cents, status, started_at, ended_at
charges           (180,000 rows): id, customer_id, amount_cents, currency, status, created_at
events            (2,500,000 rows): user_id, event_type, properties jsonb, created_at
-- Event types: 'signup', 'login', 'feature_use', 'churn_signaled'
```

**3 dashboards pre-armados (elegidos al primer login):**
- `MRR Overview` (archetype `kpi-grid`, theme `moderno-saas`)
- `Cohort Retention` (archetype `cohort-matrix`)
- `Growth Engine` (archetype `growth-metrics`)

**Prompts sugeridos (chips clickeables):**
- "¿Cómo viene el MRR este trimestre?"
- "Cuál es el churn rate vs mes anterior?"
- "Top 20 clientes por LTV"

### 3.2 `ecommerce` — Órdenes, productos, categorías

**Modelo de datos sintético:**

```sql
orders            (95,000 rows): id, customer_id, total_cents, status, created_at
order_items       (~280,000 rows): order_id, product_id, qty, unit_price_cents
products          (1,200 rows): id, name, category_id, cost_cents, list_price_cents
categories        (45 rows): id, name, parent_id
customers         (40,000 rows): id, name, country, created_at
inventory_movements (350,000 rows): product_id, type ('in'|'out'), qty, created_at
```

**3 dashboards pre-armados:**
- `Revenue & AOV` (archetype `finance-report`, theme `corporate`)
- `Top Products & Categories` (archetype `breakdown-list`)
- `Customer Cohort LTV` (archetype `cohort-matrix`)

**Prompts sugeridos:**
- "Ventas por categoría este mes vs mes anterior"
- "Top 50 productos más vendidos"
- "AOV semanal y tendencia"

### 3.3 `b2b-agency` — Proyectos, retainer, horas facturables

**Modelo de datos sintético:**

```sql
clients           (28 rows): id, name, country, monthly_retainer_cents, started_at
projects          (95 rows): id, client_id, name, status, budget_hours, started_at
time_entries      (12,000 rows): user_id, project_id, hours, date, billable (bool)
invoices          (640 rows): id, client_id, amount_cents, status, issued_at, paid_at
team_members      (15 rows): id, name, role, hourly_cost_cents, monthly_capacity_hours
```

**3 dashboards pre-armados:**
- `Agency Health` (archetype `executive-summary`, theme `moderno-saas`)
- `Utilization & Billing` (archetype `finance-report`)
- `Pipeline & Renewals` (archetype `sales-pipeline`)

**Prompts sugeridos:**
- "Revenue recurrente vs one-time este trimestre"
- "Cuál cliente tiene peor margen"
- "Horas facturables vs capacidad del equipo"

---

## 4. Modelo de datos

### 4.1 Tabla `demo_orgs`

Marca qué orgs tienen demo data y qué persona:

```typescript
// db/schema.ts (extensión)
export const demoOrgs = pgTable('demo_orgs', {
  orgId: uuid('org_id').primaryKey().references(() => orgs.id, { onDelete: 'cascade' }),
  persona: text('persona').$type<'saas-startup' | 'ecommerce' | 'b2b-agency'>().notNull(),
  seededAt: timestamp('seeded_at').notNull().defaultNow(),
  expiresAt: timestamp('expires_at').notNull(),     // default now + 14 días
  dataDeletedAt: timestamp('data_deleted_at'),     // cuando el usuario la borró
});
```

**Reglas:**
- Una org tiene **0 o 1 persona** (no mezcla).
- Las tablas de datos sintéticos (`demo_customers_*`, `demo_orders_*`, etc.) usan prefijo `demo_` para no colisionar con datos reales que el usuario conecte después.
- RLS activado, mismas policies que el resto (aislamiento por org_id).

### 4.2 Esquemas de datos sintéticos

```sql
-- Ejemplo para saas-startup
CREATE TABLE demo_saas_customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id),
  name TEXT NOT NULL,
  country TEXT NOT NULL,
  plan TEXT NOT NULL,
  signup_date TIMESTAMPTZ NOT NULL,
  churn_date TIMESTAMPTZ
);
-- ... tables para subscriptions, charges, events
```

---

## 5. Generación determinística de datos

### 5.1 Seed por orgId

```typescript
// lib/demo/seed.ts

import { createHash } from 'crypto';
import { faker } from '@faker-js/faker';

export async function seedDemoData(orgId: string, persona: Persona) {
  const seed = parseInt(createHash('sha256').update(orgId).digest('hex').slice(0, 8), 16);
  faker.seed(seed);   // mismo orgId → mismos datos exactos
  
  switch (persona) {
    case 'saas-startup': return seedSaaSStartup(orgId);
    case 'ecommerce':    return seedEcommerce(orgId);
    case 'b2b-agency':   return seedB2BAgency(orgId);
  }
}
```

**Determinismo:** el mismo `orgId` siempre genera exactamente los mismos datos. Si el usuario vuelve a "re-seed", ve lo mismo (consistente). El seed se deriva del `orgId` via SHA-256 truncado.

### 5.2 Tamaños y volúmenes

| Persona | Tablas principales | Volumen total | Tamaño en disco |
|---------|-------------------|---------------|-----------------|
| saas-startup | customers, subscriptions, charges, events | ~2.8M rows | ~85 MB |
| ecommerce | orders, items, products, customers, inventory | ~770k rows | ~52 MB |
| b2b-agency | clients, projects, time_entries, invoices | ~13k rows | ~3 MB |

**Costo total por demo activo:** ~50MB en Postgres. Con 1k demos activos = ~50GB — aceptable para MVP, considerar limpieza agresiva más adelante.

### 5.3 Calidad de los datos

Para que los dashboards se vean **creíbles** y no obviously-fake:

- **Distribuciones realistas:** MRR con cola larga (Power law), eventos con tendencia estacional (más actividad martes-jueves), churn agrupado en torno a renovaciones (mes 3, 6, 12).
- **Relaciones consistentes:** un cliente con `churn_date` set tiene al menos 1 evento `churn_signaled` antes.
- **Anomalías sembradas:** 1-2 picos de revenue por trimestre (anuncios, virales), 1-2 caídas (simulan incidentes). Hace que los charts lucen "reales" en demos.

```typescript
// lib/demo/distributions.ts
const GROWTH_PATTERN = {
  monthlyGrowthPct: [8, 12, 15, 11, 9, 7, 14, 18, 13, 10, 16, 22],
  churnSpikes: [{ monthOffset: 7, magnitude: 0.35 }],   // simulacro de incidente mes 7
  viralPeaks:    [{ monthOffset: 11, magnitude: 2.8 }],  // pico viral mes 11
};
```

---

## 6. UI/UX

### 6.1 "Try demo" en signup

```
/signup → "Crear cuenta"
                ↓
   ┌────────────────────────────────────────┐
   │  ¡Bienvenido a dash-bi!               │
   │                                        │
   │  Elegí una demo para empezar:          │
   │                                        │
   │  ┌──────────┐ ┌──────────┐ ┌────────┐ │
   │  │ 🚀 SaaS  │ │ 🛒 Ecom  │ │ 💼 B2B │ │
   │  │ Startup  │ │ merce    │ │ Agency │ │
   │  │          │ │          │ │        │ │
   │  │ Revenue, │ │ Ventas,  │ │ Horas, │ │
   │  │ churn,   │ │ produc-  │ │ reten- │ │
   │  │ growth   │ │ tos      │ │ tion   │ │
   │  └──────────┘ └──────────┘ └────────┘ │
   │                                        │
   │  O [Conectar mi data real →]           │
   └────────────────────────────────────────┘
```

### 6.2 Banner en dashboards de demo

Para que el usuario nunca olvide que está en demo:

```
┌─────────────────────────────────────────────────────┐
│ 📊 Datos de demo · SaaS Startup                     │
│ Estos datos son sintéticos · [Borrar demo] [Conectar │ 
│ mi data real →]                                     │
└─────────────────────────────────────────────────────┘
```

Banner siempre visible (no dismissable), `bg-warning/10`, color sobrio.

### 6.3 Acción "Borrar demo"

- 1 click desde el banner o desde Settings → Data sources.
- Confirmación: "¿Borrar todos los datos de demo? Esta acción no se puede deshacer."
- Soft delete: marca `data_deleted_at`, opcionalmente hard delete a los 30 días (background job).

### 6.4 Acción "Re-seed"

El usuario puede regenerar la demo:
- Mismo seed (mismos datos, útil para "deshacer un cambio que hice").
- Nuevo seed (datos distintos, útil para "mostrame otra versión").

---

## 7. Pipeline técnico

### 7.1 Flujo de seed

```
User clicks "Try SaaS Startup"
        ↓
POST /api/demo/seed { persona: 'saas-startup' }
        ↓
[1] Crea org (o reutiliza si signup reciente)
[2] Marca en demo_orgs { persona, expiresAt = now + 14d }
[3] Genera datos en background (no bloquea)
    - Worker job `seed-demo-{orgId}`
    - Inserts en batch de 5k rows/transaction
    - Progress % via SSE para UI
[4] Cuando termina → notifica al cliente (revalidate)
[5] Auto-navega a /dashboards/demo-{persona}-mrr-overview
```

### 7.2 Background worker

```typescript
// lib/workers/seed-demo.ts
import { Worker } from 'bullmq';

const seedWorker = new Worker('seed-demo', async (job) => {
  const { orgId, persona } = job.data;
  await withOrgContext(orgId, systemUserId, async () => {
    await seedDemoData(orgId, persona);
  });
}, {
  connection: redis,
  concurrency: 2,             // max 2 seeds simultáneos
  timeout: 120_000,           // 2 min budget por seed
});
```

**Performance budget por persona:**
- saas-startup: ~90s (2.8M rows)
- ecommerce: ~60s (770k rows)
- b2b-agency: ~5s (13k rows)

Si supera el budget → log + retry + warning visible al usuario.

### 7.3 Auto-creación de dashboards demo

```typescript
// lib/demo/dashboards.ts

export async function createPersonaDashboards(orgId: string, persona: Persona) {
  const blueprints = PERSONA_DASHBOARDS[persona];   // Array<{title, archetype, widgets}>
  for (const bp of blueprints) {
    await withOrgContext(orgId, systemUserId, async () => {
      await db.insert(dashboards).values({
        orgId,
        title: bp.title,
        theme: bp.theme,
        archetype: bp.archetype,
        widgets: bp.widgets,                      // pre-armados, sin pasar por IA
        createdBy: systemUserId,
        isDemo: true,                              // marca que viene del seed
      });
    });
  }
}
```

`isDemo: true` permite: 
- Mostrar el banner en dashboards demo.
- Saltar quota check (no consume `generationsPerHour`).
- Ser elegibles para "borrar demo".

### 7.4 Expiration y cleanup

- **Después de 14 días:** email "Tu demo está por expirar — conectá tu data real o re-seed".
- **Después de 30 días:** job nightly `cleanup-expired-demos` hace hard delete de tablas `demo_*` + filas en `demo_orgs` + dashboards `isDemo=true`.
- **Manual delete:** en cualquier momento, vía UI (soft delete) o query directa (Fase 2).

---

## 8. Aislamiento y seguridad

### 8.1 RLS (idem resto del sistema)

```sql
ALTER TABLE demo_saas_customers ENABLE ROW LEVEL SECURITY;
-- Misma policy que data_sources: USING (org_id = current_setting('app.current_org_id')::uuid)
-- Repetir para todas las tablas demo_*
```

### 8.2 Rate limit

- 1 demo seed por org (no se puede re-seed concurrentemente — job se rechaza si ya hay uno en curso).
- Demo seed no consume `generationsPerHour` ni `maxTokensPerDay` (no hay LLM).

### 8.3 Forbidden en producción

En prod (`NODE_ENV=production`):
- Demo mode **sí está disponible** (es un feature).
- Pero el endpoint `/api/demo/seed` rate-limited a 1/hora por IP para evitar abuse.

---

## 9. Acceptance criteria

- [ ] Usuario nuevo ve pantalla "Elegí una demo" después del signup (3 personas)
- [ ] Al elegir persona, se genera la data y se navega al primer dashboard en <60 segundos (b2b) o <120 segundos (saas/ecom)
- [ ] Los 3 dashboards de cada persona están pre-armados y renderizan con datos reales
- [ ] El banner "Datos de demo" está visible en todos los dashboards de demo
- [ ] "Borrar demo" elimina todas las tablas `demo_*` y dashboards asociados
- [ ] "Re-seed con datos nuevos" genera datos diferentes (mismo orgId, seed distinto)
- [ ] "Re-seed con mismos datos" regenera idéntico (útil para "deshacer")
- [ ] Después de 14 días, email automático de "demo por expirar"
- [ ] Después de 30 días, hard delete automático por background job
- [ ] La demo data NO consume quota de LLM
- [ ] Aislamiento por org validado (cross-tenant demo access = RLS)
- [ ] Determinismo validado: mismo `orgId` siempre genera misma data

---

## 10. Out of scope (MVP)

- ❌ Demo mode multi-source (combinar SaaS + Ecom en misma org)
- ❌ Editor de la demo ("cambiar la distribución de churn")
- ❌ Datasets sintéticos custom por usuario
- ❌ Compartir dashboards de demo vía link público
- ❌ Exportar PDF de dashboards de demo
- ❌ Demo mode en móvil (solo desktop)
- ❌ Demos por industria (healthcare, finance, gaming) — Fase 2

---

## 11. Riesgos

| Riesgo | Mitigación |
|--------|-----------|
| Demo data demasiado fake → usuario desconfía | Distribuciones realistas + anomalías sembradas + validación visual pre-launch |
| Job de seed se cuelga >120s y bloquea UX | Timeout worker + fallback "retry con menos volumen" + mensaje claro |
| Disco se llena con demos activos | Cleanup automático 30d + alerta cuando demos activos >5k |
| Usuario "se queda" en demo y nunca conecta data real | Banner persistente + email día 7 + email día 14 + CTA prominente en cada dashboard |
| Demo data contamina búsqueda universal | Prefijo `demo_` en TODAS las tablas + filtros en queries admin |
| Re-seed concurrente del mismo org | Lock por orgId (`pg_try_advisory_xact_lock`) + job rechazado si ya hay uno en curso |
| Generador `faker` cambia datos con update | Pin versión de `@faker-js/faker` (>=9.0), freeze de las distribuciones |

---

## 12. Roadmap post-MVP

**Fase 2 (semana 5-6):**
- Editor visual de la demo (cambiar plan names, currency, regiones)
- 3 personas más: marketplace, fintech, healthcare
- Demo mode en móvil (responsive full)

**Fase 3:**
- Demo data marketplace: comunidad aporta datasets
- "Auto-demo" basado en la descripción de la org (LA垂直 fintech? → fintech demo)

---

## 13. Dependencias

```json
{
  "dependencies": {
    "@faker-js/faker": "^9.0.0",
    "bullmq": "^5.34.0"
  }
}
```

`faker` para generación determinística. `bullmq` ya está (reusa el worker existente).

---

## 14. Specs relacionados

- `connectors.md` — los datos sintéticos se exponen como connector `postgres` (mismo engine)
- `query-engine.md` — sin cambios; las queries se ejecutan idénticas
- `auth.md` — el signup flow ahora termina en selector de demo
- `onboarding.md` — el paso 1 (welcome) se rediseña para ofrecer demo primero
- `multi-tenant.md` — RLS aplicado a tablas `demo_*`
- `dashboard-archetypes.md` — los dashboards pre-armados usan los archetypes existentes
