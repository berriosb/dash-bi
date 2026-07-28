# Spec: Security Threat Model

> Análisis de amenazas antes de codear dash-bi. Define los controles de seguridad obligatorios antes de implementar SQL execution, BYOK, multi-tenant y AI integration.

**Status:** v0.2 (sync 2026-07-27, controles marcados según implementación real)
**Prioridad:** P0 — bloquea implementación
**Responsable:** codehak

---

## 1. Vectores de amenaza principales

### T1 — Cross-tenant data leak

**Amenaza:** Usuario de Org A lee data de Org B via query directa o SQL injection.

**Controles obligatorios:**
- [x] Postgres RLS policies activas en TODAS las tablas tenant-scoped
- [x] `withOrgContext(orgId, userId, fn)` wrapper obligatorio
- [x] ESLint rule custom que rechaza `db.select()` directo en `/app/api/`
- [x] DB user con permisos SELECT-only (sin DML/DDL)
- [x] Tests Vitest de aislamiento (cross-tenant queries devuelven `[]`)
- [x] Audit log de cada query ejecutada (con `org_id` y user_id)

**Tests críticos:**
```typescript
// tests/security/tenant-isolation.test.ts
describe('Tenant Isolation', () => {
  it('Org A cannot read Org B dashboards', async () => {
    const orgA = await createOrg();
    const orgB = await createOrg();
    
    const dashboard = await createDashboard(orgB.id, 'secret');
    
    const result = await withOrgContext(orgA.id, userA.id, () =>
      db.select().from(dashboardsTable)
    );
    
    expect(result).toEqual([]);  // Org A no ve nada de Org B
  });
});
```

### T2 — SQL injection via AI-generated queries

**Amenaza:** La IA genera SQL malicioso (DROP TABLE, exfiltración de data, etc.).

**Controles obligatorios:**
- [x] `validateQuery()` bloquea DML/DDL (INSERT, UPDATE, DELETE, DROP, ALTER, CREATE)
- [x] Regex check: solo `SELECT`, `WITH`, `EXPLAIN`
- [x] Auto-inject `LIMIT 10000` si no tiene
- [x] DB user read-only (defense in depth)
- [x] AI nunca recibe prompts de SQL previos del usuario (no aprende a saltarse validación)
- [x] Policy engine en `AiGateway` que valida ANTES de ejecutar

```typescript
// lib/security/validate-query.ts
export function validateQuery(query: Query, type: ConnectorType): void {
  if (type === 'postgres') {
    if (query.kind !== 'sql') throw new ValidationError('Postgres expects SQL');
    const sql = query.sql.trim().toUpperCase();
    
    if (!/^(SELECT|WITH|EXPLAIN)/.test(sql)) {
      throw new ValidationError('Only SELECT queries allowed');
    }
    
    const forbidden = /\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE|GRANT|REVOKE)\b/;
    if (forbidden.test(sql)) throw new ValidationError('DML/DDL not allowed');
    
    // No stacked queries (separados por ;)
    if (query.sql.includes(';') && !query.sql.trim().endsWith(';')) {
      throw new ValidationError('Multi-statement queries not allowed');
    }
    
    // Auto-inject LIMIT
    if (!/LIMIT\s+\d+/i.test(query.sql)) {
      query.sql = `${query.sql.replace(/;?\s*$/, '')} LIMIT 10000`;
    }
  }
}
```

### T3 — SSRF via PostgreSQL connection string

**Amenaza:** Usuario malicioso configura un data source apuntando a un Postgres interno (e.g., RDS metadata endpoint, internal services).

**Controles obligatorios:**
- [x] Allowlist de hosts permitidos para Postgres connection (no se puede conectar a localhost, 169.254.169.254, RFC1918)
- [x] Validación de connection string al guardar
- [x] Test connection antes de guardar
- [x] DB user de dash-bi (no del usuario) con permisos limitados

```typescript
// lib/security/validate-connection.ts
const FORBIDDEN_HOSTS = [
  'localhost',
  '127.0.0.1',
  '::1',                      // IPv6 loopback
  '169.254.169.254',          // AWS metadata (IPv4)
  'fd00:ec2::254',            // AWS metadata (IPv6)
  'metadata.google.internal',
  // RFC1918 (IPv4)
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  // RFC4193 (IPv6 ULA)
  /^fc[0-9a-f]{2}:/i,
  // Link-local IPv6
  /^fe[89ab][0-9a-f]:/i,
];

export function validatePostgresHost(host: string): void {
  if (FORBIDDEN_HOSTS.some(h => h === host || (h instanceof RegExp && h.test(host)))) {
    throw new ValidationError(`Host ${host} not allowed`);
  }
}
```

### T4 — BYOK API key leak

**Amenaza:** API key de OpenAI/Anthropic del usuario queda en logs, responses, o DB sin cifrar.

**Controles obligatorios:**
- [x] AES-256-GCM con master key de env variable (NO commit)
- [x] Master key rotable (sin downtime)
- [x] Regex redaction en logs: `/(sk-|sk_)[a-zA-Z0-9-]{20,}/g` → `'[REDACTED]'`
- [x] Field-level encryption en DB (no plaintext en ningún campo)
- [x] API keys NUNCA en responses (select whitelist explícito)
- [x] Audit log de cada lectura de key

```typescript
// lib/security/redact.ts
const API_KEY_PATTERNS = [
  /sk-[a-zA-Z0-9]{20,}/g,           // OpenAI
  /sk-ant-[a-zA-Z0-9-]{20,}/g,      // Anthropic
  /AIza[a-zA-Z0-9_-]{35}/g,         // Google
];

export function redactSecrets(input: string): string {
  let redacted = input;
  for (const pattern of API_KEY_PATTERNS) {
    redacted = redacted.replace(pattern, '[REDACTED]');
  }
  return redacted;
}

// Aplicar en logger
const logger = pino({
  formatters: {
    log: (obj) => redactSecrets(JSON.stringify(obj)),
  },
});
```

### T5 — Rate limit / cost runaway

**Amenaza:** Usuario con API key genera miles de dashboards → costo $1000+ en un día.

**Controles obligatorios:**
- [x] Rate limit por org (20/200/ilimitado por plan)
- [x] Token budget diario por org
- [x] Circuit breaker: si costo/hora > umbral, desactivar IA
- [x] Alerta en UI si se acerca al límite
- [x] Revoke de API key si se detecta abuso

```typescript
// lib/ai/rate-limit.ts
export async function checkRateLimit(orgId: string): Promise<void> {
  const usage = await getOrgUsage(orgId);
  const limits = PLAN_QUOTAS[usage.plan];
  
  if (limits.generationsPerHour !== -1 && usage.generationsLastHour >= limits.generationsPerHour) {
    throw new RateLimitError(`Hourly limit reached (${limits.generationsPerHour})`);
  }
  
  if (limits.maxTokensPerDay !== -1 && usage.tokensLastDay >= limits.maxTokensPerDay) {
    throw new RateLimitError(`Daily token limit reached`);
  }
}
```

### T6 — Public link abuse

**Amenaza:** Link público compartido se vuelve viral, alguien scrapea data sensible.

**Controles obligatorios:**
- [x] Link público con token random 32+ chars (`2^192` combinaciones, brute force no factible)
- [x] Rate limit por IP en links públicos (100 requests/hora)
- [x] View counter + alerta si views > 1000/día
- [x] robots.txt: `Disallow: /share/`
- [x] Optional: expiration date (default 30 días)

### T7 — Dashboard JSON injection

**Amenaza:** Widget JSON malformado (campos faltantes, types incorrectos) rompe el render.

**Controles obligatorios:**
- [x] Zod validation en TODA escritura a `dashboards.widgets`
- [x] Client-side también valida (no confiar en server)
- [x] Si falla validación en client, revierte el cambio
- [x] Try/catch en render de cada widget (1 widget roto no rompe el dashboard)

### T8 — Puppeteer RCE

**Amenaza:** URL maliciosa en public link ejecuta JS en el contexto de Puppeteer cuando se exporta a PDF.

**Controles obligatorios:**
- [x] Puppeteer corre en **worker service separado** (no comparte DB con app principal)
- [x] `--no-sandbox` solo si es necesario (con `--disable-setuid-sandbox`)
- [x] Timeout en cada navegación (30s max)
- [x] Block de dominios internos (mismas allowlists que T3, incluyendo IPv6)
- [x] Cleanup garantizado (try/finally + `browser.close()`)
- [x] Memoria limitada (max 2GB por export)
- [x] Queue con concurrencia limitada (max 3 exports simultáneos)

---

## 2. Controles transversales (siempre activos)

### C1 — Logging sin secrets
- Logger Pino con formateador que redacta secrets
- No loguear config descifrado
- No loguear SQL completo en error (solo query hash + primeros 100 chars)

### C2 — Audit log completo
- Toda acción importante queda en `audit_log`
- Eventos tracked:
  - Login / logout / signup
  - Dashboard created/updated/deleted
  - Data source connected/deleted
  - AI generation
  - Export (PDF/PNG/link)
  - BYOK key created/rotated/deleted

### C3 — HTTPS obligatorio
- HSTS enabled
- Cookies `Secure` + `HttpOnly` + `SameSite=Lax`
- TLS en Docker Compose (nginx reverse proxy)

### C4 — Backup y recovery
- Postgres backups diarios (cron en docker-compose)
- Retención 30 días
- Restore drill probado (Fase 1 setup)

### C5 — Dependency management
- `npm audit` en CI (cada PR)
- Renovate bot para updates
- Lockfile pinned
- SBOM generado

---

## 3. Tests de seguridad obligatorios

### T1 — Tenant isolation
```typescript
describe('Cross-tenant isolation', () => {
  it('read isolation', ...);
  it('write isolation', ...);
  it('export isolation', ...);
  it('cache isolation', ...);
  it('error log isolation', ...);
});
```

### T2 — SQL injection
```typescript
describe('SQL injection prevention', () => {
  it('rejects DROP TABLE', ...);
  it('rejects stacked queries', ...);
  it('rejects comments-based injection', ...);
  it('auto-injects LIMIT', ...);
  it('validates SQL via DB user permissions', ...);
});
```

### T3 — SSRF
```typescript
describe('SSRF prevention', () => {
  it('rejects localhost', ...);
  it('rejects AWS metadata endpoint', ...);
  it('rejects RFC1918 IPs', ...);
});
```

### T4 — BYOK security
```typescript
describe('API key security', () => {
  it('keys are encrypted at rest', ...);
  it('keys never appear in logs', ...);
  it('keys never appear in API responses', ...);
  it('key rotation works', ...);
});
```

### T5 — Rate limit
```typescript
describe('Rate limiting', () => {
  it('hourly generation limit enforced', ...);
  it('daily token limit enforced', ...);
  it('circuit breaker triggers on high cost', ...);
});
```

---

## 4. Pre-implementation checklist

Antes de escribir la primera línea de código de SQL execution:

- [x] RLS policies creadas en todas las tablas
- [x] `withOrgContext()` implementado + tests
- [x] `validateQuery()` implementado + tests
- [x] `validatePostgresHost()` implementado + tests
- [x] AES-256-GCM encryption implementado + tests
- [x] Pino con redactor implementado + tests
- [x] Rate limit por org implementado + tests
- [x] ESLint rule custom instalada
- [x] Audit log funcionando
- [x] DB user read-only creado en docker-compose

- [x] RLS policies creadas en todas las tablas
- [x] `withOrgContext()` implementado + tests
- [x] `validateQuery()` implementado + tests
- [x] `validatePostgresHost()` implementado + tests
- [x] AES-256-GCM encryption implementado + tests
- [x] Pino con redactor implementado + tests
- [x] Rate limit por org implementado + tests
- [x] ESLint rule custom instalada
- [x] Audit log funcionando
- [x] DB user read-only creado en docker-compose

**Los 10 controles pre-implementación están ✅ ver Sprint 1 (ver `README.md` §Status).**