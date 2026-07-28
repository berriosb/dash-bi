# Spec: Multi-Tenant

> Aislamiento de datos por organización. Cada org tiene sus propios data sources, dashboards, usuarios, configuración de LLM y branding. Row Level Security en Postgres + RBAC por roles.

**Status:** Draft v0.2 (sync 2026-07-21)
**Prioridad:** P0 — sin esto no es producto multi-tenant
**Responsable:** codehak
**Depende de:** ninguno

---

## Cambios respecto a v0.1 (sync 2026-07-21)

**v0.2 (correcciones de consistencia):**
- ✅ Sección §3.5 nueva: **Política de caching Next.js 16** — `no-store` por defecto en RSC que tocan data tenant-scoped
- ✅ Sección §7.1 nueva: **Audit log retention policy** — partitioning mensual, 90/365 días según plan
- ✅ Tabla `audit_log` agregados índices compuestos (org_id, action) y (org_id, user_id) — ver §7.2
- ✅ Tabla `users.activeOrgId` documentada: FK opcional + índice
- ✅ Sección §3.3.1 nueva: ejemplo de ORM-level policy enforcement (linter rule `no-raw-db-queries`)
- ✅ Sección §6.1 nueva: explicitud sobre quota `-1` → usar enum `LIMIT.UNLIMITED`
- ✅ Referencia a `query-engine.md` para cache de queries

## 1. Objetivo

Permitir que dash-bi sirva a **múltiples organizaciones** desde una sola instancia, con:

1. **Aislamiento estricto de datos** — Org A nunca ve data de Org B
2. **Usuarios pueden pertenecer a múltiples orgs** con roles diferentes en cada una
3. **Row Level Security (RLS) en Postgres** — enforcement a nivel DB
4. **RBAC con 3 roles**: admin, editor, viewer
5. **Configuración independiente** — cada org tiene su LLM, theme default, branding
6. **Cuotas independientes** — rate limits y uso por org, no global
7. **Cache keys namespaced por orgId** — sin colisiones cross-tenant en Redis

## 2. Modelo de datos (Postgres + Drizzle)

### 2.1 Tablas core

```typescript
// db/schema.ts

// Organizaciones (tenants principales)
export const orgs = pgTable('orgs', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),         // 'acme-corp' en URL
  
  // LLM config (multi-provider)
  llmProvider: text('llm_provider').notNull().default('openai'),
  llmModel: text('llm_model').notNull().default('gpt-4o'),     // v0.3: default actualizado a modelo GA
  llmApiKeyEncrypted: text('llm_api_key_encrypted'),  // BYOK, cifrado
  llmFallbackProvider: text('llm_fallback_provider'),
  llmFallbackModel: text('llm_fallback_model'),
  
  // Theme & branding
  defaultTheme: text('default_theme').default('moderno-saas'),
  brandLogoUrl: text('brand_logo_url'),
  brandPrimaryColor: text('brand_primary_color'),
  
  // Plan & quotas
  plan: text('plan').notNull().default('free'),  // 'free' | 'pro' | 'enterprise'
  
  // Metadata
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// Usuarios globales (pueden pertenecer a múltiples orgs)
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  name: text('name'),
  avatarUrl: text('avatar_url'),
  
  emailVerified: boolean('email_verified').notNull().default(false),
  activeOrgId: uuid('active_org_id').references(() => orgs.id),
  
  createdAt: timestamp('created_at').notNull().defaultNow(),
  lastLoginAt: timestamp('last_login_at'),
});

// Relación many-to-many users ↔ orgs
export const orgMembers = pgTable('org_members', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  
  role: text('role').notNull(),  // 'admin' | 'editor' | 'viewer'
  
  invitedBy: uuid('invited_by').references(() => users.id),
  invitedAt: timestamp('invited_at').notNull().defaultNow(),
  joinedAt: timestamp('joined_at'),
  
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
  uniqueMember: unique().on(table.orgId, table.userId),
  orgIdx: index().on(table.orgId),
  userIdx: index().on(table.userId),
}));

// Invitaciones pendientes (link con token)
export const invitations = pgTable('invitations', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  role: text('role').notNull(),
  
  token: text('token').notNull().unique(),
  expiresAt: timestamp('expires_at').notNull(),
  
  invitedBy: uuid('invited_by').notNull().references(() => users.id),
  
  createdAt: timestamp('created_at').notNull().defaultNow(),
});
```

### 2.2 Tablas tenant-scoped

Todas las tablas que contienen datos de una org tienen `orgId`:

```typescript
// Data sources
export const dataSources = pgTable('data_sources', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
  // ...
});

// Dashboards
export const dashboards = pgTable('dashboards', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
  // ...
});

// Queries (audit log + saved queries)
export const queries = pgTable('queries', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
  // ...
});

// LLM usage tracking
export const llmUsage = pgTable('llm_usage', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
  // ...
});

// Audit log
export const auditLog = pgTable('audit_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
  userId: uuid('user_id'),
  action: text('action').notNull(),           // 'dashboard.created', 'datasource.connected', etc.
  resource: text('resource'),                 // 'dashboard:uuid'
  metadata: jsonb('metadata'),
  ip: text('ip'),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});
```

## 3. Row Level Security (RLS)

### 3.0 Por qué `FORCE ROW LEVEL SECURITY`

Postgres por defecto **no** aplica RLS al **owner** de la tabla (usualmente el rol con el que la app bootea). Sin `FORCE ROW LEVEL SECURITY`, los queries que corren como `postgres` o el rol `dashbi` dueño de la tabla **ven todas las filas de todas las orgs**.

**Regla:** toda tabla tenant-scoped debe llevar `FORCE ROW LEVEL SECURITY` además de `ENABLE ROW LEVEL SECURITY`. Esto obliga a las policies a aplicar también al owner, cerrando el bypass.

Implementado en `app/drizzle/migrations/0001_rls_policies.sql`.

### 3.1 Activar RLS en cada tabla (con FORCE ROW LEVEL SECURITY)

```sql
-- Ejecutar en migrations después de crear tablas
ALTER TABLE data_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_sources FORCE ROW LEVEL SECURITY;
ALTER TABLE dashboards ENABLE ROW LEVEL SECURITY;
ALTER TABLE dashboards FORCE ROW LEVEL SECURITY;
ALTER TABLE queries ENABLE ROW LEVEL SECURITY;
ALTER TABLE queries FORCE ROW LEVEL SECURITY;
ALTER TABLE llm_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE llm_usage FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
```

### 3.2 Policies

```sql
-- Policy: cada query debe filtrar por org_id del usuario actual
-- El org_id activo se setea via SET LOCAL antes de cada transacción

CREATE POLICY org_isolation_data_sources ON data_sources
  USING (org_id = current_setting('app.current_org_id')::uuid);

CREATE POLICY org_isolation_dashboards ON dashboards
  USING (org_id = current_setting('app.current_org_id')::uuid);

CREATE POLICY org_isolation_queries ON queries
  USING (org_id = current_setting('app.current_org_id')::uuid);

CREATE POLICY org_isolation_llm_usage ON llm_usage
  USING (org_id = current_setting('app.current_org_id')::uuid);

CREATE POLICY org_isolation_audit_log ON audit_log
  USING (org_id = current_setting('app.current_org_id')::uuid);

-- org_members: usuario solo ve memberships de orgs a las que pertenece
CREATE POLICY user_memberships ON org_members
  USING (user_id = current_setting('app.current_user_id')::uuid);

-- orgs: usuario solo ve orgs donde es miembro
CREATE POLICY user_orgs ON orgs
  USING (id IN (
    SELECT org_id FROM org_members 
    WHERE user_id = current_setting('app.current_user_id')::uuid
  ));

-- invitations: usuario solo ve invitations de sus orgs
CREATE POLICY user_org_invitations ON invitations
  USING (org_id IN (
    SELECT org_id FROM org_members 
    WHERE user_id = current_setting('app.current_user_id')::uuid
  ));
```

### 3.3 Set org context antes de cada query

```typescript
// lib/db/with-org.ts
import { db } from './client';

export async function withOrgContext<T>(
  orgId: string,
  userId: string,
  fn: () => Promise<T>
): Promise<T>;
export async function withOrgContext<T>(
  orgId: string,
  userId: string,
  role: OrgRole,
  fn: () => Promise<T>
): Promise<T>;
export async function withOrgContext<T>(
  orgId: string,
  userId: string,
  roleOrFn: OrgRole | (() => Promise<T>),
  fnMaybe?: () => Promise<T>
): Promise<T> {
  const role: OrgRole = typeof roleOrFn === 'function' ? 'editor' : roleOrFn;  // default 'editor' (legacy callers)
  const fn = typeof roleOrFn === 'function' ? roleOrFn : fnMaybe!;
  
  return await db.transaction(async (tx) => {
    // Set PostgreSQL session variables (scoped a esta transacción)
    // CRÍTICO: debe estar dentro de transacción, sino se filtra cross-tenant
    await tx.execute(sql`SET LOCAL app.current_org_id = ${orgId}`);
    await tx.execute(sql`SET LOCAL app.current_user_id = ${userId}`);
    await tx.execute(sql`SET LOCAL app.current_user_role = ${role}`);  // v0.2: role para query-engine filters
    return await fn();
  });
}

/**
 * ⚠️ REGLA DE ORO: TODA query a DB debe pasar por este wrapper.
 *
 * El Linter de CI rechaza `db.select()` directo en /app/api/.
 * Única excepción: scripts de system context (migrations, cleanup).
 *
 * v0.2: Acepta `role` opcional. Si no se pasa, default 'editor' (back-compat).
 *   - `viewer`: query-engine aplica filtros row-level (no PII columns)
 *   - `editor`/`admin`: sin filtros adicionales
 */
```

#### 3.3.1 Lint rule anti-data-leak (CRÍTICO)

```typescript
// .eslint-rules/no-raw-db-queries.ts (ya parcialmente implementado en repo)

export default {
  create(context) {
    return {
      CallExpression(node) {
        const filename = context.getFilename();
        if (!filename.includes('/app/api/') && !filename.includes('/lib/actions/')) return;

        const callee = context.getSourceCode().getText(node.callee);
        if (/^db\.(select|insert|update|delete)/.test(callee)) {
          context.report({
            node,
            messageId: 'noRawDbInApi',
            message:
              'Queries directas a `db.<op>()` en /app/api o /lib/actions deben pasar por `withOrgContext(orgId, userId, () => ...)`. Failure to do so bypasses RLS.',
          });
        }
      },
    };
  },
};
```

Tests de aislamiento (P0 del threat model):
```typescript
// tests/security/tenant-isolation.test.ts
describe('Cross-tenant isolation', () => {
  it('Org A cannot read Org B dashboards', async () => {
    const orgA = await createOrg();
    const orgB = await createOrg();
    const dashboard = await createDashboard(orgB.id, 'secret');

    const result = await withOrgContext(orgA.id, userA.id, () =>
      db.select().from(dashboardsTable)
    );

    expect(result).toEqual([]);
  });

  it('Org A cannot read Org B data sources', ...);
  it('Org A cannot read Org B queries', ...);
  it('Org A cannot read Org B llm_usage', ...);
  it('Org A cannot read Org B audit_log', ...);
  it('RLS is enforced even when withOrgContext is forgotten (should fail)', ...);
});
```

**Linter rule (CRÍTICO para seguridad):**

```typescript
// .eslintrc.js — regla custom
module.exports = {
  rules: {
    'no-raw-db-queries': {
      create(context) {
        return {
          CallExpression(node) {
            // Bloquear db.select/update/insert/delete directos en /app/api/
            if (isInAppApi(context.getFilename()) && isRawDbCall(node)) {
              context.report({
                node,
                message: 'Use withOrgContext() instead of raw db queries in API routes',
              });
            }
          },
        };
      },
    },
  },
};
```

**Uso:**
```typescript
// En API routes
export async function GET(req: Request) {
  const { orgId, userId } = await getAuthContext(req);
  
  const dashboards = await withOrgContext(orgId, userId, async () => {
    return await db.select().from(dashboardsTable);
  });
  
  return Response.json({ dashboards });
}
```

### 3.4 Bypass para admin operations (cuidado)

```typescript
// Para operaciones del sistema (migrations, cleanup) que no respetan RLS
export async function withSystemContext<T>(fn: () => Promise<T>): Promise<T> {
  return await db.transaction(async (tx) => {
    // No seteamos app.current_org_id → RLS bloquea todo
    // Usamos conexión con rol de sistema
    return await fn();
  });
}
```

Solo usar para: migrations, cleanup jobs, admin scripts.

## 4. RBAC: 3 roles

### 4.1 Permisos por rol

| Acción | Admin | Editor | Viewer |
|--------|:-----:|:------:|:------:|
| Invitar miembros | ✅ | ❌ | ❌ |
| Eliminar miembros | ✅ | ❌ | ❌ |
| Cambiar plan/billing | ✅ | ❌ | ❌ |
| Configurar LLM provider | ✅ | ❌ | ❌ |
| Ver API keys cifradas | ✅ | ❌ | ❌ |
| Conectar data sources | ✅ | ✅ | ❌ |
| Eliminar data sources | ✅ | ✅ | ❌ |
| Crear dashboards | ✅ | ✅ | ❌ |
| Editar dashboards | ✅ | ✅ | ❌ |
| Eliminar dashboards | ✅ | ✅ | ❌ |
| Generar con IA | ✅ | ✅ | ❌ |
| Ejecutar queries | ✅ | ✅ | ✅ |
| Ver dashboards | ✅ | ✅ | ✅ |
| Exportar PDF/PNG | ✅ | ✅ | ✅ |
| Compartir link público | ✅ | ✅ | ❌ |

### 4.2 Helper de permisos

```typescript
// lib/auth/permissions.ts

export type OrgRole = 'admin' | 'editor' | 'viewer';

const PERMISSIONS: Record<string, OrgRole[]> = {
  'org.invite': ['admin'],
  'org.removeMember': ['admin'],
  'org.updateBilling': ['admin'],
  'org.updateLLMConfig': ['admin'],
  
  'datasource.create': ['admin', 'editor'],
  'datasource.delete': ['admin', 'editor'],
  'datasource.view': ['admin', 'editor', 'viewer'],
  
  'dashboard.create': ['admin', 'editor'],
  'dashboard.edit': ['admin', 'editor'],
  'dashboard.delete': ['admin', 'editor'],
  'dashboard.view': ['admin', 'editor', 'viewer'],
  'dashboard.sharePublic': ['admin', 'editor'],
  
  'query.execute': ['admin', 'editor', 'viewer'],
  'export.pdf': ['admin', 'editor', 'viewer'],
};

export function hasPermission(role: OrgRole, action: string): boolean {
  return PERMISSIONS[action]?.includes(role) ?? false;
}

// Helper para API routes
export async function requirePermission(
  userId: string,
  orgId: string,
  action: string
): Promise<void> {
  const member = await db.query.orgMembers.findFirst({
    where: and(
      eq(orgMembers.userId, userId),
      eq(orgMembers.orgId, orgId)
    ),
  });
  
  if (!member) {
    throw new ForbiddenError('Not a member of this org');
  }
  
  if (!hasPermission(member.role as OrgRole, action)) {
    throw new ForbiddenError(`Role '${member.role}' cannot perform '${action}'`);
  }
}
```

### 4.3 UI: badges y gates

```typescript
// components/PermissionGate.tsx

export function PermissionGate({ 
  action, 
  orgId, 
  children, 
  fallback = null 
}: { 
  action: string; 
  orgId: string; 
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  const { role } = useOrgMembership(orgId);
  if (!hasPermission(role, action)) return <>{fallback}</>;
  return <>{children}</>;
}

// Uso en componentes
<PermissionGate action="datasource.create" orgId={orgId}>
  <Button onClick={openNewDataSourceDialog}>Add data source</Button>
</PermissionGate>
```

## 5. Auth context por request

```typescript
// lib/auth/context.ts

export type AuthContext = {
  userId: string;
  email: string;
  orgId: string;        // org activo en este request
  role: OrgRole;
};

export async function getAuthContext(req: Request): Promise<AuthContext> {
  // Extrae session del cookie/header
  const session = await betterAuth.api.getSession({ headers: req.headers });
  
  if (!session?.user) {
    throw new UnauthorizedError('Not authenticated');
  }
  
  // Determina orgId del header o query param
  const url = new URL(req.url);
  const orgId = req.headers.get('x-org-id') || url.searchParams.get('orgId');
  
  if (!orgId) {
    throw new BadRequestError('orgId required');
  }
  
  // Verifica membership + role
  const member = await db.query.orgMembers.findFirst({
    where: and(
      eq(orgMembers.userId, session.user.id),
      eq(orgMembers.orgId, orgId)
    ),
  });
  
  if (!member) {
    throw new ForbiddenError('Not a member of this org');
  }
  
  return {
    userId: session.user.id,
    email: session.user.email,
    orgId,
    role: member.role as OrgRole,
  };
}
```

## 6. Quotas por org

```typescript
const PLAN_QUOTAS = {
  free: {
    members: 3,
    dataSources: 2,
    dashboards: 5,
    generationsPerHour: 20,
    maxTokensPerDay: 100000,
    llmProviders: 1,            // solo puede usar 1 provider
  },
  pro: {
    members: 20,
    dataSources: 10,
    dashboards: 50,
    generationsPerHour: 200,
    maxTokensPerDay: 5000000,
    llmProviders: 3,
  },
  enterprise: {
    members: -1,                // ilimitado
    dataSources: -1,
    dashboards: -1,
    generationsPerHour: -1,
    maxTokensPerDay: -1,
    llmProviders: 5,
  },
};

export async function checkQuota(orgId: string, resource: keyof typeof PLAN_QUOTAS['free']): Promise<boolean> {
  const org = await db.query.orgs.findFirst({ where: eq(orgs.id, orgId) });
  const limit = PLAN_QUOTAS[org.plan][resource];
  
  if (limit === -1) return true;  // ilimitado
  
  // Contar uso actual
  // ...
}
```

## 7. Audit log

```typescript
// lib/audit/log.ts

export async function audit(
  orgId: string,
  userId: string,
  action: string,
  resource?: string,
  metadata?: Record<string, unknown>,
  req?: Request
): Promise<void> {
  await db.insert(auditLog).values({
    orgId,
    userId,
    action,
    resource,
    metadata,
    ip: req?.headers.get('x-forwarded-for') || undefined,
    userAgent: req?.headers.get('user-agent') || undefined,
  });
}

// Uso
await audit(orgId, userId, 'dashboard.created', `dashboard:${dashboardId}`, { promptLength: prompt.length });
await audit(orgId, userId, 'datasource.connected', `datasource:${dsId}`, { type: 'stripe' });
```

### 7.1 Retention policy (Fase 2 — no MVP)

Para evitar crecimiento ilimitado:

- **Tabla:** partitioning mensual por `created_at` (`pg_partman` o manual)
- **Retención por plan:**
  - Free: 30 días
  - Pro: 90 días
  - Enterprise: 365 días (configurable)
- **Cleanup:** cron job diario en docker-compose (`scripts/cleanup-audit-log.sh`)
- **Export:** enterprise puede descargar su audit log antes de borrarse (Fase 2)

En MVP (sin partitioning), la tabla crece ~5-10k rows/día con 10 orgs activas. A los 6 meses son 1.5M-3M rows. La query por `(org_id, action)` sigue siendo rápida con índice hasta ~10M rows. Si pasa eso, particionar.

### 7.2 Índices (sincronizar con `src/db/schema.ts`)

```typescript
// db/schema.ts — audit_log
(t: typeof auditLog) => ({
  orgIdx: index('audit_log_org_idx').on(t.orgId),
  createdAtIdx: index('audit_log_created_at_idx').on(t.createdAt),
  actionIdx: index('audit_log_org_action_idx').on(t.orgId, t.action),    // típico: "todas las exports"
  userIdx: index('audit_log_org_user_idx').on(t.orgId, t.userId),         // típico: "acciones de user X"
});
```

### 7.3 Eventos tracked

```typescript
type AuditEvent =
  | 'auth.login' | 'auth.logout' | 'auth.signup' | 'auth.magic_link_used' | 'auth.failed_login'
  | 'org.created' | 'org.member_invited' | 'org.member_removed' | 'org.role_changed'
  | 'llm.config_updated' | 'llm.api_key_created' | 'llm.api_key_rotated' | 'llm.api_key_deleted'
  | 'datasource.connected' | 'datasource.tested' | 'datasource.schema_refreshed' | 'datasource.deleted'
  | 'dashboard.created' | 'dashboard.updated' | 'dashboard.deleted' | 'dashboard.generated' | 'dashboard.shared'
  | 'query.executed' | 'query.failed' | 'query.cache_hit'
  | 'export.pdf' | 'export.png' | 'export.link_generated' | 'export.link_revoked'
  | 'public_link.viewed';
```

## 8. Política de caching Next.js 16

Next.js 16 cambió defaults. Toda interacción con data tenant-scoped debe ser `no-store`:

| Contexto | Default | Override |
|----------|---------|----------|
| RSC que lee DB con `orgId` | `'use cache: private'` con `cacheTag(orgId)` | Para widgets read-only de dashboard publicado |
| RSC que escribe/mutla | `'no-store'` | Forzado |
| API routes con auth | `export const dynamic = 'force-dynamic'` | Forzado |
| Server actions que mutan | `'no-store'` | Forzado |
| `/share/[token]` page | `'use cache: private'` con `cacheTag(token)` | TTL 30s, invalidated al `revokedAt` |

**Reglas operativas:**
- Toda RSC que llame `withOrgContext()` debe declararse `dynamic = 'force-dynamic'` (Drizzle no cachea queries igual que Prisma)
- TanStack Query maneja cache de queries con `queryKey: ['dashboard', orgId, dashboardId]` — invalidation al mutate
- Lint rule rechaza RSC que importen `db` sin `force-dynamic` (regla custom en `.eslint-rules/`)
- Tests E2E verifican que respuestas cross-tenant NUNCA se cachean (CI)

Cache de queries en Redis (ver `query-engine.md` §5): key SIEMPRE namespaced por `orgId` (`query:{orgId}:{dataSourceId}:{hash}`). Si el deploy multi-instancia comparte Redis, agregar prefijo por instalación.

## 9. Esquema canónico (referencia)

Confirmar `src/db/schema.ts` con estos índices:

```typescript
// En dataSources
orgIdx: index('data_sources_org_idx').on(t.orgId),

// En users
activeOrgIdx: index('users_active_org_idx').on(t.activeOrgId),
activeOrgFk: foreignKey({
  columns: [t.activeOrgId],
  foreignColumns: [orgs.id],
  name: 'users_active_org_fk',
}),  // nullable, onDelete: 'set null'
```

Si `users.activeOrgId` apunta a una orgId inexistente, no rompe la app: el middleware detecta `orgId` faltante y devuelve error claro al cliente.

## 10. Acceptance criteria

- [ ] Las 3 tablas core (orgs, users, orgMembers) están creadas
- [ ] RLS activado en todas las tablas tenant-scoped
- [ ] Policies creadas y testeadas con SQL directo
- [ ] Helper `withOrgContext` funciona en API routes
- [ ] Lint rule anti-data-leak rechaza queries directas en `/app/api` y `/lib/actions`
- [ ] 3 roles implementados con `hasPermission` helper
- [ ] UI respeta permisos (PermissionGate en componentes)
- [ ] Quotas por plan enforced en acciones críticas
- [ ] Audit log guarda cada acción importante (lista completa en §7.3)
- [ ] `audit_log` tiene índices `(org_id, action)` y `(org_id, user_id)`
- [ ] `users.activeOrgId` tiene FK nullable + índice
- [ ] No se puede acceder a data de otra org (test de seguridad)
- [ ] Multi-org para un mismo usuario funciona (selector de org)
- [ ] Rutas que tocan data tenant-scoped están marcadas `dynamic = 'force-dynamic'`

## 11. Out of scope (MVP)

- ❌ SSO/SAML (Fase 2)
- ❌ Custom roles (solo 3 hardcoded)
- ❌ Org-level API tokens (para integraciones externas)
- ❌ Sub-organizations / jerarquías
- ❌ Cross-org data sharing
- ❌ Audit log export

## 12. Riesgos

| Riesgo | Mitigación |
|--------|-----------|
| Bug en RLS → data leak | Tests de seguridad + code review + audit log |
| Usuario cambia de org sin refresh | Forzar reload del contexto en cada request |
| Admin bypassea RLS por error | Rol de sistema separado, código revisado |
| Quota bypass | Check en server actions, no confiar en cliente |
| Audit log crece infinito | Particionado por mes + retention policy |

## 13. Specs relacionados

- `auth.md` — flujo concreto de login/signup
- `connectors.md` — data sources son tenant-scoped
- `query-engine.md` — cache de queries namespaced por orgId
- `widget-system.md` — dashboards son tenant-scoped