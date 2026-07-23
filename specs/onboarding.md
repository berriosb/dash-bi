# Spec: Onboarding Flow

> Primera experiencia del usuario después del signup. Conecta una data source y genera el primer dashboard en <3 minutos. La meta: que el usuario vea valor antes de configurar nada.

**Status:** Draft v0.2 (sync 2026-07-21)
**Prioridad:** P0 — sin onboarding el usuario se va
**Responsable:** codehak
**Depende de:** `auth.md`, `connectors.md`, `ai-generate-dashboards.md`, `query-engine.md`

---

## Cambios respecto a v0.1 (sync 2026-07-21)

**v0.2 (correcciones de consistencia):**
- ✅ Stack de forms confirmado: `react-hook-form` + `@hookform/resolvers/zod` (referenciado en `auth.md` §14)
- ✅ Error UX agregado al spec: qué hacer cuando el primer dashboard falla (mensaje claro + opción de reintentar)
- ✅ i18n: copy en español consistente con el resto del spec

---

## 1. Objetivo

Lograr que un usuario nuevo:

1. **Cree su cuenta** en <30 segundos (Google OAuth preferido)
2. **Cree su primera organización** (o acepte la auto-creada)
3. **Conecte su primera data source** en <60 segundos
4. **Genere su primer dashboard** en <90 segundos
5. **Vea un dashboard renderizado** con data real en <3 minutos total

**Métrica:** % de signups que llegan al primer dashboard generado >70%.

## 2. Flujo completo (4 pasos)

```
Step 1: Signup (30s)
  /signup → email/Google → auto-crea org "Mi organización"

Step 2: Welcome screen (10s)
  "¡Bienvenido! Vamos a crear tu primer dashboard."
  "Primero, conectá una fuente de datos."

Step 3: Connect data source (60s)
  Wizard de 3 pasos (ver connectors.md)
  - Elegir tipo (Postgres/Stripe/Sheets)
  - Ingresar credenciales
  - Test connection

Step 4: First dashboard (90s)
  Prompt sugerido: "Mostrame [datos típicos del source]"
  Click "Generar" → dashboard renderizado
  CTA: "Personalizá tu dashboard" o "Compartilo"
```

## 3. Pantallas detalladas

### 3.1 Welcome screen

```
┌────────────────────────────────────────────────┐
│ 👋 ¡Bienvenido a dash-bi!                      │
│                                                │
│ Vamos a crear tu primer dashboard en 3         │
│ pasos. Tardarás menos de 3 minutos.            │
│                                                │
│ ┌──────────────────────────────────────────┐  │
│ │ 1️⃣ Conectar fuente de datos              │  │
│ │    Elegí de dónde sacar la información   │  │
│ └──────────────────────────────────────────┘  │
│ ┌──────────────────────────────────────────┐  │
│ │ 2️⃣ Describir qué quieres ver             │  │
│ │    En lenguaje natural, tipo chat        │  │
│ └──────────────────────────────────────────┘  │
│ ┌──────────────────────────────────────────┐  │
│ │ 3️⃣ Dashboard generado con IA             │  │
│ │    Ajustá, exportá, compartí             │  │
│ └──────────────────────────────────────────┘  │
│                                                │
│ [Empezar →]                                    │
│                                                │
│ ⏱ Tiempo estimado: 3 min                       │
└────────────────────────────────────────────────┘
```

### 3.2 Choose data source

```
┌────────────────────────────────────────────────┐
│ ¿Qué querés conectar?                         │
│                                                │
│ ┌──────────────┐ ┌──────────────┐ ┌───────────┐│
│ │ 🐘            │ │ 💳            │ │ 📊        ││
│ │ PostgreSQL    │ │ Stripe        │ │ Google    ││
│ │ Database      │ │ API           │ │ Sheets    ││
│ │               │ │               │ │           ││
│ │ Conectá tu DB │ │ Revenue, MRR  │ │ Tus      ││
│ │ directamente  │ │ churn, subs   │ │ reportes  ││
│ └──────────────┘ └──────────────┘ └───────────┘│
│                                                │
│ ¿No ves tu fuente?                             │
│ [Pedir otra fuente →] (vota por feature)       │
│                                                │
│ [Continuar] (deshabilitado hasta elegir)       │
└────────────────────────────────────────────────┘
```

### 3.3 Connect (wizard por tipo)

Ver `connectors.md` §4.2 — wizard de 4 pasos.

**Optimización específica para onboarding:**
- Pre-llenar campos obvios cuando sea posible
- Link "Cómo encontrar mi API key de Stripe" con screenshots
- Link "Cómo crear un read-only user en Postgres" con snippet SQL

### 3.4 First dashboard prompt

```
┌────────────────────────────────────────────────┐
│ ¡Listo! Tu fuente está conectada.              │
│                                                │
│ Ahora describí qué querés ver. Algunos         │
│ ejemplos para inspirarte:                      │
│                                                │
│ 📊 Revenue de Stripe últimos 6 meses           │
│    agrupado por plan                           │
│                                                │
│ 👥 Nuevos clientes por semana                  │
│    con tendencia mensual                       │
│                                                │
│ 📈 Top 10 productos más vendidos               │
│    comparados con mes anterior                 │
│                                                │
│ O escribí lo tuyo:                             │
│ ┌────────────────────────────────────────────┐│
│ │ [textarea grande              ]            ││
│ │                                            ││
│ └────────────────────────────────────────────┘│
│                                                │
│ [✨ Generar mi primer dashboard]               │
└────────────────────────────────────────────────┘
```

### 3.5 Success state

```
┌────────────────────────────────────────────────┐
│ 🎉 ¡Tu primer dashboard está listo!            │
│                                                │
│ [dashboard renderizado]                        │
│                                                │
│ ¿Qué sigue?                                    │
│ ┌────────────┐ ┌────────────┐ ┌────────────┐  │
│ │ 💬 Ajustar │ │ 📤 Compartir│ │ 📊 Crear   │  │
│ │ con chat   │ │ con cliente │ │ otro       │  │
│ └────────────┘ └────────────┘ └────────────┘  │
│                                                │
│ [Ir al dashboard →]                            │
└────────────────────────────────────────────────┘
```

## 4. Auto-creación de org

```typescript
// En el callback de signup (auth.md)
export async function onSignupSuccess(user: User): Promise<string> {
  // Auto-crear org personal
  const org = await db.insert(orgs).values({
    name: `${user.name}'s workspace`,
    slug: generateUniqueSlug(user.email),
    plan: 'free',
  }).returning();
  
  // Agregar user como admin de esa org
  await db.insert(orgMembers).values({
    orgId: org.id,
    userId: user.id,
    role: 'admin',
    joinedAt: new Date(),
  });
  
  // Set como active org
  await db.update(users)
    .set({ activeOrgId: org.id })
    .where(eq(users.id, user.id));
  
  return org.id;
}
```

## 5. Sugerencias inteligentes según el data source

Para mejorar la relevance, el prompt sugerido se adapta al source conectado:

```typescript
const SUGGESTIONS_BY_TYPE = {
  postgres: [
    'Top 10 productos más vendidos este mes',
    'Usuarios activos por día, últimos 30 días',
    'Revenue por región, comparado con mes anterior',
  ],
  stripe: [
    'Revenue mensual de los últimos 6 meses',
    'MRR vs churn por cohorte',
    'Top 20 clientes por LTV',
  ],
  sheets: [
    'Resumen de la hoja Summary por categoría',
    'Tendencia de ventas por región',
    'Comparación Q1 vs Q2 por métrica',
  ],
};
```

## 6. Onboarding state tracking

```typescript
// db/schema.ts
export const users = pgTable('users', {
  // ...
  onboardingCompletedAt: timestamp('onboarding_completed_at', { withTimezone: true }),
  currentOnboardingStep: text('current_onboarding_step'),  // 'signup' | 'org_created' | 'source_connected' | 'first_dashboard' | 'completed'
});

// Tracking de progreso
type OnboardingStep = 'signup' | 'org_created' | 'source_connected' | 'first_dashboard' | 'completed';

await db.update(users).set({
  currentOnboardingStep: 'source_connected'
});
```

## 7. Skip onboarding

Para power users que ya saben qué hacer:

```
[Skip onboarding →]    [Go to dashboard]
```

El onboarding se puede retomar después desde Settings → Help → Replay onboarding.

## 8. Drop-off recovery

Si el usuario abandona en cualquier paso:

```typescript
// Cuando vuelve a login
if (!user.onboardingCompletedAt && user.currentOnboardingStep !== 'signup') {
  return redirect(`/onboarding?resume=${user.currentOnboardingStep}`);
}
```

Email opcional (Fase 2): "Notamos que no terminaste tu setup. ¿Necesitás ayuda?"

## 9. Help & tooltips

Tooltips contextuales en cada paso:

```
"¿Qué es un data source?"
→ Es de dónde dash-bi saca los datos. Puede ser tu base de 
  datos, una API como Stripe, o una planilla de Google.

"¿Por qué pedís acceso a mi base de datos?"
→ Para leer tus datos y armar dashboards. dash-bi nunca escribe 
  ni modifica tu DB, solo lee. Recomendamos crear un usuario 
  con permisos de solo lectura.
```

## 10. Success metrics

**Métricas a trackear:**
- Signup → Org creado: >95%
- Org creado → Source conectado: >85%
- Source conectado → First dashboard: >75%
- **Overall signup → first dashboard: >70%** (target)
- Tiempo promedio signup → first dashboard: <3 min

**Tracking:**
```typescript
// Analytics events
track('onboarding.step_completed', { step: 'source_connected', sourceType: 'stripe', durationMs: 65000 });
track('onboarding.completed', { totalDurationMs: 175000, dashboardGenerated: true });
```

## 11. Acceptance criteria

- [ ] Flujo completo de 4 pasos funciona end-to-end
- [ ] Google OAuth crea org automáticamente
- [ ] Data source wizard es claro y testeable
- [ ] Sugerencias se adaptan al tipo de source
- [ ] Drop-off recovery retoma donde quedó
- [ ] Tracking de métricas implementado
- [ ] Mobile responsive (al menos el welcome screen)
- [ ] Skip onboarding funciona
- [ ] Time to first dashboard <3 min en promedio

## 12. Out of scope (MVP)

- ❌ Onboarding tour en producto (después del primer dashboard)
- ❌ Video tutoriales (Fase 2)
- ❌ Email drip campaign post-signup (Fase 2)
- ❌ Wizard multi-source (conectar varios en onboarding) (Fase 2)
- ❌ Sample data / demo mode (Fase 3, pero nice-to-have)

## 13. Riesgos

| Riesgo | Mitigación |
|--------|-----------|
| Drop-off en conexión de source | Tooltips + links a docs + soporte en chat |
| Source complejo (ej: Postgres con VPN) | Documentar bien + opción "skip, conectar después" |
| Primer dashboard falla (IA error) | Error claro al usuario + opción de reintentar (sin fallback template, ver `ai-generate-dashboards.md` §10) |
| Time to first value >3 min | Optimizar cada paso, async donde sea posible |
| Usuario no entiende qué hacer | Sugerencias específicas + ejemplos clickeables |

## 14. Specs relacionados

- `auth.md` — signup crea org auto (`requireEmailVerification: true`)
- `connectors.md` — wizard de conexión
- `ai-generate-dashboards.md` — generación del primer dashboard
- `query-engine.md` — queries reales que hidratan los widgets del primer dashboard
- `multi-tenant.md` — org default

## 15. Stack de forms

- **`react-hook-form`** para los forms de wizard (Step 3: Connect data source)
- **Schemas Zod únicos** en `lib/onboarding/schemas.ts`, reusados en frontend y backend
- **Validación asíncrona** vía TanStack Query (ej: test connection antes de submit)