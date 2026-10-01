# Auditoría de código — dash-bi

**Fecha:** 2026-09-30
**Alcance:** 208 archivos TS/TSX (~27.3k LOC) en `app/`, 12 migraciones, CI, deps, y el diff sin commitear.
**Método:** gates de CI ejecutados localmente + revisión manual del núcleo de seguridad + 4 exploradores en paralelo (API/auth, connectors, frontend, CI/deps). Cada hallazgo fue re-verificado leyendo el código antes de reportarse.

## Estado de los gates (evidencia base)

| Gate | Comando | Resultado |
|---|---|---|
| Typecheck | `pnpm typecheck` | ✅ exit 0 |
| Lint | `pnpm lint:strict` | ✅ exit 0, 0 warnings |
| Unit | `pnpm test` | ✅ 114 archivos, 942 tests, 3 skipped |
| Build | `pnpm build` | ✅ exit 0 |

**El proyecto está completamente verde y, aun así, los 4 hallazgos CRITICAL de abajo existen.** La causa de fondo es que la suite valida las funciones de seguridad *de forma aislada*, nunca a través de su camino real de ejecución. `tests/security/pii-filter.test.ts` tiene 40+ aserciones sobre `assertRolePermissions` y todas pasan — pero esa función **no se invoca nunca en producción** (ver CRITICAL-3).

---

## CRITICAL

### CRITICAL-1 — Fuga cross-tenant de PDFs vía enumeración de `jobId`

`app/src/app/api/dashboards/[id]/export/pdf/route.ts:42-81` · `app/src/lib/export/pdf-enqueue.ts:79-102`

`GET /api/dashboards/<cualquier-uuid>/export/pdf?jobId=N` llama `getPdfJobStatus(jobId)`, que hace `getQueue().getJob(jobId)` y devuelve el buffer **sin comparar jamás org ni usuario**. El `dashboardId` del path solo se usa para el nombre del archivo y el log de auditoría.

**Trigger:** cualquier usuario autenticado con `export.pdf` itera `jobId=1,2,3…`.
**Impacto:** los IDs de BullMQ son enteros secuenciales. Se descarga el PDF renderizado de los dashboards de **todos los tenants**. Redis no está cubierto por RLS, así que la aislamiento no aplica en absoluto. Es una brecha de confidencialidad completa e independiente de todo lo demás.
**Fix:** guardar `orgId`+`userId` en `job.data` y rechazar si no coinciden con `ctx`; o indexar el lookup por `(orgId, jobId)`.

### CRITICAL-2 — Lectura cross-tenant de alert rules: filtro incompleto + RLS inexistente

`app/src/app/api/dashboards/[id]/alerts/route.ts:111-117`

```ts
.where(eq(alertRules.dashboardId, dashboardId))   // ← sin predicado de orgId
```

El único filtro es `dashboardId`, delegando la seguridad a RLS. Pero `alert_rules` **no tiene RLS en ninguna migración** (verificado sobre los 12 archivos SQL) y `pnpm db:setup-rls` —el único lugar donde se define— nunca lo ejecuta ni CI ni `docker-compose.yml`.

**Trigger:** `GET /api/dashboards/<uuid-de-otra-org>/alerts` con cualquier rol.
**Impacto:** devuelve las alert rules de otro tenant: `querySql`, `condition` y `channels` (webhook URLs cifradas), además de nombres y descripciones de métricas de negocio. El mismo hueco alcanza a `alert-rules/[id]` PATCH/DELETE.
**Fix:** añadir `eq(alertRules.orgId, orgId)` **y** una migración con `ENABLE`+`FORCE ROW LEVEL SECURITY`.

### CRITICAL-3 — La protección PII de rol `viewer` es código muerto

`app/src/lib/security/validate-query.ts:200-214` · `app/src/lib/query-engine/execute.ts:66-75` · `app/src/lib/query-engine/dashboard.ts:14-36`

Cadena verificada extremo a extremo:

1. `assertRolePermissions` solo se invoca dentro de `validateQuery`, guardado por `if (role)`.
2. `ExecuteOptions.role` es quien lo provee. **Ningún caller en todo el repo lo pasa** — `grep -A6 "executeWithTimeout(" src/` no devuelve ni una vez `role`.
3. `hydrateDashboard(orgId, userId, widgets)` **no acepta parámetro `role`**; llama `executeWithTimeout(connector, dataSourceId, query)` sin opts. Es el path de `GET /api/dashboards/[id]`.
4. `nlqa/ask/route.ts:201` llama `validateQuery({...}, dataSourceType)` con 2 argumentos — sin rol.
5. `resolveConnector` sí recibe `role` y hace `setRole()`, pero **ningún connector implementa `setRole`** → propagación muerta.

Resultado: `grep -rn "assertRolePermissions(" src/ tests/` devuelve **solo tests**. La función nunca corre en producción.

**Trigger:** un usuario con rol `viewer` carga cualquier dashboard, o usa NLQA.
**Impacto:** el control de threat-model T2 "viewer no accede a columnas PII" **no se aplica nunca**. El rol más bajo lee SSN, tokens y datos de tarjetas.
**Fix:** propagar `role` por `hydrateDashboard` → `executeWithTimeout` → `validateQuery`, y añadir un test **de integración** que atraviese la ruta real en lugar de llamar la función suelta.

### CRITICAL-4 — BYOK de credenciales LLM: no existe camino de escritura, y la UI lo afirma

`app/src/app/(dashboard)/settings/page.tsx:21-25` · `app/src/db/schema.ts:96`

```ts
const handleSaveLLM = (e: React.FormEvent) => {
  e.preventDefault();
  setSavedMsg(true);           // ← muestra "guardada y encriptada exitosamente"
  setTimeout(() => setSavedMsg(false), 3000);
};
```

Sin `fetch`, sin mutación, y **no existe endpoint BYOK** (no hay ruta `llm-keys`/`settings` en `src/app/api`). Verificado además que `orgs.llmApiKeyEncrypted` **nunca se escribe**: no hay ningún `.set()`/`.values()` que lo asigne en todo `src/`. Solo se lee (`nlqa/ask:146`, `widgets/explain:86`).

**Trigger:** pegar una API key y guardar.
**Impacto:** la UI confirma un guardado que no ocurrió; la key se descarta al navegar; todo el tráfico LLM sigue yendo a la credencial de la plataforma. Agrava CRITICAL-5 (`dashboards/generate` ni siquiera consulta la config de org). Daño de confianza sobre un control de seguridad.

*Matiz importante:* la machinery de cifrado **sí es sólida y se usa bien** para credenciales de data sources (`encryptApiKey` en `data-sources/route.ts:323` y `files/commit/route.ts:162`). El hueco es específico del BYOK de LLM a nivel org.
**Fix:** implementar el endpoint + mutación, o quitar el formulario hasta que exista.

---

## HIGH

### HIGH-1 — El filtro PII es evadible por convención de nombres (y el wildcard, por un comentario)

`app/src/lib/security/validate-query.ts:187-213`

Verificado empíricamente contra los regex reales:

```
SENSITIVE  SELECT password FROM users        → bloqueada
SENSITIVE  SELECT user_password FROM users   → PASA   ✗
SENSITIVE  SELECT customer_ssn FROM customers→ PASA   ✗
SENSITIVE  SELECT billing_tax_id FROM invoices → PASA ✗
WILDCARD   SELECT * FROM users               → bloqueada
WILDCARD   SELECT/*x*/* FROM users           → PASA   ✗
```

Dos causas: `\b` no hace frontera entre `_` y un carácter de palabra, así que **toda columna con prefijo snake_case** (la convención mayoritaria en Postgres) evade el filtro; y en `WILDCARD_PROJECTION` el `*` debe ir precedido de `[\s,(]`, pero un `/` de comentario no califica.

**Impacto:** combinado con CRITICAL-3, hoy es inerte; en cuanto se arregle #3, sigue siendo explotable. Ambos deben arreglarse juntos.
**Fix:** comparar contra una lista de columnas resuelta desde el catálogo del data source en vez de regex sobre el texto; para el wildcard, normalizar comentarios antes de evaluar.

### HIGH-2 — El LIMIT automático se descarta: `validateQuery` muta, pero nadie lee la mutación

`app/src/lib/security/validate-query.ts:60-64`

```ts
if (!/LIMIT\s+\d+/i.test(sql)) {
  query.sql = `${cleanSql} LIMIT 10000`;   // muta el objeto recibido
}
```

`validateQuery` devuelve `void` y aplica el LIMIT **mutando su argumento**. Varios callers le pasan un objeto temporal y luego ejecutan el SQL original:

| Caller | Objeto pasado | Qué se ejecuta |
|---|---|---|
| `query-engine/execute.ts:70-74` | `{kind:'sql', sql: query.sql}` (nuevo, branch spreadsheet) | `query` original, **sin LIMIT** |
| `api/nlqa/ask/route.ts:201` | `{kind:'sql', sql: sqlResult.sql}` (nuevo) | `sqlResult.sql` original |
| `api/alert-rules/[id]/route.ts:40` | `{kind:'sql', sql: sqlWithLimit}` (nuevo) | `sqlWithLimit` original |
| `lib/alerts/evaluator.ts:70` | `{kind:'sql', sql: r.querySql}` (nuevo) | `r.querySql` original |

Solo los connectors (`postgres.ts:109`, `mysql.ts:94`, etc.) pasan el objeto real y sí funcionan.

**Impacto:** consultas de IA sin límite de filas → agotamiento de memoria en el proceso. El path de spreadsheets es el peor: `spreadsheet.ts:138-147` valida una copia y luego ejecuta `sql.raw(query.sql)` sin limite, mientras `truncated: result.length >= 10000` **afirma** que hubo truncamiento.
**Fix:** cambiar el contrato a `validateQuery(query): string` que devuelva el SQL final, y eliminar la mutación implícita.

### HIGH-3 — El cap de filas tampoco limita: `LIMIT 999999999` pasa el filtro

`app/src/lib/security/validate-query.ts:60`

`/LIMIT\s+\d+/i` solo pregunta *si* hay un LIMIT, nunca *cuánto*. Verificado: `SELECT 1 FROM t LIMIT 999999999` → no se inyecta nada. Peor: un LIMIT en una subconsulta desactiva el del exterior — `SELECT a FROM (SELECT b FROM t LIMIT 5) x` pasa el test y queda **sin límite**.
**Fix:** parsear el valor y forzar `min(valor, 10000)`, o envolver la query en `SELECT * FROM (…) LIMIT 10000`.

### HIGH-4 — RLS ausente o inerte en 6 de 15 tablas tenant-scoped

Verificado sobre las 12 migraciones + `src/db/rls.ts` + `scripts/setup-rls.ts`:

| Tabla | org_id | `ENABLE` | `FORCE` | Policy | Estado |
|---|---|---|---|---|---|
| `dashboards`, `data_sources`, `dashboard_versions`, `public_links`, `llm_usage`, `audit_log`, `org_members`, `nlqa_*` | ✅ | ✅ | ✅ | ✅ | Correcto |
| `uploaded_files` | ✅ | ✅ | ❌ | ✅ | **Policy inerte** |
| `orgs` | — | ❌ | ❌ | ✅ | **Policy inerte** |
| `alert_rules`, `alert_events` | ✅ | ❌ | ❌ | ❌ | **Sin RLS** |
| `scheduled_reports`, `scheduled_report_runs` | ✅ | ❌ | ❌ | ❌ | **Sin RLS** |

Dos mecanismos distintos de fallo:
- **`orgs`**: la policy `orgs_isolation` se crea (migraciones 0001 y 0004) pero `ALTER TABLE "orgs" ENABLE ROW LEVEL SECURITY` **nunca se ejecuta**. En Postgres una policy sin RLS habilitado es código muerto.
- **`uploaded_files`**: tiene `ENABLE` pero **no `FORCE`**. Postgres no aplica RLS al *owner* de la tabla salvo con `FORCE`, y la app conecta como el owner.

Las rutas sí filtran por `eq(table.orgId, orgId)` en código, así que hoy no hay fuga directa — pero el backstop que AGENTS.md declara como frontera de seguridad no existe para 6 tablas. Un solo `.where()` olvidado en el futuro es una fuga silenciosa.
**Fix:** una migración que aplique `ENABLE`+`FORCE`+policy a las 6, y un paso de CI que falle si alguna tabla tenant de una lista declarada tiene `rowsecurity = false`.

### HIGH-5 — El rol de la app es superuser → RLS bypasseado por completo

`docker-compose.yml:27,109` · `docs/env-contract.md:35`

`DATABASE_URL` se construye con `${POSTGRES_USER}` (default `dashbi`), que la imagen oficial de Postgres crea como **superuser**. No hay ningún `ALTER ROLE … NOSUPERUSER`, `BYPASSRLS` ni script que degrade el rol en todo el repo. Postgres hace que superusuarios ignoran RLS **incondicionalmente** — incluso las tablas con `FORCE`.

`docs/env-contract.md:35` documenta la intención correcta ("app role con DDL/DML limitados"), pero el despliegue entregado no la cumple.

> **No pude verificarlo contra una DB en vivo** (docker no está disponible en esta máquina). Es un hallazgo de configuración derivado de leer compose + la ausencia de cualquier script de degradación de rol. **Confirmar contra el despliegue real es el primer paso.**

**Impacto si se confirma:** toda la capa RLS — las 9 tablas "correctas" incluidas — es decorativa frente a la conexión de la app. El único límite real sería el filtro por `orgId` en cada query.
**Fix:** crear un rol de aplicación `NOSUPERUSER` con `GRANT SELECT/INSERT/UPDATE/DELETE` (y DDL solo para el usuario de migraciones), y apuntar `DATABASE_URL` a ese rol.

### HIGH-6 — `db:setup-rls` nunca se ejecuta, y el compose monta el script de init equivocado

`docker-compose.yml:116` · `scripts/postgres/init-readonly.sql:5` · `app/scripts/postgres/init-readonly.sql:8`

Dos archivos con el mismo nombre y contenido incompatible. El compose monta el de **raíz**, que hardcodea `PASSWORD 'dashbi_readonly_password'`, mientras `DATABASE_READONLY_URL` se arma desde `${POSTGRES_READONLY_PASSWORD:?}` (`.env.staging.example:28` lo genera). Nunca coinciden → **toda query generada por IA falla autenticarse**, y la defense-in-depth de threat-model T2/Warning-5 queda silenciosamente ausente. El script hermano además crea el rol `NOLOGIN` y otorga `pg_read_file` al rol de AI (lectura arbitraria de archivos).

Combinado: `db:setup-rls` no aparece en `ci.yml` ni en ningún compose, pese a que `README.md:97` y `CONTRIBUTING.md:28` instruyen a ejecutarlo. README/CONTRIBUTING/docs/AGENTS.md/**tres** definiciones de RLS que ya divergieron entre sí.
**Fix:** una migración como única fuente de verdad; reducir `setup-rls.ts` a un assert de verificación; unificar el init script con la password desde env.

### HIGH-7 — La validación de env (Zod) es código muerto

`app/src/lib/env.ts:48-66`

`getEnv()` tiene exactamente 3 referencias en el repo: su definición, un import en `drizzle.config.ts:4`, y un import en `tests/unit/env.test.ts:3` — que **nunca la llama** (cada test redefine un `z.object({...})` propio y valida eso). Ningún camino de runtime la invoca; los consumidores leen `process.env` con fallback silencioso (`db/client.ts:12` → `'postgresql://localhost:5432/dashbi'`).

`AGENTS.md:26` promete "Falla rápido en boot si falta algo crítico". No lo hace. `PDF_WORKER_SECRET: z.string().min(16)` nunca se exige. `EMBED_TOKEN_SECRET` ni siquiera está en el schema, y `token.ts:37` cae silenciosamente a `LLM_KEY_ENCRYPTION_KEY` cuando está vacío (como sugiere `.env.example:54`) → dos dominios de confianza acoplados.
**Fix:** llamar `getEnv()` una vez en `instrumentation.ts`; exportar `envSchema` y testear contra ella.

### HIGH-8 — Open redirect post-login

`app/src/app/(dashboard)/../(auth)/login/page.tsx:61` (y `:36`, `:65`, `:94`)

`redirect` sale crudo del query string y se asigna a `window.location.href`, y también se pasa a better-auth como `callbackURL`. `src/middleware.ts:85` solo *setea* el param para usuarios no autenticados; nada valida que sea same-origin.

**Trigger:** `/login?redirect=https://evil.example/login`.
**Impacto:** phishing de credenciales post-autenticación.
**Fix:** aceptar solo paths que empiecen con un único `/` y no con `//`.

### HIGH-9 — `dashboards/generate` ignora el BYOK y factura a la plataforma

`app/src/app/api/dashboards/generate/route.ts:85-91`

Construye `new AiGateway()` sin argumentos y hardcodea `provider='openai'`, `modelName='gpt-4o'`, a diferencia de `nlqa/ask:144-151` y `widgets/explain:84-90` que sí resuelven la config de org. El comentario en el código reconoce el problema y lo despacha igual.
**Impacto:** combinado con CRITICAL-4, el BYOK es inejistente en las tres rutas LLM.

### HIGH-10 — `error.tsx` no existe en ninguna parte, y `body.widgets` no se valida

`app/src/components/properties/PropertyPanel.tsx:259-260` · `app/src/app/api/dashboards/[id]/route.ts:146`

No existe ningún `error.tsx`, `global-error.tsx`, `not-found.tsx` ni `loading.tsx` en `src/app` (el componente `ErrorState`/`WidgetErrorState` está implementado y testeado pero **nunca montado**). Y el PATCH de dashboard escribe `body.widgets` directo a la DB sin zod.

**Trigger:** NLQA devuelve `chartSuggestion: {type:'table', config:{}}` sin `columns` → `widget.config.columns.length` lanza `TypeError`; como el widget se persiste sin validar, **re-crasha en cada carga posterior**.
**Impacto:** un throw en render tumba la ruta completa (React desmonta en el boundary raíz) y el usuario ve el error por defecto del framework, no la UI de reintento diseñada. Un solo `config` malformado del modelo deja el dashboard inutilizable de forma permanente.
**Fix:** `error.tsx` por segmento; validar `widgets` con zod en el PATCH; guardas `config.columns?.length ?? 0`.

### HIGH-11 — Gates de entrega más débiles de lo que AGENTS.md exige

| Gap | Evidencia |
|---|---|
| Lint permisivo | `ci.yml:43-51` usa `--max-warnings 100` con un comentario que justifica "59 warnings pre-existentes" y una URL `<TBD>`; `AGENTS.md:110` y `package.json:18` exigen `--max-warnings 0` (que **hoy pasa limpio**) |
| `pnpm audit` ausente de CI | 10 vulnerabilidades high (5 en `--prod`, vía `@sentry/nextjs > minimatch > brace-expansion`); sin step ni `schedule:` |
| `.husky/` no existe | Declarados `"prepare": "husky"` y `lint-staged`; el directorio no está. `docs/ci-hygiene.md:82-97` afirma que están configurados |
| `tsconfig.worker.json` no existe | `package.json:41` apunta a él; el worker PDF no tiene build type-checked |
| Actions por tag, no por SHA | `checkout@v4`, `setup-node@v4`, etc. |
| Enum drift | `uploaded_file_format`/`uploaded_file_column_type` en `schema.ts` pero en ninguna migración (`0007` usa `text` + `CHECK`) |
| Test RLS puede no correr | El job `verify` **no declara `services:`**; el guard solo re-lanza para un mensaje de error concreto, y la suite se ejecuta 2× (test + coverage) |

**Nota sobre la cobertura:** el gate que activaste en `7c62816` es genuino y no vacuo, pero su `include` cubre solo `src/lib` + `src/db` — el código con más lógica de seguridad. `src/app/api/**` (donde están CRITICAL-1, 2 y 9) está **fuera** del umbral.

---

## MEDIUM

| # | Hallazgo | Ubicación |
|---|---|---|
| M1 | `Promise.race` + `setTimeout` **no cancela** la query: al expirar el timeout el query sigue corriendo contra la DB. Timeouts repetidos acumulan queries huérfanas y agotan el pool (`max: 10`). El timer nunca se limpia. Sin `AbortSignal`/`statement_timeout`. | `query-engine/execute.ts:81-86` |
| M2 | `circuitBreakers` es un `Map` a nivel de módulo **sin tope ni eviction**, y por instancia: en un deploy multi-réplica la protección es inconsistente y un tenant puede abrir el circuito del connector de su org. | `query-engine/execute.ts:12-33` |
| M3 | `withOrgContext` con 3 args **defaultea `role: 'editor'`**. ~40 call sites usan esa forma, así que `app.current_user_role` miente para viewers. El overload que sí pasa rol es la excepción. | `db/client.ts:97-104` |
| M4 | Conector de spreadsheets llama `withOrgContext('', null, …)` para resolver el archivo (3 sitios). El comentario afirma que "RLS usa los GUCs de sesión", pero con org vacío el helper `app_current_org_id()` devuelve el UUID cero → 0 filas; y como `uploaded_files` no tiene `FORCE`, el owner la lee igual. O sea: o está roto, o no aísla. | `connectors/implementations/spreadsheet.ts:77,96,128` |
| M5 | `assertRolePermissions` solo bloquea con `if (role !== 'viewer')` sobre el **texto** de la query. Un role nuevo (`analyst`, `guest`) queda sin restricción. | `validate-query.ts:200-201` |
| M6 | Errores con `__code` no tienen rama en `toUserError` → un "not found" y un conflicto de concurrencia devuelven **500** en vez de 404/409; el retry logic sobre 409 nunca dispara. | `dashboards/[id]/route.ts:92,96` |
| M7 | `scheduled-reports` (5 handlers) responde **400 hardcodeado** para todo error, incluidos 401/403/500, y sin `code`/`correlationId` → rompe el contrato AppError. | `scheduled-reports/route.ts:40-43`, `[id]/route.ts:57-60,101-104,128-131` |
| M8 | Rutas `templates` enmascaran **todo** fallo como 401 "No autorizado" con el `error.message` crudo en el body. | `dashboards/templates/route.ts:9-12` |
| M9 | Mensajes crudos del driver Postgres (host, puerto, db name) devueltos al cliente, saltándose `toUserError`; además 500 para fallos de auth. | `data-sources/[id]/test/route.ts:31-36` |
| M10 | La policy de `org_members` aplicada (0004, self-only) difiere de la del script (self **OR** org). En entornos solo-migración, `GET /api/organizations/members` devuelve solo el caller, y el guard de "último admin" cuenta ≤1 admin → se puede quedar la org en 0 admins. | `0004_rls_null_safe.sql:31-37` vs `scripts/setup-rls.ts:47-55` |
| M11 | `parseStore` es un `Map` global sin namespacear por org, sin TTL, y `takeParsedForCommit` **borra antes** de verificar ownership → otro org puede destruir un upload pendiente. Además fuga de memoria. | `api/files/commit/route.ts:75-115` |
| M12 | `POST /api/scheduled-reports` acepta un `dashboardId` arbitrario del body sin verificar ownership. | `scheduled-reports/route.ts:63-81` |
| M13 | `POST /share` inserta `publicLinks` con `orgId` del atacante + `dashboardId` de la víctima sin verificar ownership. Impacto real condicionado a HIGH-5: con RLS efectivo devuelve `not_found`; con RLS inerte (superuser) **sirve el dashboard ajeno al público**. | `dashboards/[id]/share/route.ts:41-54` |
| M14 | El check de embed no filtra por org; el token HMAC queda con `orgId` del atacante y `dashboardId` de la víctima. | `dashboards/[id]/embed/route.ts:40-51` |
| M15 | `['dashboards']` nunca se invalida tras crear → con `staleTime: 60s` el dashboard recién creado no aparece en la lista y el usuario crea duplicados. | `(dashboard)/dashboards/page.tsx:59,73-91` |
| M16 | `lastSavedRef` del autosave es un ref de hook que **nunca se resetea** al cambiar de dashboard → la primera edición real de un dashboard con estado serializado igual se pierde en silencio. Además `onSuccess` marca como guardado el `pendingRef` (el más nuevo), no el payload enviado. | `hooks/use-auto-save.ts:22,54,90` |
| M17 | NLQA limpia el input antes de enviar y **elimina el mensaje del usuario en ambos caminos de error** → un 429/500 borra la pregunta sin affordance de retry. | `components/nlqa/NlqaPanel.tsx:78,105-107,126-127` |
| M18 | `AddWidgetDialog` fabrica `dataSourceId: 'ds_default'` si el campo está vacío, y el autosave lo persiste → widget permanentemente vacío. | `components/widgets/dialogs/AddWidgetDialog.tsx:71` |
| M19 | `html2canvas` (194 KB) en el chunk inicial de **toda** vista de dashboard por import estático, para una acción rara. | `ExportShareDialog.tsx:5` + `dashboards/[id]/page.tsx:280` |
| M20 | `useToast` depende de `[state]` en vez de `[]` → cada dispatch re-suscribe a todos los consumidores y un dispatch entre render y flush de effect **se pierde**. | `hooks/use-toast.ts:120-126` |
| M21 | `/dashboards/new` no existe (confirmado en la tabla de rutas del build) → resuelve a `[id]="new"` → 404, y el page **cae al dashboard anterior** en memoria mostrando su título y widgets bajo una URL plausible. | `(dashboard)/dashboards/page.tsx:129-136`, `onboarding/SuccessStep.tsx:34-38` |
| M22 | `GET /api/health` es público, usa `db.execute` directo (fuera de `withOrgContext`) y **crea una conexión Redis nueva por request**; expone latencias y versiones. | `api/health/route.ts:7-46` |

### Regresión introducida por el diff sin commitear

`app/src/app/globals.css:80,90` (tokens nuevos) → `components/ui/button.tsx:13,15` y `dropdown-menu.tsx:41,59`

El diff agrega `--color-accent-foreground-hsl: 0 0% 100%` (blanco) sobre `--color-accent-hsl: 330 81% 60%` (`#ec4899`) = **3.53:1**, por debajo de AA 4.5:1 para texto de 14px. Afecta a **todo hover de botón outline/ghost y al focus por teclado de cualquier menú** en modo claro. Antes del diff `text-accent-foreground` era un token inexistente, la clase era no-op y el label conservaba su color oscuro (5.4:1) — **la regresión la introduce este cambio**. Repetido en el bloque corporate (blanco sobre cyan-700 ≈ 3.4:1, `globals.css:203,212`); los bloques dark están bien.
**Fix:** poner un valor oscuro en `--color-accent-foreground-hsl` del tema claro.

---

## LOW

| # | Hallazgo | Ubicación |
|---|---|---|
| L1 | Timers y fetches sin cleanup ni `AbortController` → trabajo wasting post-unmount (React 19 lo descarta en silencio, sin warning) y requests LLM que siguen corriendo tras salir. | `use-auto-save.ts:56-58`, `ExportShareDialog.tsx:246,267`, `NlqaPanel.tsx:74-131` |
| L2 | Eventos del funnel de onboarding se disparan dos veces: las deps incluyen `selectedSourceType`, y el cleanup de la corrida anterior re-emite `step_completed`. | `onboarding/OnboardingFlow.tsx:43-68` |
| L3 | Nesting interactivo inválido (`<button>` dentro de `<a>` y `<a>` dentro de `<button>`) en la pantalla de éxito → dos focus targets para AT. | `onboarding/SuccessStep.tsx:30-44` |
| L4 | `?limit=` en eventos de alerta usa `Number(x) \|\| 50`, que mapea `0`, `NaN` y `''` a 50 en vez de rechazar. | `alert-rules/[id]/events/route.ts:27-28` |
| L5 | AGENTS.md desactualizado: dice Drizzle 0.38 (instalado 0.45.2), Vitest 2.1 (instalado 3.2.7). Playwright 1.61 y TS 5.7 sí correctos. El archivo se inyecta en el contexto de cada agente. | `AGENTS.md:11,20` |

---

## Fortalezas verificadas (para no re-auditar)

- **Validación SSRF** (`validate-connection.ts`): sólida. Cubre IPv4/IPv6 privados, IPv4-mapped, link-local, metadata endpoints, y las formas `inet_aton` (`2130706433`, `127.1`, `0177.0.0.1`, `0x7f.0.0.0`) con lookup en el momento de conectar (anti-rebinding).
- **Cifrado** (`encryption.ts`): AES-256-GCM correcto, IV aleatorio de 16 bytes por llamada, auth tag verificado vía `decipher.final()`, y usado correctamente para credenciales de data sources.
- **Inyección de fórmulas CSV/Excel**: prevenida correctamente en tiempo de carga (`sanitize.ts:17` cubre `= + - @ \t \r`), no en query time.
- **MySQL y Snowflake**: validan el host contra el blocklist SSRF y no interpolan SQL crudo.
- **Rate limiting en las 3 rutas LLM**: presentes y correctas (30/0.5s, dual org+ip en generate). Limitación conocida: es in-memory, se reinicia por instancia.
- **Secretos en logs**: pino redaction + `redactSecrets`; `PG_DEBUG=1` loguea sentencias pero no valores.
- **Higiene de tests**: los `.test.tsx` llevan su docblock `happy-dom`; sin `useFakeTimers` sin restaurar; sin llamadas de red incondicionales; los reports de Playwright están gitignorados.

---

## Orden de ejecución sugerido

1. **CRITICAL-1** (PDF) — una línea de diff, cierre total de la brecha.
2. **CRITICAL-2** (alerts) — predicado de org + migración RLS.
3. **CRITICAL-3 + HIGH-1** juntos — sin ambos arreglados, el control PII sigue sin efecto; con solo uno, sigue evadible.
4. **HIGH-5** — confirmar contra la DB real y degradar el rol de app. Si se confirma, sube a CRITICAL y cambia la prioridad de todo lo demás.
5. **HIGH-2 + HIGH-3** — cambiar el contrato de `validateQuery` a que devuelva el SQL final en vez de mutar el argumento.
6. **HIGH-4 + HIGH-6** — una migración como fuente única de verdad + step de CI que verifique `rowsecurity`.
7. **CRITICAL-4 / HIGH-9** — implementar BYOK o eliminar el formulario que promete lo que no hace.

**Regla transversal:** el patrón que produjo casi todos los hallazgos es *testear la función de seguridad directamente en vez de su camino real*. Los 40+ asserts de `pii-filter.test.ts` pasan sobre una función que la producción nunca invoca. Para cada fix de seguridad de esta lista, el test debe atravesar la ruta HTTP completa.
