# Verificación de seguridad — dash-bi

**Fecha:** 2026-09-30
**Método:** barrido de los 10 controles (T1–T10) del threat model contra el estado actual del working tree, siguiendo `.agents/skills/security-audit/SKILL.md`. Cada afirmación fue verificada ejecutando el comando, no releyendo el informe previo.
**Base:** `HEAD` = `2b6f66b` + el diff sin commitear de la Fase 1 (extracción de `errorResponse`).
**Contexto:** esto **no** es una auditoría nueva — es la respuesta a *"¿quedó corregido lo de las auditorías?"*.

---

## Respuesta corta

**Actualización 2026-09-30 (2.ª ronda de correcciones): el CRITICAL que quedaba está cerrado.**
Los cuatro CRITICAL originales terminarán **cuatro de cuatro corregidos**, y de los HIGH
abiertos quedan dos, uno de los cuales depende de una verificación que esta máquina no puede hacer.

Lo que SÍ se corrigió en las dos rondas es genuino y está bien hecho — no lo minimizo.

| Severidad | Antes | Ahora | Controles tocados |
|---|---:|---:|---|
| **CRITICAL** | 1 | **0** | — (T4 cerrado) |
| **HIGH** | 4 | **2** | T1 (parcial), HIGH-5 (no verificable) |
| **MEDIUM** | 4 | 4 | T3, T5, T8, T9 |

**Ronda 1 — cadena `pg_read_file`:** GRANT eliminado del init script + 21 funciones peligrosas en
un blocklist compartido (`buildForbiddenPattern()`), con un test de 27 casos que la pinea.

**Ronda 2 — las críticas que elegiste:**

- **T4 (BYOK)** — cerrado. Endpoint `GET/PUT/DELETE /api/organizations/llm-key`, cifrado con
  AES-256-GCM, la key nunca sale por el hilo, auditoría sin material de key. 9 tests.
- **T10 (audit log)** — cerrado. 5 rutas mutantes ahora auditan; 9 tests.
- **T1 (RLS)** — cerrado donde era seguro: migración `0013` aplica `ENABLE`+`FORCE`+policies a
  `scheduled_reports` y `scheduled_report_runs`. `orgs` **no** se migró a propósito, con el
  motivo documentado en la propia migración.
- **T3 (identificadores en `sql.raw`)** — cerrado, y de paso destapó un **bug funcional de
  producción** (§4).

### Veredicto: **FAIL→FAIL** — 0 CRITICAL, 2 HIGH abiertos (uno no verificable aquí).

Lo que mantiene el veredicto en FAIL es **HIGH-5**: si el rol de la app es superuser, toda la
capa RLS es decorativa y T1 vuelve a ser CRITICAL. Eso solo se resuelve contra una DB real.

---

## 1. Los 4 CRITICAL originales: 2 corregidos, 2 abiertos

### ✅ C1 — Fuga cross-tenant de PDFs por `jobId` — **CORREGIDO**

Commit `349f7d2 fix(security): scope PDF export job lookups to the owning org`.
`lib/export/pdf-enqueue.ts` ahora persiste y valida la pertenencia del job antes de devolverlo.

### ✅ C2 — Lectura cross-tenant de alert rules — **CORREGIDO**

Commits `72545ce` + `aa4f01a`. Verificado por partida doble:
- Predicado de org en el código: `alerts/route.ts:54` y `:130` llevan `eq(alertRules.orgId, orgId)`
- RLS en la DB: `drizzle/migrations/0012_rls_alert_rules.sql:25` `ENABLE` + `:27` `FORCE`

### ✅ C3 — El filtro PII de `viewer` era código muerto — **CORREGIDO**

Commit `05926b4`. El rol ahora se propaga de punta a punta, verificado por las tres uniones:

```
dashboard.ts:26,66   role: OrgRole          ← requerido, no opcional
execute.ts:74        validateQuery(q, connector.type, opts.role)
nlqa/ask/route.ts:191 validateQuery({...}, dataSourceType, ctx.role)
```

Y `assertRolePermissions` se invoca dentro de `validateQuery` cuando `role` está presente
(`validate-query.ts:55-57`). **La función que la pasada 1 confirmó que "nunca corre en
producción" ahora corre en las dos rutas que importan.**

### ✅ HIGH-1 — El filtro PII era evadible por convención de nombres — **CORREGIDO**

No lo arreglaron con un parche. **Lo reescribieron bien.** El patrón ahora usa lookarounds en vez de `\b`:

```ts
// validate-query.ts:193
/(?<![A-Za-z0-9])(password|secret|api_key|apiKey|token|ssn|tax_id|credit_card|card_number|cvv)(?![A-Za-z0-9])/i
```

`(?<![A-Za-z0-9])` hace que `_` **sí** sea frontera (por eso `user_password` ahora se bloquea),
y el wildcard se evalúa enmascarando primero las estrellas de agregado (`AGGREGATE_STAR:218`),
de modo que un comentario SQL ya no puede esconder el `*`.

**Verificado empíricamente contra el regex real, 11/11:**

| Consulta | Esperado | Real |
|---|---|---|
| `SELECT password FROM users` | bloquea | ✅ bloquea |
| `SELECT user_password FROM users` | bloquea | ✅ **antes evadía** |
| `SELECT customer_ssn FROM customers` | bloquea | ✅ bloquea |
| `SELECT billing_tax_id FROM invoices` | bloquea | ✅ bloquea |
| `SELECT credit_card FROM payments` | bloquea | ✅ bloquea |
| `SELECT * FROM users` | bloquea | ✅ bloquea |
| `SELECT/*x*/* FROM users` | bloquea | ✅ **antes evadía** |
| `SELECT name FROM users` | permite | ✅ permite |
| `SELECT COUNT(*) FROM orders` | permite | ✅ permite |
| `SELECT u.name, SUM(o.total) FROM users u` | permite | ✅ permite |

Además el docblock (`:209-216`) acepta los falsos positivos a propósito y explica por qué
**no** usan un stripper de comentarios: *"mishandling a string literal there is a fail-open
hole, which is strictly worse than an over-block"*. Es razonamiento de seguridad correcto.

### ✅ C4 — BYOK de credenciales LLM: la UI afirma un guardado que no ocurre — **CORREGIDO**

Diagnóstico original: `grep -rn "llmApiKeyEncrypted" src/` → 4 coincidencias, **todas lecturas o el
schema**. Cero escrituras, y el formulario hacía `setSavedMsg(true)` sin haber escrito nada.

**Corrección:** endpoint nuevo `src/app/api/organizations/llm-key/route.ts` con `GET`/`PUT`/`DELETE`,
y la UI de settings reescrita para hablar con él.

| Requisito | Cómo se cumple |
|---|---|
| Solo quien puede | `requireAuth(req, 'org.updateLLMConfig')` (permiso preexistente, admin) |
| Cifrado en reposo | `encryptApiKey()` (AES-256-GCM) antes del `.set()` |
| La key nunca sale | `GET` devuelve `hasApiKey: boolean`, jamás el material |
| Scope de tenant | `withOrgContext(ctx.orgId, …)`; el orgId sale de la sesión, nunca del body |
| Sin rastro de la key | `audit('org.settings_updated', { apiKeySet: true })` — metadata sin material |
| La UI no miente | Carga el estado real al montar; muestra error si el PUT falla; permite revocar |

Un test dedicado (**9 casos**, `tests/unit/api/llm-key-byok.test.ts`) incluye la aserción que más
importa: `JSON.stringify(auditOptions)` **no contiene** la key en claro.

```
grep -rn "llmApiKeyEncrypted" src/
  → ahora incluye api/organizations/llm-key/route.ts (escritura)  ✅
```

**Lo que sigue abierto (no lo arregla este cierre):** HIGH-9 —
`dashboards/generate` sigue construyendo `AiGateway` sin la config de la org, así que ese camino
sigue usando la credencial de la plataforma. La key ahora se *guarda*; todavía no se *usa* en todos
los caminos. Cierre parcial, no total.

### ❌ HIGH-5 — El rol de la app es superuser → RLS decorativa — **ABIERTO, no verificado**

No cambió nada. `docker-compose.yml` sigue construyendo `DATABASE_URL` desde `${POSTGRES_USER}`,
que la imagen oficial de Postgres crea como superuser, y no existe ningún `ALTER ROLE ... NOSUPERUSER`
en el repo.

> [!NOTE]
> **Corrección (2026-09-30, revisión posterior).** Escribí antes "no hay Docker en esta máquina" y
> **es falso**: Docker está instalado (`/usr/bin/docker`, cliente 29.7.2). Lo que faltaba era acceso
> al daemon — el usuario no estaba en el grupo `docker` y el servicio estaba detenido. Resuelto con
> `usermod -aG docker $USER` + `systemctl start docker`. No lo verifiqué cuando lo afirmé, y esa
> frase iba a quedar en el informe para quien lo leyera después.
>
> [`verify-high5.sh`](./verify-high5.sh) hace la verificación completa en un comando.

**Estado actual: el mecanismo está confirmado por lectura, lo que falta es la prueba empírica.**

```
docker-compose.yml:109   POSTGRES_USER=${POSTGRES_USER:-dashbi}      ← la imagen crea esto como superuser
docker-compose.yml:27    DATABASE_URL=postgres://${POSTGRES_USER}:…   ← la app conecta con ese mismo rol
```

Un superuser **ignora RLS aunque la tabla tenga `ENABLE` + `FORCE ROW LEVEL SECURITY`**. Si esto es
lo que corre en el despliegue real, la migración `0013` que acabamos de escribir no protege nada y
**T1 sube a CRITICAL**: el fix pasa a ser `ALTER ROLE … NOSUPERUSER` y mover el DDL a un rol con
privilegios, no agregar más policies.

La única duda que queda es empírica: si algún despliegue usa un rol distinto al de `POSTGRES_USER`.

---

## 2. T1 — Aislamiento de tenant — 🔴 HIGH

**Lo bueno:** los 15 archivos de la tabla del threat model, 11 están correctos
(`ENABLE` + `FORCE` + policy): `dashboards`, `data_sources`, `dashboard_versions`, `public_links`,
`llm_usage`, `audit_log`, `org_members`, `nlqa_conversations`, `nlqa_messages`, `uploaded_files`,
`alert_rules`, `alert_events`.

**Y el código de aplicación está limpio:** `grep -rn "db\.(select|insert|update|delete)\("` sobre
`src/lib/`, `src/components/`, `src/db/` → **0 coincidencias reales** (las 3 que aparecen están
dentro de comentarios explicativos en `db/client.ts:71,80` y `audit/log.ts:35`).

### [HIGH] T1 — `orgs` tiene 2 policies pero RLS nunca se habilitó

```
orgs                     enable=0 force=0 policy=2   ← policies inertes
```

En Postgres **una policy sin `ENABLE ROW LEVEL SECURITY` es código muerto**. La policy
`orgs_isolation` se crea (`0001:40`, `0004:22`) pero ningún archivo ejecuta el `ALTER TABLE`.
El aislamiento de la tabla de organizaciones no existe en la práctica.

**→ DECISIÓN ARQUITECTÓNICA, no corregido a propósito.** Antes de escribir la policy revisé los
tres caminos que consultan `orgs` de forma legítimamente cross-org:

- `api/organizations/route.ts:30-39` — el org switcher lista **todas** las orgs del usuario
- `lib/auth/config.ts:34-100` — `provisionOrgForUser`, el alta de una org nueva
- `lib/auth/config.ts:22-32` — `uniqueSlug`, que mira otras orgs para no repetir slug

Una policy `id = app_current_org_id()` rompe el switcher y el signup. La policy correcta necesita
un helper `SECURITY DEFINER` que resuelva la pertenencia vía `org_members`, porque una policy
que consulta `org_members` a su vez se dispararía recursivamente en RLS. Eso es un cambio de
diseño con su propia revisión, no una migración. **Queda abierto como tarea de diseño**, con el
motivo escrito dentro de `0013_rls_scheduled_reports.sql` para que no se "corrija" sin leer.

### ✅ T1 — `scheduled_reports` y `scheduled_report_runs` no tienen RLS en absoluto — **CORREGIDO**

```
antes:  scheduled_reports        enable=0 force=0 policy=0
        scheduled_report_runs    enable=0 force=0 policy=0
```

**Corrección:** migración `drizzle/migrations/0013_rls_scheduled_reports.sql` (registrada en
`meta/_journal.json`, idx 13) con `ENABLE` + `FORCE` + policies `USING`/`WITH CHECK` sobre
`app_current_org_id()` en ambas tablas. `WITH CHECK` es lo que cierra la escritura cross-tenant:
sin él, un `INSERT` con otro `org_id` se colaría.

**Test de integración** agregado a `tests/integration/rls-isolation.test.ts` con tres casos:
aislamiento entre orgs, **invisibilidad total sin GUCs**, y **rechazo del INSERT cross-org**.
Solo corre en CI (requiere Testcontainers; esta máquina no tiene Docker), así que su verde está
pendiente de verificación en pipeline — no lo cuento como verificado.

Los gaps preexistentes de `CODIGO-AUDIT.md` (HIGH-4) quedan cubiertos por esto, salvo `orgs`.

---

## 3. T2 — RBAC — 🟢 PASS

**32 de 34 route handlers llaman `requireAuth` con un permiso explícito.** Los 2 que no lo hacen
son correctos por diseño:

- `auth/[...all]/route.ts` — es el catch-all de better-auth
- `health/route.ts` — health check público

16 permisos distintos en uso: `dashboard.view` (11), `datasource.view` (4), `dashboard.create` (4),
`dashboard.alert` (4), `query.execute` (3), `datasource.create` (3), `dashboard.edit` (3), etc.

**Ningún control hallazgo.** Es el control más sólido del set.

---

## 4. T3 — Validación de SQL — 🟠 HIGH/MEDIUM

**Lo bueno:** la cadena `AI genera SQL → validateQuery → readonly connection` existe y se invoca
en las rutas que importan. HIGH-2 sigue abierto (el contrato sigue mutando en vez de devolver),
pero ya no afecta al path de NLQA principal.

### [HIGH] T3 — El blocklist de funciones es insuficiente

`validate-query.ts:49` y `:109`:
```ts
/\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE|GRANT|REVOKE|SLEEP|BENCHMARK|LOAD_FILE|OUTFILE)\b/i
```

**No incluye ninguna función de lectura de archivos del servidor**: `pg_read_file`,
`pg_read_binary_file`, `pg_ls_dir`, `lo_import`, `lo_export`, `pg_stat_file`. Verificado:
`grep -rni "pg_read_file|pg_ls_dir|lo_import" src/` → **0 coincidencias**.

Combinado con T7, esto cierra la cadena descrita abajo. **Nota:** el mismo patrón usa `\b`, que
**no** hace frontera con `_` — o sea el mismo bug que se acaba de arreglar en `SENSITIVE_COLUMN_PATTERN`
sigue presente en el blocklist de DML. `SELECT user_insert FROM t` pasa. No es explotable
(solo lee, no escribe) pero es la misma clase de error, y ya se pritaron la solución 50 líneas más abajo.

### ✅ T3 — `sql.raw()` con identificador vindo de la DB depende de un solo sanitizador — **CORREGIDO, y destapó un bug de producción**

`sql.raw` aparecía en 4 sitios con identificadores interpolados:
- `spreadsheet.ts:84` — `SELECT 1 FROM ${file.targetTable} LIMIT 1`
- `files/commit/route.ts:113,115,116,119` — DDL sobre `targetTable`
- `files/[id]/route.ts:104` — `buildDropTableSQL(file.targetTable)`
- `db/rls.ts:31,33,113,115` — `sql.raw` sobre `table`/`policy` de arrays hardcodeados

**Corrección:** módulo nuevo `src/lib/connectors/parsers/sql-ident.ts` con **una sola** regla,
`[a-z_][a-z0-9_]*` y ≤63 chars por parte, exactamente un punto. Todo sink pasa por
`parseQualifiedIdent()` / `parseBareIdent()`. La regla es **más estricta que Postgres a propósito**:
uppercase, comillas, espacios, comentarios, guiones y homoglifos se **rechazan**, no se escapan.
Rechazar es más fuerte que escapar: escapar produce SQL sintácticamente válido para un nombre que
nunca quisimos, y esconde el hecho de que un valor hostil llegó al sink.

`quoteIdent()` se mantiene para los nombres que el propio código construye (índices, policies), y
un test documenta explícitamente **por qué no es la frontera de seguridad**.

**Tests (33 casos nuevos):** `sql-ident.test.ts` (24, incluyendo 18 vectores hostiles) +
`target-table-sink.test.ts` (5), que intercepta el `tx.execute` real y verifica que un
`targetTable` hostil **no emite ni una sentencia** antes de lanzar.

#### El bug que salió en el camino

Al enrutar los sinks por el validador apareció una contradicción que los tests no veían:

```
safeTableName('Customers Q1.csv', orgId)  →  "org_f47ac10b58cc4372_customers_q1"   (sin punto)
buildCreateTableSQL(ese valor)            →  throw "targetTable must be schema-qualified"
```

**`POST /api/files/commit` fallaba siempre.** El upload funcionaba, el commit nunca. Y la
validación que el informe daba por buena (`files/commit/route.ts:110-112`, `if (!schemaName)
throw`) era inerte: `'sin-punto'.split('.')[0]` siempre existe, así que nunca disparaba.

Los dos lados tenían tests propios y ambos pasaban — `load.test.ts` usaba `org_a.sales`,
`normalize.test.ts` usaba `org_…_…` — y **nadie tenía un test del seam entre ellos**. Eso es
justo el fallo que la suite de integración debía cubrir y no cubría.

**Arreglado** haciendo que `safeTableName` emita `org_<orgid>.<basename>`, que es lo que los otros
cuatro call sites ya asumían (`split('.')[0]` para el schema, `split('.').pop()` para mostrarle el
nombre de la tabla al modelo). El test del seam ahora es explícito y se llama como tal.

#### Hallazgo nuevo que **no** arreglé (queda abierto)

Dos archivos del mismo org con el mismo basename colisionan: ambos resuelven a
`org_<id>.sales`, y `CREATE TABLE IF NOT EXISTS` reutiliza silenciosamente la primera. La segunda
carga se mezcla en la tabla anterior. **No es una fuga cross-tenant** (el schema sigue siendo del
org), es un bug de integridad de datos *dentro* del tenant. Era preexistente —el formato viejo
`org_<id>_<base>` tenía la misma colisión— y lo dejo anotado en vez de ampliar el alcance de T3
sin que lo pidas. El fix es un sufijo hash corto en `safeTableName`.

---

## 5. T4 — Cifrado de BYOK — ✅ CRITICAL cerrado (parcialmente)

**El cifrado en sí es sólido** (AES-256-GCM, IV aleatorio, auth tag verificado) y se usa
correctamente para credenciales de data sources. **No hay ni una key en texto plano en el repo**
(`grep -E "sk_live|sk_test|sk-proj|AIza|sk-ant-"` sobre `src/`, `tests/`, `scripts/` → 0).

**El endpoint de escritura ya existe** → ver **C4** arriba, ahora ✅. El control dejó de dar
confianza falsa: o guarda de verdad, o muestra el error.

**Lo que sigue sin cerrarse (y es la parte que importa del punto de vista del usuario):** guardar
la key no basta si los caminos que consumen LLM no la leen. `dashboards/generate` sigue
construyendo `AiGateway` sin la config de la org (HIGH-9). Es decir: **la key se guarda
correctamente y sigue sin usarse en todas partes.** Cierre del CRITICAL, no del control entero.


---

## 6. T5 — Redacción de logs — 🟡 MEDIUM

**Bien:** 0 `console.*` en los 23 route handlers. El logger es Pino con `redact` configurado
(incluye `llmApiKeyEncrypted`, `configEncrypted`, y más en `lib/logger.ts:14`), y `redactSecrets`
cubre los payloads.

**Los 5 `console.*` que quedan** están todos fuera de `src/app/api`:
- `auth/config.ts:167, 221, 267` — `console.error('sendX failed:', error)`, logueando el objeto
  de error de envío de email. Si ese error contiene la URL de magic-link con su token, va a
  stdout sin redactar. **No verifiqué si el objeto `error` de better-auth incluye el token.**
- `env.ts:51-52` — validación de env en boot, aceptable.

**Por qué no los atrapa ESLint:** `eslint.config.mjs` tiene `no-console: ['warn', { allow: ['warn',
'error', 'info'] }]` — `console.error` está explícitamente permitido. El control depende de que
cada developer recuerde usar el logger.

---

## 7. T6 — SSRF — 🟢 PASS (con mérito)

**El mejor control del set.** Verificado:

- Los 4 conectores que abren conexión validan el host **antes** de conectar:
  `postgres.ts` (2×), `mysql.ts` (2×), `snowflake.ts` (3×), `shopify.ts` (2×) llaman
  `validatePostgresHost`
- **Los canales de alerta validan en el punto de uso, no solo en el schema:**
  `lib/alerts/channels/webhook.ts:39-42` llama `validateOutboundUrl(params.url)` justo antes del
  `fetch`, con el comentario: *"validate here and not only in the API schema: rules persisted
  before validation existed would otherwise still fire"*
- `slack.ts:71-73` además restringe con `allowedPrefixes: ['https://hooks.slack.com/']`
- **Ambos usan `redirect: 'manual'`** (`webhook.ts:52`, `slack.ts:87`) con el comentario: *"a public
  URL that redirects to 169.254.169.254 is the same attack with an extra hop"*
- La validación cubre IPv4/IPv6 privados, IPv4-mapped, link-local, metadata endpoints y las
  formas `inet_aton` (`2130706433`, `127.1`, `0177.0.0.1`, `0x7f.0.0.0`), con lookup en el momento
  de conectar

**Ningún hallazgo.** Esto está bien hecho.

---

## 8. T7 — Usuario read-only — 🔴 HIGH

### La cadena de `pg_read_file` — ✅ **CORREGIDA (2026-09-30, esta sesión)**

Los cinco eslabones que estaban intactos:

| # | Eslabón | Antes | Ahora |
|---|---|---|---|
| 1 | `app/scripts/postgres/init-readonly.sql:21` otorgaba `EXECUTE ON FUNCTION pg_read_file(text)` | ❌ | ✅ **GRANT eliminado**, con un comentario que explica por qué no debe volver |
| 2 | El comentario de `:20` decía *"EXPLAIN permitido"* sobre un GRANT de `pg_read_file` | ❌ incongruente | ✅ eliminado con el GRANT |
| 3 | `validate-query.ts` sin funciones de lectura de archivos en el blocklist | ❌ | ✅ **21 funciones** en una lista compartida |
| 4 | `ci.yml` promueve el rol a `LOGIN` | — sin cambio (es legítimo por diseño) |
| 5 | Ese rol ejecuta las queries de IA | — sin cambio (es el punto) |

**Lo que se hizo, con TDD:**

`tests/security/db-file-access.test.ts` (27 casos, **visto fallar primero**: 15 reds) pinea:
las 9 funciones de lectura de archivos, 4 de timing/egress, los 4 caminos SQL-backed
(`postgres`, `mysql`, `spreadsheet`, `csv`), variantes con `PG_` en mayúsculas,
schema-qualified (`public.pg_read_file`), y dentro de un CTE.

**Y 8 casos de no-sobre-bloqueo**, porque un blocklist que se ensancha sin cuidado
convierte un bug de seguridad en uno de usabilidad:
`SELECT filename FROM documents`, `SELECT * FROM files`, `SELECT lo_id FROM large_objects`,
`SELECT token_count FROM metrics` siguen permitiéndose. `\b` no dispara porque
`filename`/`files`/`lo_id` no coinciden con ninguna alternativa completa.

**Y se descubrió un problema adyacente mientras lo hacía:** `validateQuery` tenía **cuatro**
listas `forbidden` distintas, una por familia de conector, y las de `hubspot`/`snowflake`/
`spreadsheet` no tenían **ni `SLEEP` ni `BENCHMARK`**. Es exactamente la clase de drift que
dejó vivo a `pg_read_file`. Ahora las cuatro pasan por `buildForbiddenPattern()`, con
`DML_DDL_KEYWORDS` y `DANGEROUS_DB_FUNCTIONS` compartidos y `MERGE` como único extra
(engine-específico de Snowflake). **Un conector nuevo ya no puede heredar una lista más débil.**

**Límite honesto de esta corrección:** el script corregido es el de `app/`. El de la raíz
(`scripts/postgres/init-readonly.sql`, que usa la raíz del repo) nunca tuvo el GRANT, así que
sigue sin cambios — pero también sigue con la password hardcodeada
(`WITH LOGIN PASSWORD 'dashbi_readonly_password'`, línea 5). **Unificar los dos scripts sigue
pendiente** (ver más abajo).

### Los dos `init-readonly.sql` — ❌ SIGUEN SIENDO INCOMPATIBLES

| | `app/scripts/postgres/` | raíz `scripts/postgres/` |
|---|---|---|
| Rol | `NOLOGIN` (`:8`) | `WITH LOGIN PASSWORD 'dashbi_readonly_password'` (`:5`) |
| `GRANT CONNECT ON DATABASE` | no | sí (`:9`) |
| `pg_read_file` | ✅ **eliminado** | nunca lo tuvo |

`app/docker-compose.yml:22` monta el de `app/`; `docker-compose.yml:116` monta el de la raíz.
Ninguno de los dos es el correcto: uno deja al rol sin conexión, el otro le pone una password
en el repo. **Esto es `PASADA-2.md` P2-4 / `CODIGO-AUDIT.md` HIGH-6, y sigue abierto.**

---

## 9. T8 — Respuestas de error — 🟡 MEDIUM

**Progreso de la Fase 1:** 23 handlers usan ahora el contrato canónico
(`src/lib/errors/response.ts`). Quedan **11 sin él**, de los cuales 2 son exenciones legítimas
(`auth/[...all]`, `health`). Las 9 restantes son deuda real:

| Handler | Problema |
|---|---|
| `scheduled-reports/route.ts:42,86` + `[id]/route.ts:59,103,130` | **5 sitios** con 400 hardcodeado `{error: userErr.message}` — pierden `code` y `correlationId` |
| `dashboards/templates/route.ts:9-12` | enmascara **todo** fallo como 401 "No autorizado" |
| `templates/[id]/instantiate/route.ts:40` | **devuelve `error.message` crudo al cliente** — viola T8 directamente |
| `alert-rules/[id]/*`, `dashboards/[id]/alerts`, `data-sources/[id]/test` | sin contrato canónico |

**Bien:** 0 `error.stack` en respuestas en todo `src/`. 23 de los 34 handlers usan `toUserError`,
que sanitiza los errores desconocidos.

---

## 10. T9 — Rate limiting — 🟡 MEDIUM

**Las 3 rutas LLM y las de conectores están cubiertas:** `dashboards/generate` (3 checks, dual
org+IP), `nlqa/ask` (2), `widgets/explain` (2), `data-sources` (2), `files/upload` (2).

**[MEDIUM] `alert-rules/[id]/test-channel` dispara una petición HTTP saliente sin ningún rate limit.**
Esa ruta descifra la webhook del usuario y la invoca. Con `validateOutboundUrl` puesto (T6 ✅) no
es SSRF, pero sí es un **amplificador de SSRF** de tráfico saliente: un usuario autenticado puede
usarla para hacer requests a cualquier host público a razón de llamadas ilimitadas, y la
respuesta del webhook se le devuelve. Es un endpoint ideal para DoS sobre un tercero o para
escanear puertos públicos desde tu infraestructura.

Los POST/PATCH/DELETE de CRUD interno (`organizations`, `scheduled-reports`, `onboarding`) sin
rate limit son defendibles: no tocan APIs externas. `files/commit` (ejecuta DDL) y
`dashboards/[id]/export/pdf` (encola jobs BullMQ) son candidatos discutibles.

---

## 11. T10 — Audit log — 🔴 HIGH

**9 rutas que mutan estado sin llamar `audit()`:**

| Ruta | Por qué importa |
|---|---|
| `dashboards/[id]/route.ts` | **PATCH y DELETE de un dashboard** sin rastro. Borrar un dashboard no deja evidencia |
| `scheduled-reports/route.ts` + `[id]/route.ts` | **crear/editar/borrar un reporte programado que envía emails a destinatarios** sin rastro. Es la acción más sensible de la lista: define a quién se le manda data de negocio, y queda sin registro |
| `dashboards/templates/[id]/instantiate` | instanciar una plantilla crea un dashboard, sin rastro |
| `onboarding/{complete,step,track}` | menor sensibilidad |
| `alert-rules/[id]/test-channel`, `data-sources/[id]/test` | acciones de diagnóstico, menor |

`scheduled-reports` es el peor: es la superficie que **exfiltraría datos hacia un tercero** si se
configurara mal, y es precisamente la que no deja registro.

### ✅ Corrección aplicada (2026-09-30) — 5 de 9

Las 5 rutas de la tabla que importan ahora auditan. Los eventos ya existían en
`lib/audit/events.ts`; lo que faltaba era la llamada.

| Ruta | Evento añadido |
|---|---|
| `dashboards/[id]` PATCH | `dashboard.updated` |
| `dashboards/[id]` DELETE | `dashboard.deleted` |
| `scheduled-reports` POST | `scheduled_report.created` |
| `scheduled-reports/[id]` PATCH | `scheduled_report.updated` |
| `scheduled-reports/[id]` DELETE | `scheduled_report.deleted` |

**Tests:** `tests/unit/api/audit-trail.test.ts`, 5 casos, uno por ruta, verificando que el `audit()`
se llama con org, user, evento y recurso correctos. Red primero: los 5 fallaron antes de tocar
código de producción.

**Las 4 que quedan** (`templates/[id]/instantiate`, `onboarding/{complete,step,track}`,
`alert-rules/[id]/test-channel`, `data-sources/[id]/test`) son de menor sensibilidad y no las toqué
— no las pediste y adds scope sin gain. `instantiate` sigue siendo la más interesante de las cuatro
porque crea un dashboard.

---

## Resumen por control

| Control | Veredicto | Hallazgo |
|---|---|---|
| **T1** Aislamiento tenant | 🟠 | `scheduled_reports*` **corregido** (migración 0013). `orgs` sigue con policies inertes → **tarea de diseño**, no migración. Todo depende de HIGH-5 |
| **T2** RBAC | 🟢 | **PASS.** 32/34 con permiso explícito; las 2 sin auth correctas |
| **T3** Validación SQL | 🟡 | Blocklist de funciones **corregido** (21 funciones, patrón compartido) e identificadores **validados en el punto de uso**. Pendiente: blocklist de DML con `\b` |
| **T4** BYOK | 🟡 | **CRITICAL cerrado**: endpoint con cifrado + UI honesta. Queda HIGH-9: `dashboards/generate` no lee la config de la org |
| **T5** Logs | 🟡 | Redacción bien. 3 `console.error` logueando objetos de error de email |
| **T6** SSRF | 🟢 | **PASS con mérito.** Valida en el punto de uso + `redirect: 'manual'` |
| **T7** Read-only | 🟡 | Cadena de `pg_read_file` **cerrada**. Sigue el desajuste entre los dos `init-readonly.sql` |
| **T8** Errores | 🟡 | 23/34 canónicos. 9 pendientes; uno devuelve `message` crudo |
| **T9** Rate limit | 🟡 | Rutas LLM cubiertas. `test-channel` sin límite y hace fetch saliente |
| **T10** Audit log | 🟡 | **5 de 9 corregidas** (las sensibles). 4 menores abiertas |

---

## Orden de ejecución corregido

Por severidad real, no por orden de los informes. **Estado al cierre de esta ronda:**

1. ~~T7 + T3 (blocklist)~~ — ✅ GRANT eliminado + 21 funciones en `buildForbiddenPattern()`, 27 tests.
2. ~~T10~~ — ✅ 5 rutas auditadas, 5 tests.
3. ~~T1 (parcial)~~ — ✅ `scheduled_reports*` con RLS. **`orgs` sigue abierto** y requiere helper
   `SECURITY DEFINER`; no es una migración. Falta además un step de CI que falle si una tabla
   tenant declarada tiene `rowsecurity = false`, para que esto no vuelva a pasar.
4. ~~T4~~ — ✅ endpoint BYOK + UI honesta.
5. ~~T3 (defense in depth)~~ — ✅ `sql-ident.ts` en los 4 sinks. Salió un bug de producción de paso.
6. **Confirmar HIGH-5 contra una DB real** — 🔴 **es el próximo paso real.** Si el rol de la app
   es superuser, T1 sube a CRITICAL y todo lo demás es secundario. Requiere Docker, no esta máquina.
7. **HIGH-9** — que `dashboards/generate` (y cualquier otro consumidor) lea la config de la org,
   para que la key BYOK no solo se guarde sino que se use.
8. **Colisión de `targetTable`** — sufijo hash en `safeTableName` (§4). Bug de integridad de datos
   intra-tenant, no de aislamiento.
9. **T9** — rate limit en `test-channel`.
10. **T8** — migrar las 9 rutas restantes al contrato canónico. Mecánico, y ya está el patrón.
11. **T5** — los 3 `console.error` de `auth/config.ts`.
12. **Unificar los dos `init-readonly.sql`** (raíz vs `app/`): el de la raíz tiene
    `WITH LOGIN PASSWORD 'dashbi_readonly_password'` hardcodeada.

**Lo que NO hay que tocar:** el filtro PII (recién arreglado y verificado), T6/SSRF, T2/RBAC,
el cifrado, y las 13 migraciones salvo el `ENABLE` faltante de `orgs`.

---

## Lección de método (la más transferable de esta ronda)

**T3 no era un hallazgo de seguridad: era un bug de producción disfrazado de tarea de
hardening.** Al enrutar los sinks por un validador común, el validador se negó a aceptar el valor
que el productor ya estaba emitiendo — y eso saltó a la superficie diciendo "el flujo de commit de
archivos está roto desde siempre".

Dos componentes con tests propios, ambos verdes, y **cero tests del contrato que los une**. Por eso
esta ronda no solo agrega validación: el test del seam (`target-table-sink.test.ts`) es lo que
impide que la próxima refactorización vuelva a partir el mismo cordón en el mismo lugar.

**Regla que sale de ahí:** cuando dos módulos comparten un contrato (un nombre, un schema, un
formato), el test del contrato vale más que los tests de cada lado. Un test por parte verifica que
cada uno hace bien lo suyo; ninguno verifica que hagan lo mismo.

---

## Límites de esta verificación

- **Los gates sí corrieron al cierre de las correcciones**, a diferencia de la primera pasada que
  fue análisis estático: `pnpm typecheck` ✅ · `pnpm lint:strict` ✅ (0 warnings) ·
  `pnpm test` ✅ 1083 tests / 124 archivos · `pnpm build` ✅.
- **HIGH-5 sigue sin la prueba empírica.** La causa no es que falte Docker (está instalado), sino
  que mi sesión de shell quedó con los grupos previos al `usermod` y no puede abrir el socket.
  Corrible con [`verify-high5.sh`](./verify-high5.sh) desde tu shell. El mecanismo ya está
  confirmado por lectura del compose (§1) — lo que falta es el `rolsuper` en vivo.
- **El test de RLS de `scheduled_reports` no se ejecutó localmente**: requiere Testcontainers
  (Docker), así que solo correrá en CI con `RLS_TESTS_REQUIRED=1`. **No lo cuento como verificado.**
- **No verifiqué en runtime la explotabilidad de la cadena de `pg_read_file`**: los 5 eslabones
  están verificados por lectura de código, pero qué init script y qué privilegios reales hay en
  tu despliegue es lo primero que hay que confirmar.
- **No audité los objetos `error` de better-auth** que se loguean en `auth/config.ts:167,221,267`,
  así que no puedo afirmar si contienen tokens de magic-link. Lo marqué como sospechoso, no como
  confirmado.
- **No repetí el análisis de cobertura de la suite de tests** de `PASADA-2.md` §4b; sigue vigente
  (en particular, `/api/nlqa/ask` continúa sin test que verifique que `validateQuery` se invoca).
- **Me equivoqué al afirmar "no hay Docker en esta máquina"** y lo dejé escrito en el informe antes
  de corregirlo. No lo había comprobado en esa ronda; lo di por sabido. Queda la corrección arriba
  para que la afirmación original no se lea como vigente.

