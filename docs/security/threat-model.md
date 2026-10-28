# Spec: Security Threat Model

> Análisis de amenazas antes de codear dash-bi. Define los controles de seguridad obligatorios antes de implementar SQL execution, BYOK, multi-tenant y AI integration.

**Status:** v0.4 (reconciliado contra el código — 2026-10-28)
**Prioridad:** P0 — bloquea implementación
**Responsable:** codehak

> **Cómo leer este documento.** Cada control marcado `[x]` va acompañado de dos punteros: el archivo que lo **implementa** y el test que lo **fija**. Un `[x]` sin puntero es una afirmación sin evidencia, y es exactamente lo que hizo que este documento sirviera de lista de deseos durante dos auditorías. Cada control marcado `[ ]` dice **qué falta** y **dónde vive el hueco**. Si un `[x]` deja de sostenerse, el fix es el código, no esta lista.

---

## 0. Correcciones de esta pasada

Este documento declaraba controles implementados que el código no tenía. La tabla deja visible la deriva y, para cada control, el commit que lo volvió cierto:

| Control | Commit | Qué lo volvió cierto |
| --- | --- | --- |
| **T2** — blocklist SQL compartida | `7ce0baf` | `set_config`, `current_setting`, `pg_terminate_backend`, `pg_cancel_backend`, `INTO`, `COPY` y `PROGRAM` entraron a la blocklist común, y todas las ramas SQL-backed pasan por un único `assertSafeSqlStatement`. |
| **T3** — host SSRF normalizado | `b21bb58` | El host se canonicaliza (URL, userinfo, path, punto final, corchetes IPv6, puerto) y se contrasta contra sets exactos + rangos privados IPv4/IPv6 + nombres de servicio internos. Además se corrigió el bug de `parseIpv4Literal` (`2130706433` se parseaba como `1.0.0.0`). |
| **T1** — `dashbi_readonly` sin tablas internas | `7ce0baf` | La migración `0019` revoca `ALL` sobre nueve tablas internas y revoca el `DEFAULT PRIVILEGE` que el bootstrap concedía, así que una tabla creada después tampoco es legible. |
| **T5** — rate limit por org | `2cbbf50`, `6598792` | Cada ruta limitada chequea un bucket **de org** y uno **de IP**, por separado; la IP se resuelve con el último hop confiado; siete rutas sin límite ahora tienen uno; `export.pdf` ya no es de `viewer`. |
| **T6** — payload público y CSP por token | `1166895` | El share y el embed ya no envían `source.query.sql` ni `source.dataSourceId`, y el middleware emite `frame-ancestors` con los orígenes del propio token. |
| **C5** — gate de auditoría | `f124818` | El job vivía en `app/.github/workflows/ci.yml`, donde GitHub nunca lo ejecutaba (Actions solo descubre workflows bajo `.github/workflows/` de la raíz). Movido al workflow de la raíz y baseline actualizado. |
| **T2 / C1** — errores de driver | `811482e` | El error crudo del driver ya no vuelve al cliente. |
| **T2** — segunda línea contra el pivote del GUC | `110bcfd` | El GUC `app.current_org_id` es texto plano y Postgres no lo protege: contra un Postgres 16 real se comprobó que **una sola sentencia** re-apunta el contexto y devuelve filas de otra org. `withOrgContextReadOnly` verifica el contexto después de la sentencia y antes de que las filas salgan de la transacción, y limpia los GUC de sesión si detecta manipulación. |
| **T5** — el control de export se oculta a `viewer` | `7d73e1b` | El backend ya respondía 403; ahora la UI tampoco renderiza el botón "Exportar & Compartir" cuando el rol de la org activa sabe que no puede exportar. |

Los controles que **no** están implementados y que antes figuraban como `[x]` se marcaron `[ ]` y dicen dónde vive el hueco. Los que sí están implementados y antes figuraban como `[ ]` (por ejemplo `robots.txt`) se marcaron `[x]`.

---

## 1. Vectores de amenaza principales

### T1 — Cross-tenant data leak

**Amenaza:** Usuario de Org A lee data de Org B via query directa o SQL injection.

**Controles obligatorios:**
- [x] Postgres RLS policies activas en TODAS las tablas tenant-scoped — `ENABLE` + `FORCE ROW LEVEL SECURITY` en las 15 tablas tenant-scoped: `app/drizzle/migrations/0001_rls_policies.sql` → `0017_production_rls_and_readonly_hardening.sql` (passa por `0002`, `0007`, `0012`, `0013`, `0015`). Las 4 tablas de auth (`users`, `sessions`, `accounts`, `verifications`) **no** son tenant-scoped: se protegen revocando el acceso de `dashbi_readonly` en la migración `0017`.
  - Test: `app/tests/integration/rls-isolation.test.ts` — una query de la org A devuelve `[]` sobre datos de la org B.
- [x] `withOrgContext(orgId, userId, fn)` wrapper obligatorio — `app/src/db/client.ts:92`. Acepta `role` opcional; el callback **debe** usar el `tx` que recibe (usar `db` adentro del callback esquiva las GUC, y el ESLint rule lo bloquea).
  - Test: `app/tests/integration/rls-isolation.test.ts` — `withOrgContext(orgA.id, …)` no ve filas de la org B.
- [x] ESLint rule custom que rechaza `db.select()` directo en `/app/api/` — `app/.eslint-rules/no-raw-db-queries.cjs`, regla `dash-bi/no-raw-db-queries`, activada en `app/eslint.config.mjs`. También rechaza `db.X()` **dentro** de un callback de `withOrgContext` y cubre `app/src/worker/`.
- [x] DB user con permisos SELECT-only (sin DML/DDL) — el rol `dashbi_readonly` es el único que ejecuta SQL de usuario. `app/drizzle/migrations/0019_readonly_revoke_internal_tables.sql` le revoca `ALL` sobre `dashboards`, `dashboard_versions`, `llm_usage`, `nlqa_conversations`, `nlqa_messages`, `scheduled_reports`, `scheduled_report_runs`, `alert_events` y `uploaded_files`, y revoca el `DEFAULT PRIVILEGE` sobre `public` que el bootstrap concedía. El bootstrap ya no lo concede: `scripts/postgres/init-roles.sh` y `app/tests/integration/postgres.ts`.
  - Tests: `app/tests/unit/security/readonly-role-grants.test.ts` (revocación sobre las 9 tablas + ausencia del default privilege en ambos bootstraps) y los dos casos de la migración `0019` en `app/tests/integration/rls-isolation.test.ts` (privilegio real contra Postgres + tabla creada después no legible).
- [x] Tests Vitest de aislamiento (cross-tenant queries devuelven `[]`) — `app/tests/security/tenant-isolation.test.ts` (capa lógica: filtros por rol) y `app/tests/integration/rls-isolation.test.ts` (Postgres real, RLS enforcing).
- [ ] Audit log de cada query ejecutada (con `org_id` y user_id) — **no implementado**: `query.executed`, `query.failed` y `query.cache_hit` están declarados en `app/src/lib/audit/events.ts` pero no tienen **ningún** sitio de emisión en `app/src`. El `audit_log` registra acciones de API (dashboard, alert rule, export, NLQA, scheduled report…), no cada query ejecutada.

**Tests críticos:**
```typescript
// app/tests/integration/rls-isolation.test.ts
describe('T1 — Cross-tenant isolation (Postgres RLS, real DB)', () => {
  itWithDb('withOrgContext(orgId, userId, fn) isolates per tenant', async () => {
    const result = await withOrgContext(orgA.id, userA.id, async (tx) =>
      tx.query.dashboards.findMany()
    );

    expect(result).toEqual([]);  // Org A no ve nada de Org B
  });
});
```

### T2 — SQL injection via AI-generated queries

**Amenaza:** La IA genera SQL malicioso (DROP TABLE, exfiltración de data, etc.).

**Controles obligatorios:**
- [x] `validateQuery()` bloquea DML/DDL (INSERT, UPDATE, DELETE, DROP, ALTER, CREATE) — la blocklist viva es `DML_DDL_KEYWORDS` en `app/src/lib/security/validate-query.ts:24` e incluye además `TRUNCATE`, `GRANT`, `REVOKE`, `INTO`, `COPY` y `PROGRAM`.
  - Test: `app/tests/unit/security/validate-query-blocked-statements.test.ts` — `SELECT * INTO evil FROM orders` y `COPY orders TO PROGRAM 'sh -c id'` se rechazan en los cinco conectores SQL y en los tres de planilla.
- [x] Regex check: solo `SELECT`, `WITH`, `EXPLAIN` — `assertSafeSqlStatement()` (`app/src/lib/security/validate-query.ts:124`) es el helper **único** por el que pasan postgres, mysql, hubspot, snowflake, shopify y spreadsheet/csv/excel. Antes cada rama reimplementaba el chequeo y derivaron: la rama de shopify solo verificaba la palabra inicial, así que un token bloqueado pasaba de largo.
- [x] Auto-inject `LIMIT 10000` si no tiene — `normalizeSqlLimit()` (`app/src/lib/security/validate-query.ts:162`) inyecta `LIMIT 10000` y además **clampa** un `LIMIT` mayor al máximo. `validateQuery` es puro: devuelve el SQL normalizado, no muta el argumento.
  - Tests: `app/tests/unit/security/validate-query-purity.test.ts` (pureza) y `app/tests/unit/security/validate-query-blocked-statements.test.ts` (inyección y clamp).
- [x] DB user read-only (defense in depth) — ver **T1**: rol `dashbi_readonly` + migración `0019`.
- [x] Funciones peligrosas de DB bloqueadas — `DANGEROUS_DB_FUNCTIONS` (`app/src/lib/security/validate-query.ts:46`): `set_config` y `current_setting` (re-apuntan el GUC `app.current_org_id` que leen todas las policies RLS), `pg_terminate_backend` y `pg_cancel_backend`, `pg_read_file` y familia, `lo_import`/`lo_export`, `load_file`, `dblink`, `pg_sleep`, `benchmark`, `COPY … TO PROGRAM`.
  - Test: `app/tests/unit/security/validate-query-blocked-statements.test.ts`.
- [x] **Segunda línea** contra el pivote del GUC (la blocklist es la primera) — el GUC es texto plano y Postgres no protege: cualquier rol puede re-apuntar `app.current_org_id` para su propia sesión. Comprobado contra un Postgres 16 real: **una sola sentencia** re-apunta el contexto y devuelve filas de otra org (`WITH x AS (SELECT set_config('app.current_org_id', '<otra org>', true)) SELECT … FROM otra_org.uploads`), y la forma de **sesión** (`set_config(…, false)`) también funciona, incluso reemplazando el valor transaccional que la app fija. Escribir sigue bloqueado: el rol es solo-SELECT.
  - `withOrgContextReadOnly` —el único camino por donde corre SQL de usuario (conector de spreadsheet y evaluador de alertas— verifica org, usuario y rol **después** de la sentencia y **antes** de que las filas salgan de la transacción. Un contexto manipulado aborta la transacción con `tenant.cross_tenant_access` (403) y **limpia los GUC de sesión**: un valor de sesión sobrevive al rollback, así que sin esa limpieza la conexión volvería al pool con el id de otra org.
  - Archivo: `app/src/db/org-context.ts` (`assertOrgContextIntact`), cableado en `app/src/db/client.ts`.
  - Tests: `app/tests/unit/db/org-context.test.ts`, `app/tests/unit/db/with-org-context-readonly.test.ts`, `app/tests/integration/org-context-guard.test.ts` (el leak reproducido contra Postgres real y el guard cortándolo).
- [x] Policy engine que valida ANTES de ejecutar — la validación vive en la **ruta** y **dentro de cada connector**, no en la clase `AiGateway`: `app/src/app/api/nlqa/ask/route.ts:236` valida antes de `executeWithTimeout`, y `app/src/lib/query-engine/execute.ts:73` re-valida con el rol antes de ejecutar. Los connectors vuelven a validar por su cuenta (`app/src/lib/connectors/implementations/`): `postgres.ts:147`, `mysql.ts:133`, `hubspot.ts:140`, `snowflake.ts:151`, `shopify.ts:130`, `spreadsheet.ts:166`.
- [ ] La IA nunca recibe prompts de SQL previos del usuario — **no implementado**: el historial del NLQA **sí** incluye el SQL generado en turnos anteriores (`app/src/app/api/nlqa/ask/route.ts:126` → `sql: row.generatedSql`, que `app/src/lib/ai/gateway.ts:266` interpola en el prompt como `SQL usado: …`). El control compensatorio existe y es el que importa: la validación es una blocklist determinista aplicada a la **salida** del modelo, así que el modelo no puede salir del blocklist a fuerza de persuasión — pero la afirmación literal del control es falsa.

```typescript
// app/src/lib/security/validate-query.ts
function assertSafeSqlStatement(sql: string, extraKeywords: readonly string[] = []): void {
  const upper = sql.toUpperCase();

  // Solo lectura
  if (!/^(SELECT|WITH|EXPLAIN)/.test(upper)) {
    throw new ValidationError('Only SELECT queries allowed');
  }

  // Prohibir stacked queries (separados por ;)
  const semicolons = sql.split(';').filter((s) => s.trim().length > 0);
  if (semicolons.length > 1) {
    throw new ValidationError('Multi-statement queries not allowed');
  }

  // Blocklist ÚNICA: DML/DDL + funciones peligrosas
  // (set_config, current_setting, pg_read_file, pg_terminate_backend,
  //  COPY…TO PROGRAM, dblink, …). Misma lista para TODOS los conectores.
  if (buildForbiddenPattern(extraKeywords).test(sql)) {
    throw new ValidationError('DML/DDL or forbidden function statements not allowed');
  }
}
```

### T3 — SSRF via PostgreSQL connection string

**Amenaza:** Usuario malicioso configura un data source apuntando a un Postgres interno (e.g., RDS metadata endpoint, internal services).

**Controles obligatorios:**
- [x] Bloqueo de hosts internos (localhost, 169.254.169.254, RFC1918) — la implementación es una **blocklist**, no una allowlist: `validatePostgresHost()` (`app/src/lib/security/validate-connection.ts:230`) contrasta el host **canonicalizado** contra: sets exactos (`FORBIDDEN_HOSTS`, `BLOCKED_HOSTNAMES`), rangos privados IPv4 (`isPrivateIpv4` + `PRIVATE_IP_PATTERNS`), IPv6 (`isPrivateIpv6`: loopback, link-local, unique-local, IPv4-mapped) y nombres de servicio internos (`INTERNAL_SERVICE_NAMES` + sufijos `.internal`, `.local`, `.localhost`, `.localdomain`). Un hostname público de una sola etiqueta (p. ej. una cuenta de Snowflake) **no** se rechaza.
  - Test: `app/tests/security/ssrf.test.ts` — bloquea `127.0.0.1`, `127.1`, `2130706433`, `0177.0.0.1`, `0x7f.0.0.1`, `[::1]`, `fd00::1`, `fe80::1`, `localhost.`, `::ffff:127.0.0.1`, `user:pass@10.0.0.5`, `redis`, `db.internal`; y deja pasar `8.8.8.8`, `db.acme.com`, `postgres://user:pass@db.acme.com:5432/analytics` y el identificador de cuenta de Snowflake.
- [x] Validación de connection string al guardar — `app/src/app/api/data-sources/route.ts:184` y `:214`.
- [ ] Test connection antes de guardar — **no implementado**: el alta (`app/src/app/api/data-sources/route.ts`) valida el host, cifra la config y **persiste sin abrir una conexión**. El test de conexión es una acción posterior y manual (`POST /api/data-sources/[id]/test/route.ts`), no una precondición del guardado: un data source con credenciales inválidas queda creado igual.
- [x] DB user de dash-bi (no del usuario) con permisos limitados — ver **T1**.
- [x] Validación en el constructor del connector, no solo en la API (cron jobs, seeds y scripts también quedan cubiertos) — `app/src/lib/connectors/implementations/`: `postgres.ts:70`, `mysql.ts:60`, `shopify.ts:28`, `snowflake.ts:61`; `spreadsheet.ts` reexporta el mismo validador.
- [x] Normalización previa: puerto, corchetes IPv6 y notaciones `inet_aton` alternas (decimal, octal, hex) se resuelven antes de comparar — `normalizeHostInput()` (`app/src/lib/security/validate-connection.ts:172`) quita el wrapper de URL, el `userinfo`, el path, el punto final, los corchetes IPv6 y el puerto; `parseIpv4Literal()` (`:92`) resuelve `2130706433`, `127.1`, `0177.0.0.1` y `0x7f.0.0.1` a la misma dirección canónica.

**Alcance conocido:** la validación es de nivel *string*. No derrota DNS rebinding, donde un hostname resuelve a una IP pública durante la validación y a una privada al conectar. Eso exige fijar la IP resuelta en el momento de la conexión (lookup custom en el HTTP agent) y está pendiente. Tampoco bloquea un hostname público que resuelva a una IP interna: el bloqueo es sobre la forma del host, no sobre el resultado del DNS.

```typescript
// app/src/lib/security/validate-connection.ts
export function validatePostgresHost(host: string): void {
  // 1. Canonicalizar: URL, userinfo, path, punto final, corchetes IPv6, puerto.
  const normalized = normalizeHostInput(host);

  // 2. Resolver las notaciones inet_aton: "2130706433" → "127.0.0.1".
  const literal = parseIpv4Literal(normalized);
  const effective = literal ?? normalized;

  // 3. Sets exactos: metadata endpoints, loopback, nombres internos.
  if (
    FORBIDDEN_HOSTS.has(effective) ||
    BLOCKED_HOSTNAMES.has(effective)
  ) {
    throw new SSRFError(`Host '${host}' is not allowed`);
  }

  // 4. Rangos privados: IPv4 (isPrivateIpv4 + PRIVATE_IP_PATTERNS) e IPv6.
  if (isPrivateIpv4(effective)) {
    throw new SSRFError(`Host '${host}' is in a private IP range (not allowed)`);
  }
  if (isPrivateIpv6(normalized) || isPrivateIpv6(effective)) {
    throw new SSRFError(`Host '${host}' is in a private IP range (not allowed)`);
  }

  // 5. Nombres de servicios internos: postgres, redis, db.internal, …
  if (isInternalServiceName(normalized) || isInternalServiceName(effective)) {
    throw new SSRFError(`Host '${host}' is an internal service name (not allowed)`);
  }
}
```

### T4 — BYOK API key leak

**Amenaza:** API key de OpenAI/Anthropic del usuario queda en logs, responses, o DB sin cifrar.

**Controles obligatorios:**
- [x] AES-256-GCM con master key de env variable (NO commit) — `app/src/lib/security/encryption.ts`: `aes-256-gcm`, IV de 16 bytes, auth tag de 16 bytes, clave de 64 hex chars en `LLM_KEY_ENCRYPTION_KEY`.
  - Test: `app/tests/security/encryption.test.ts`.
- [ ] Master key rotable (sin downtime) — **no implementado**: `app/src/lib/security/encryption.ts` usa una única variable de entorno y el ciphertext **no lleva versión** (`iv:authTag:ciphertext` en base64, sin prefijo de versión ni lista de claves). Rotar `LLM_KEY_ENCRYPTION_KEY` deja **indescifrable** toda key ya almacenada: `decryptApiKey` falla con `EncryptionError` y no hay fallback a la clave anterior. Para hacerlo falta versionar el ciphertext (`v1:` + key-id) y aceptar varias claves en el descifrado.
- [x] Regex redaction en logs — `app/src/lib/redact.ts:27` (`redactSecrets`): OpenAI, Anthropic, Google, Stripe, AWS, `Bearer …`, JWT y strings aleatorios largos.
  - Test: `app/tests/unit/redact.test.ts`.
  - Ver **C1** para el límite real de esta redacción.
- [x] Field-level encryption en DB (no plaintext en ningún campo) — la key del tenant se guarda cifrada con AES-256-GCM; las alertas cifran el webhook (`app/src/lib/alerts/schemas.ts:156`). **Excepción**: los `headers` de un canal webhook (bearer tokens) se guardan **en claro** — `encryptAlertChannels` cifra la URL pero no el mapa de headers. El hueco está en `app/src/lib/alerts/schemas.ts:156`.
- [x] API keys NUNCA en responses (select whitelist explícito) — la API de BYOK devuelve el placeholder `[REDACTED]`, no el ciphertext (`app/src/app/api/organizations/llm-key/route.ts`, `maskAlertChannels` en `app/src/lib/alerts/schemas.ts`).
  - Test: `app/tests/unit/api/llm-key-byok.test.ts`.
- [ ] Audit log de cada lectura de key — **no implementado**: no hay ningún sitio de emisión para una lectura de key. El ciclo de vida de la key se audita como `org.settings_updated` genérico (`app/src/app/api/organizations/llm-key/route.ts:150` y `:196`), no con los eventos declarados `llm.api_key_created` / `llm.api_key_rotated` / `llm.api_key_deleted`, que no tienen ningún sitio de emisión.

```typescript
// app/src/lib/logger.ts
formatters: {
  log(obj) {
    // Redacta SOLO los strings de nivel superior. Un `err` (Error) o un
    // objeto anidado NO se redacta: por eso `logger.error({ err })` escapa.
    const redacted: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      redacted[key] = typeof value === 'string' ? redactSecrets(value) : value;
    }
    return redacted;
  },
},
```

### T5 — Rate limit / cost runaway

**Amenaza:** Usuario con API key genera miles de dashboards → costo $1000+ en un día.

**Controles obligatorios:**
- [x] Rate limit por org — cada ruta limitada chequea **dos** buckets independientes: uno por org (`<prefix>:org:<orgId>`) y otro por IP (`<prefix>:ip:<ip>`). El bucket de org es la garantía que pide este documento; el de IP amortigua a un cliente ruidoso. Un bucket único con org+IP daría a cada miembro de la org un cupo personal, y el límite efectivo escalaría con la cantidad de miembros.
  - Implementación: `app/src/lib/rate-limit.ts` (`checkRateLimit`) y las rutas de referencia `app/src/app/api/nlqa/ask/route.ts` y `app/src/app/api/dashboards/generate/route.ts`.
  - Tests: `app/tests/unit/api/route-rate-limits.test.ts` (dos buckets, 429 con `scope: 'org'` / `scope: 'ip'`, y el invariante de que toda ruta sensible bajo `src/app/api/**` tenga límite) y `app/tests/unit/http/client-ip.test.ts`.
- [x] La IP del cliente no es falsificable — `app/src/lib/http/client-ip.ts` resuelve `x-real-ip` (que nginx sobrescribe con `$remote_addr`) y, si no está, el **último** hop de `x-forwarded-for` — el primero lo elige el caller. Antes nueve call sites leían el primer hop, así que rotar la cabecera creaba un bucket nuevo por request y `audit_log.ip` guardaba la dirección forjada.
  - Test: `app/tests/unit/http/client-ip.test.ts`.
  - Alcance: el bucket de IP solo es confiable **detrás** del proxy documentado (`deploy/nginx/dash-bi.conf`); sin proxy, todo valor de cabecera es del caller. Por eso el bucket de org es la garantía.
- [x] Siete rutas que no tenían ningún límite ahora tienen uno — bajo `app/src/app/api/`: `dashboards/[id]/export/pdf`, `files/commit`, `dashboards/[id]/share`, `dashboards/[id]/embed`, `scheduled-reports`, `organizations/members`, `organizations/llm-key`.
  - Test: `app/tests/unit/api/route-rate-limits.test.ts`.
- [x] `export.pdf` no es un permiso de `viewer` — `export.pdf` quedó en `["admin", "editor"]`; un viewer recibe 403 antes de consumir bucket.
  - Test: `app/tests/unit/api/route-rate-limits.test.ts` ("refuses a viewer: exporting is an editor capability").
- [x] **Y la UI tampoco le muestra el botón** — el control "Exportar & Compartir" no se renderiza cuando el rol de la org activa **sabe** que no puede exportar. El rol sale del mismo `GET /api/organizations` que ya cachea el `OrgSwitcher` del header (clave `["my-orgs"]`), así que no hay request extra. Mientras el rol es **desconocido** (query sin resolver, o demo público sin sesión) el control se conserva: un viewer con el rol conocido nunca lo ve, y en el demo el backend responde 401 igual.
  - Archivos: `app/src/hooks/use-active-org-role.ts`, `canExportPdf()` en `app/src/lib/auth/permissions.ts`, `app/src/components/dashboard/ExportShareDialog.tsx`.
  - Test: `app/tests/unit/components/ExportShareDialog.test.tsx` ("no muestra el botón a un viewer").
- [ ] Límites escalonados por plan (20/200/ilimitado) — **no implementado**: las capacidades son constantes fijas por ruta (`app/src/app/api/nlqa/ask/route.ts`, `app/src/app/api/dashboards/generate/route.ts`, etc.) y **no** varían por `org.plan`. El plan solo aparece en el presupuesto de gasto.
- [x] Presupuesto de gasto por org, chequeado ANTES de gastar — `app/src/lib/ai/quota.ts`: `PLAN_LLM_BUDGET_USD` (free `$5`, pro `$50`, enterprise `0` = ilimitado) y `assertOrgCanSpendLlm()`, llamado desde `app/src/app/api/nlqa/ask/route.ts`, `app/src/app/api/dashboards/generate/route.ts` y `app/src/app/api/widgets/explain/route.ts` antes de invocar al modelo.
  - Test: `app/tests/unit/ai/quota.test.ts`.
- [ ] El presupuesto es DIARIO y medido en TOKENS — **no implementado**: el presupuesto es **mensual** y se mide en **USD**. Además el gate es check-then-spend: el gasto se registra **después** de la llamada (`recordLLMUsage`), así que un burst concurrente se pasa del límite.
- [ ] Circuit breaker: si costo/hora > umbral, desactivar IA — **no implementado**: `evaluateLLMQuota()` (`app/src/lib/observability/llm-quota.ts:45`) calcula el estado `ok`/`warn`/`block` y emite breadcrumb/Sentry, pero **no tiene ningún caller de producción**: solo lo referencia `app/tests/unit/observability/llm-quota.test.ts`. El gate real es el presupuesto mensual de `app/src/lib/ai/quota.ts`.
- [ ] Alerta en UI si se acerca al límite — **no implementado**: `evaluateLLMQuota` no se invoca, así que no hay señal que la UI pueda mostrar. El panel de uso (`LlmUsagePanel`) muestra consumo histórico, no cercanía al límite.
- [ ] Revoke de API key si se detecta abuso — **no implementado**: no existe detección de abuso en `app/src` (ningún módulo lo nombra) ni revocación automática de la key del tenant.

```typescript
// app/src/lib/rate-limit.ts + app/src/app/api/nlqa/ask/route.ts
const orgLimit = checkRateLimit({
  capacity: 30,
  refillPerSecond: 0.5,
  key: `nlqa-ask:org:${ctx.orgId}`,      // bucket de ORG: la garantía del threat model
});
if (!orgLimit.allowed) {
  return NextResponse.json(
    { error: 'rate_limited', scope: 'org', retryAfterSeconds: orgLimit.retryAfterSeconds },
    { status: 429, headers: { 'Retry-After': String(orgLimit.retryAfterSeconds) } },
  );
}

const ipLimit = checkRateLimit({
  capacity: 30,
  refillPerSecond: 0.5,
  key: `nlqa-ask:ip:${getClientIp(req)}`, // bucket de IP: mismo límite, otra clave
});
if (!ipLimit.allowed) {
  return NextResponse.json(
    { error: 'rate_limited', scope: 'ip', retryAfterSeconds: ipLimit.retryAfterSeconds },
    { status: 429, headers: { 'Retry-After': String(ipLimit.retryAfterSeconds) } },
  );
}
```

### T6 — Public link abuse

**Amenaza:** Link público compartido se vuelve viral, alguien scrapea data sensible.

**Controles obligatorios:**
- [x] Link público con token random 32+ chars (`2^192` combinaciones, brute force no factible) — `app/src/lib/sharing/token.ts` usa `randomBytes(24)` → 32 chars en base64url.
- [x] Expiración y revocación chequeadas en cada uso, no solo al crear — `app/src/lib/sharing/get-public-dashboard.ts` (`revoked_at` gana sobre `expires_at`).
- [x] Lectura del share público bajo `withOrgContext`, manteniendo aislamiento entre tenants — `app/src/lib/sharing/get-public-dashboard.ts` resuelve el token por una función `SECURITY DEFINER` acotada y después carga el dashboard dentro de `withOrgContext(link.org_id, null, 'editor')`.
- [x] Tokens de embed firmados con HMAC-SHA256 y comparación en tiempo constante (`timingSafeEqual`) — `app/src/lib/embed/token.ts:59` y `:110`.
  - Test: `app/tests/unit/embed/token.test.ts`.
- [x] Sin secreto HMAC por defecto: `EMBED_TOKEN_SECRET` → `LLM_KEY_ENCRYPTION_KEY` → `BETTER_AUTH_SECRET`. Sin ninguna de las tres, firmar y verificar fallan en vez de usar una constante pública del repo — `app/src/lib/embed/token.ts:37`.
- [x] El payload público y el embed NO llevan el SQL ni el data source del tenant — `stripWidgetSources()` (`app/src/lib/sharing/get-public-dashboard.ts:64`) elimina `source` (y con él `source.query.sql` y `source.dataSourceId`) en ambos caminos: share (`app/src/lib/sharing/get-public-dashboard.ts`) y embed (`app/src/lib/embed/get-embed-dashboard.ts`).
  - Tests: `app/tests/unit/api/dashboard-share.test.ts` ("does not ship the widget query (SQL + data source id) to an anonymous visitor") y `app/tests/unit/api/dashboard-embed.test.ts` ("does not ship the widget query (SQL + data source id) to the embedding site").
- [x] El embed emite `Content-Security-Policy: frame-ancestors` con los orígenes del propio token — `app/src/middleware.ts:96` (`embedCspHeader`) y `:146`. Un token que no se puede verificar degrada a `frame-ancestors 'none'`, nunca a un valor permisivo.
  - Test: `app/tests/unit/api/dashboard-embed.test.ts` ("emits frame-ancestors scoped to the token allowed origins") y `app/tests/unit/embed/token.test.ts`.
- [x] `robots.txt` con `Disallow: /share/` — `app/public/robots.txt` (`Disallow: /share/`, `/embed/` y `/api/`). Además `app/next.config.ts` manda `X-Robots-Tag: noindex, nofollow` en `/share/(.*)`.
- [x] Expiración por defecto de 30 días en el link público — `app/src/app/api/dashboards/[id]/share/route.ts:15` (`DEFAULT_EXPIRY_DAYS = 30`) y `sanitizeExpiresInDays()`.
- [ ] Rate limit por IP en links públicos (100 requests/hora) — **no implementado**: las rutas de lectura pública (`/share/[token]`, `/embed/[token]`) no llaman a `checkRateLimit`. El rate limit existe sobre las rutas que **emiten** tokens (`dashboards/[id]/share`, `dashboards/[id]/embed`), no sobre las que los consumen.
- [ ] View counter + alerta si views > 1000/día — **la alerta no está implementada**: el contador sí existe (`incrementViewCount()` en `app/src/lib/sharing/get-public-dashboard.ts:134` incrementa `view_count` y `last_viewed_at`, y la UI lo muestra en `app/src/app/api/dashboards/[id]/share/route.ts:152`), pero **nada lee el contador** para disparar una alerta: no hay ningún umbral de 1000/día en el código.
- [ ] Expiración por defecto de 30 días en el EMBED — **no implementado**: `expiresInDays` es opcional (`app/src/app/api/dashboards/[id]/embed/route.ts:32`) y sin él `expiresAt` queda `null` → token **perpetuo**.
- [ ] Store de revocación para tokens de embed — **no implementado**: los tokens de embed son HMAC stateless (`app/src/lib/embed/token.ts`); no hay tabla, Redis key ni lista donde revocar uno ya emitido.

### T7 — Dashboard JSON injection

**Amenaza:** Widget JSON malformado (campos faltantes, types incorrectos) rompe el render.

**Controles obligatorios:**
- [x] Zod validation en TODA escritura a `dashboards.widgets` — `WidgetInputSchema` (`app/src/lib/widgets/validator.ts:329`) se usa en las rutas de alta y edición (`app/src/app/api/dashboards/route.ts:30`, `app/src/app/api/dashboards/[id]/route.ts:18`); el camino de la IA valida el dashboard completo con `validateDashboardWithArchetype()` (`app/src/lib/ai/gateway.ts:236`).
  - Test: `app/tests/unit/widgets/validator.test.ts`.
- [ ] Client-side también valida (no confiar en server) — **no implementado**: el cliente serializa el draft tal cual (`app/src/hooks/use-auto-save.ts`) y no aplica ningún schema antes del `PATCH`; la única validación es la del servidor.
- [ ] Si falla validación en client, revierte el cambio — **no implementado**: si el servidor rechaza el payload, el autosave muestra un toast de error, pero el draft del store **no** se revierte a la última versión aceptada (`app/src/hooks/use-auto-save.ts`).
- [ ] Try/catch en render de cada widget (1 widget roto no rompe el dashboard) — **no implementado**: `app/src/components/widgets/WidgetRenderer.tsx` no tiene try/catch y no hay error boundary por widget; el único error boundary es el de ruta (`app/src/app/error.tsx`), que cae a la pantalla de error de la página completa.

### T8 — Puppeteer RCE

**Amenaza:** URL maliciosa en public link ejecuta JS en el contexto de Puppeteer cuando se exporta a PDF.

**Controles obligatorios:**
- [ ] Puppeteer corre en **worker service separado** (no comparte DB con app principal) — **no implementado**: el worker es un proceso separado (`app/src/worker/index.ts`), pero **comparte la base de datos con la app**: `docker-compose.yml` le da al servicio `pdf-worker` `DATABASE_URL`, `DATABASE_MIGRATION_URL` (**el owner de las tablas**) y `LLM_KEY_ENCRYPTION_KEY`. El aislamiento es de proceso, no de credenciales.
- [ ] `--no-sandbox` solo si es necesario (con `--disable-setuid-sandbox`) — **no implementado como control**: `app/src/worker/render-pdf.ts:30` lanza Chrome **siempre** con `['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']`. No hay condición, ni justificación, ni ruta alternativa sin sandbox.
- [x] Timeout en cada navegación (30s max) — `app/src/worker/render-pdf.ts:38` (`timeout: 30_000` en `page.goto`) y 15s en `waitForSelector`.
- [ ] Block de dominios internos (mismas allowlists que T3, incluyendo IPv6) — **no implementado**: el worker no instala intercepción de requests (`page.setRequestInterception` / `setRequestInterception(true)` no aparecen en `app/src/worker/render-pdf.ts`); la página puede pedir cualquier host, interna o externa.
- [x] Cleanup garantizado (try/finally + `browser.close()`) — `app/src/worker/render-pdf.ts:72`.
- [x] Memoria limitada (max 2GB por export) — límite de memoria del contenedor `pdf-worker` en `docker-compose.yml` (`deploy.resources.limits.memory: 2G`). Es un tope **de contenedor**, no por export.
- [x] Queue con concurrencia limitada (max 3 exports simultáneos) — `app/src/worker/index.ts:54` (`PDF_CONCURRENCY = 3`), con además un limiter de 10 jobs/minuto.

---

## 2. Controles transversales (siempre activos)

### C1 — Logging sin secrets
- [x] Logger Pino con formateador que redacta secrets — `app/src/lib/logger.ts:39` (formatter `log`) + `app/src/lib/redact.ts:27` (`redactSecrets`), más las rutas de campo de `pino.redact` (`llmApiKeyEncrypted`, `apiKey`, `password`, `connectionString`, `BETTER_AUTH_SECRET`, `LLM_KEY_ENCRYPTION_KEY`, …).
  - Test: `app/tests/unit/redact.test.ts`.
- [ ] Redacción recursiva de objetos y errores — **no implementado**: el formatter de Pino solo redacta los **strings de nivel superior** (`app/src/lib/logger.ts:40`). `logger.error({ err })` escribe el mensaje y el stack del objeto `Error` sin redactar. La función que sí recursiona, `redactObject()` (`app/src/lib/redact.ts:37`), **no tiene ningún caller de producción** — solo `app/tests/unit/redact.test.ts` la referencia.
- [x] No loguear config descifrado — las rutas de campo de `pino.redact` cubren `llmApiKeyEncrypted`, `llmApiKey`, `apiKey`, `api_key`, `password` y `connectionString` (`app/src/lib/logger.ts:11`), y el valor descifrado viaja en variables locales (`app/src/lib/ai/router.ts:12`, los connectors), no dentro de un payload de log.
- [ ] No loguear SQL completo en error (solo query hash + primeros 100 chars) — **no implementado**: la ruta de NLQA loguea el SQL generado **completo** en dos ramas (`app/src/app/api/nlqa/ask/route.ts:238` y `:266`, `logger.warn({ sql: sqlResult.sql, … })`).
- [ ] No loguear tokens de un solo uso — **no implementado**: el print token se loguea en claro (`app/src/lib/export/print-token.ts:62`, `logger.error({ err: error, token }, …)`); el token es un base64url de 24 bytes que no coincide con los patrones de `redactSecrets` (necesitan 40+ caracteres).

### C2 — Audit log completo
- [ ] Login / logout / signup — **no implementado**: `auth.login`, `auth.logout`, `auth.signup`, `auth.failed_login`, `auth.magic_link_sent`, `auth.magic_link_used`, `auth.password_reset_requested`, `auth.password_reset_completed`, `auth.email_verification_sent` y `auth.email_verified` están **declarados** en `app/src/lib/audit/events.ts` pero **no tienen ningún sitio de emisión** en `app/src`.
- [x] Dashboard created/updated/deleted — `app/src/app/api/dashboards/route.ts:99`, `app/src/app/api/dashboards/[id]/route.ts:130` y `:150`.
- [x] Data source connected/deleted — `datasource.created` en `app/src/app/api/data-sources/route.ts:357`; `datasource.deleted` en `app/src/app/api/files/[id]/route.ts:120`.
- [ ] Test de conexión de data source auditado — **no implementado**: `datasource.tested` y `datasource.connection_failed` están declarados y no tienen sitio de emisión; la ruta `app/src/app/api/data-sources/[id]/test/route.ts` no llama a `audit()`.
- [x] AI generation — `dashboard.generated`, `nlqa.question_asked`, `nlqa.answer_generated`, `nlqa.widget_explained`.
- [x] Export (PDF/PNG/link) — `export.pdf_requested` / `export.pdf_completed` / `export.pdf_failed` (`app/src/app/api/dashboards/[id]/export/pdf/route.ts`), `export.link_generated` (`dashboards/[id]/share/route.ts:106`) y `export.link_revoked` (`app/src/app/api/public-links/[id]/route.ts:22`). El export PNG **no existe** como ruta: los eventos `export.png_requested` / `export.png_completed` están declarados y no tienen emisión.
- [ ] BYOK key created/rotated/deleted — **no implementado como eventos propios**: el ciclo de vida se audita con el evento genérico `org.settings_updated` (`app/src/app/api/organizations/llm-key/route.ts:150` y `:196`), no con `llm.api_key_created` / `llm.api_key_rotated` / `llm.api_key_deleted`, que no tienen ningún sitio de emisión.
- [ ] Guard de metadata sensible en `assertSafeMetadata` — **no implementado donde importa**: `assertSafeMetadata()` (`app/src/lib/audit/events.ts:141`) hace `if (process.env.NODE_ENV === 'production') return;` antes de validar, así que la lista `AUDIT_FORBIDDEN_METADATA_KEYS` **no se aplica en producción**.

### C3 — HTTPS obligatorio
- [x] HSTS enabled — `app/next.config.ts` (`Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`) y `deploy/nginx/dash-bi.conf`.
- [x] Cookies `Secure` + `HttpOnly` + `SameSite=Lax` — `app/src/lib/auth/config.ts:161` (`useSecureCookies: process.env.NODE_ENV === 'production'`); `HttpOnly` y `SameSite` los aplica el default de better-auth (el repo no los modifica).
- [x] TLS en el reverse proxy (nginx) — `deploy/nginx/dash-bi.conf` ships el bloque TLS 1.2/1.3 con redirect 80→443. **No** hay un servicio nginx en `docker-compose.yml`: el TLS termina en un nginx del host, no dentro del compose.

### C4 — Backup y recovery
- [x] Postgres backups diarios — cron del host: `deploy/cron/dashbi-backup` (03:00 UTC) que invoca `scripts/backup.sh`. **No** es un cron dentro de `docker-compose.yml`.
- [x] Retención 30 días — `scripts/backup.sh` (`RETENTION_DAYS=30`, limpieza por `find -mtime +30 -delete`).
- [ ] Restore drill probado (Fase 1 setup) — **no implementado**: existe el script `scripts/restore.sh` (`pg_restore` sobre el contenedor), pero no hay evidencia de un drill ejecutado ni automatizado.

### C5 — Dependency management
- [x] `npm audit` en CI (cada PR) — el job `audit` de `.github/workflows/ci.yml` corre `pnpm audit:check` (`app/scripts/check-audit-baseline.mjs`) contra el baseline `app/security-audit-baseline.json`, y el workflow dispara en `pull_request` a `main`. **Antes el job vivía en `app/.github/workflows/ci.yml`, donde GitHub nunca lo ejecutaba** (Actions solo descubre workflows bajo el `.github/workflows/` de la raíz): el gate estaba ausente.
- [ ] Renovate bot para updates — **no implementado**: no hay `renovate.json` ni `.renovaterc` en el repositorio.
- [x] Lockfile pinned — `app/pnpm-lock.yaml` + `pnpm install --frozen-lockfile` en el job `verify` de `.github/workflows/ci.yml`.
- [ ] SBOM generado — **no implementado**: no hay job, script ni herramienta de SBOM (CycloneDX / Syft) en `.github/workflows/ci.yml` ni en `app/package.json`.

---

## 3. Tests de seguridad obligatorios

### T1 — Tenant isolation
```typescript
// app/tests/integration/rls-isolation.test.ts  (Postgres real + RLS)
// app/tests/security/tenant-isolation.test.ts   (capa lógica: filtros por rol)
describe('Cross-tenant isolation', () => {
  it('read isolation', ...);       // conOrgContext(orgA) no ve filas de orgB
  it('write isolation', ...);      // org_members_isolation bloquea writes cross-org
  it('export isolation', ...);     // scheduled_reports / scheduled_report_runs (0013)
  it('cache isolation', ...);      // — sin cobertura
  it('error log isolation', ...);  // — sin cobertura
});
```

### T2 — SQL injection
```typescript
// app/tests/unit/security/validate-query-blocked-statements.test.ts
// app/tests/security/sql-injection.test.ts
// app/tests/unit/security/validate-query-purity.test.ts
describe('SQL injection prevention', () => {
  it('rejects DROP TABLE', ...);
  it('rejects stacked queries', ...);
  it('rejects comments-based injection', ...);
  it('rejects SELECT … INTO (CTAS)', ...);        // nuevo en 7ce0baf
  it('rejects set_config / current_setting', ...); // nuevo en 7ce0baf
  it('rejects COPY … TO PROGRAM', ...);            // nuevo en 7ce0baf
  it('auto-injects LIMIT', ...);
  it('validates SQL via DB user permissions', ...);
});
```

### T3 — SSRF
```typescript
// app/tests/security/ssrf.test.ts
describe('SSRF prevention', () => {
  it('rejects localhost', ...);
  it('rejects AWS metadata endpoint', ...);
  it('rejects RFC1918 IPs', ...);
  it('rejects alternate inet_aton notations', ...); // nuevo en b21bb58
  it('rejects IPv6 loopback / ULA / link-local', ...); // nuevo en b21bb58
});
```

### T4 — BYOK security
```typescript
// app/tests/security/encryption.test.ts
// app/tests/unit/api/llm-key-byok.test.ts
describe('API key security', () => {
  it('keys are encrypted at rest', ...);
  it('keys never appear in logs', ...);
  it('keys never appear in API responses', ...);
  it('key rotation works', ...);   // — pendiente: la rotación NO está implementada
});
```

### T5 — Rate limit
```typescript
// app/tests/unit/api/route-rate-limits.test.ts
// app/tests/unit/http/client-ip.test.ts
// app/tests/unit/ai/quota.test.ts
describe('Rate limiting', () => {
  it('per-org bucket is exhausted before the IP bucket', ...);
  it('the IP bucket is keyed by the trusted hop', ...);
  it('every sensitive API route carries a rate limit', ...); // invariante
  it('circuit breaker triggers on high cost', ...);  // — pendiente: no implementado
});
```

---

## 4. Checklist pre-implementación

Antes de escribir la primera línea de código de SQL execution:

- [x] RLS policies creadas en todas las tablas — `app/drizzle/migrations/0001_rls_policies.sql` → `0017_production_rls_and_readonly_hardening.sql` — test: `app/tests/integration/rls-isolation.test.ts`
- [x] `withOrgContext()` implementado + tests — `app/src/db/client.ts:92` — tests: `app/tests/integration/rls-isolation.test.ts`, `app/tests/security/tenant-isolation.test.ts`
- [x] `validateQuery()` implementado + tests — `app/src/lib/security/validate-query.ts:203` — tests: `app/tests/unit/security/validate-query-blocked-statements.test.ts`, `app/tests/unit/security/validate-query-purity.test.ts`
- [x] `validatePostgresHost()` implementado + tests — `app/src/lib/security/validate-connection.ts:230` — test: `app/tests/security/ssrf.test.ts`
- [x] AES-256-GCM encryption implementado + tests — `app/src/lib/security/encryption.ts` — test: `app/tests/security/encryption.test.ts`
- [x] Pino con redactor implementado + tests — `app/src/lib/logger.ts:39`, `app/src/lib/redact.ts:27` — test: `app/tests/unit/redact.test.ts`
- [x] Rate limit por org implementado + tests — `app/src/lib/rate-limit.ts` + las rutas de referencia `app/src/app/api/nlqa/ask/route.ts` y `app/src/app/api/dashboards/generate/route.ts` — tests: `app/tests/unit/api/route-rate-limits.test.ts`, `app/tests/unit/http/client-ip.test.ts`
- [x] ESLint rule custom instalada — `app/.eslint-rules/no-raw-db-queries.cjs`, activada en `app/eslint.config.mjs`
- [x] Audit log funcionando — `app/src/lib/audit/log.ts` (`audit()`), con eventos reales de dashboard, data source, export, NLQA, scheduled report y alerts. **Los eventos de autenticación no se emiten** (ver **C2**).
- [x] DB user read-only creado en docker-compose — `scripts/postgres/init-roles.sh` (rol `dashbi_readonly`) + `app/drizzle/migrations/0019_readonly_revoke_internal_tables.sql` — tests: `app/tests/unit/security/readonly-role-grants.test.ts`, `app/tests/integration/rls-isolation.test.ts`

**Los 10 controles pre-implementación están verificados contra el código (ver Sprint 1 en `README.md` §Status). Cada línea de esta lista apunta a la implementación y a su test; el detalle de lo que falta está en las secciones 1 y 2.**
