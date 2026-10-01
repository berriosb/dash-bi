# Segunda pasada de auditoría — dash-bi

**Fecha:** 2026-09-30 (mismo día que `ARQUITECTURA-AUDIT.md`)
**Alcance:** todo lo que la primera pasada **no miró**. La pasada 1 se centró en `app/src/`;
esta cubre `scripts/`, `drizzle/`, `.github/`, configs de raíz, middleware, y hace un
inventario de escapes de reglas.
**Por qué existe:** la pasada 1 pudo dar una falsa sensación de cobertura total cuando
en realidad dejó fuera directorios enteros.

---

## Veredicto en una página

**Sí se me pasaron carpetas. Y una contenía un agujero de seguridad encadenado que ninguna de
las dos auditorías previas había visto.**

Tres resultados:

1. **🔴 Un agujero de seguridad real y encadenado** — ver [P2-1](#p2-1). La cadena
   `pg_read_file` concedido + ausente del blocklist + rol promocionado a `LOGIN` permite
   lectura arbitraria de archivos del host de Postgres vía inyección de prompt en NLQA.
2. **🔴 La regla custom de lint no cumple lo que su nombre promete** — `no-raw-db-queries`
   solo detecta 4 métodos del query builder. Hay 19 SQL crudos que no ve. Ver [P2-2](#p2-2).
3. **✅ El código de `src/` está sorprendentemente limpio de escapes de reglas** — 0
   `eslint-disable`, 0 `any`, 0 `@ts-ignore` en todo el código de producción. Ver [§3](#3-escapes-de-reglas).

**Y una corrección propia:** la pasada 1 clasificó `lib/auth/config.ts` como "config
declarativa, no es problema". **Estaba mal, y el error era mío** — loarked `[INFERIDO]`
en un explorador y lo repetí como verificado. Ver [§4](#4-corrección-de-la-pasada-1).

---

## P2-1 — `pg_read_file` concedido al rol de queries de IA, y ausente del blocklist 🔴

**Este es el hallazgo más grave de las tres auditorías, y ninguno de los dos informes previos lo vio.**

La cadena completa, verificada paso a paso:

| # | Eslabón | Evidencia |
|---|---|---|
| 1 | El init script otorga lectura arbitraria de archivos al rol que ejecuta SQL generado por IA | `app/scripts/postgres/init-readonly.sql:21` — `GRANT EXECUTE ON FUNCTION pg_read_file(text) TO dashbi_readonly;` |
| 2 | El comentario de esa misma línea no describe lo que la línea hace | `:20` dice `-- EXPLAIN permitido (útil para debugging de queries lentas)`. `pg_read_file` no tiene nada que ver con EXPLAIN. **Comentario y GRANT no coinciden** |
| 3 | El blocklist de `validateQuery` **no incluye** `pg_read_file` ni ninguna otra función de lectura de archivos del servidor | `src/lib/security/validate-query.ts:49` — el regex es `/\b(INSERT\|UPDATE\|DELETE\|DROP\|TRUNCATE\|ALTER\|CREATE\|GRANT\|REVOKE\|SLEEP\|BENCHMARK\|LOAD_FILE\|OUTFILE)\b/i`. `grep -rni "pg_read_file\|pg_ls_dir\|lo_import"` sobre `src/` → **0 coincidencias** |
| 4 | El rol se crea `NOLOGIN`, pero **el entorno lo promueve a `LOGIN` con password** | `.github/workflows/ci.yml:195-207` — comentario: *"The local init-readonly.sql creates it NOLOGIN; we need LOGIN for DATABASE_READONLY_URL"*, seguido de `ALTER ROLE dashbi_readonly WITH LOGIN PASSWORD 'changeme'` |
| 5 | Ese rol es exactamente el que ejecuta las queries de IA | `DATABASE_READONLY_URL=postgresql://dashbi_readonly:changeme@localhost:5432/dashbi` (`ci.yml:57`, `:69`, `:85`) |

**Exploit:** un usuario que controle el prompt de NLQA pide leer un archivo. El modelo genera
`SELECT pg_read_file('/etc/passwd')`. `validateQuery` no lo bloquea (no hay palabra prohibida).
La query se ejecuta contra el rol que tiene `EXECUTE` sobre `pg_read_file`. El resultado vuelve
en la respuesta del chat.

**Matiz honesto sobre la explotabilidad — leer antes de_triar la severidad:**

- El init script de **`app/`** (NOLOGIN + `pg_read_file`) es el que monta `app/docker-compose.yml:22`.
  El de la **raíz** (`docker-compose.yml:116`, `WITH LOGIN PASSWORD 'dashbi_readonly_password'`)
  **no** otorga `pg_read_file`. Hay dos scripts con el mismo nombre y comportamientos
  incompatibles — este es el mismo problema que reporta `CODIGO-AUDIT.md` HIGH-6, confirmado.
- El rol es `NOLOGIN` por defecto, así que en un despliegue que use solo el init script, la
  conexión directa falla. **Pero** cualquier despliegue que necesite `DATABASE_READONLY_URL`
  tiene que promoverlo a `LOGIN` — exactamente como hace CI. El GRANT ya está hecho y nadie
  lo revoca.
- Es decir: **es un landmine latente, no un exploit trivial.** Se activa solo. Por eso lo
  reporto como 🔴 por severidad pero con la cadena completa explícita, para que decidas.

**Fix (2 cambios, ambos de una línea):**
1. Borrar la línea 21 de `app/scripts/postgres/init-readonly.sql`. El comentario de la línea 20
   sugiere que la intención era permitir `EXPLAIN`, que no necesita ningún GRANT.
2. Agregar `pg_read_file|pg_ls_dir|pg_read_binary_file|lo_import|lo_export|pg_sleep` al regex de
   `validate-query.ts:49` y `:109` (los dos sitios tienen la misma lista incompleta).

---

## P2-2 — La regla `no-raw-db-queries` no cumple lo que su nombre y AGENTS.md prometen 🟠

`AGENTS.md` dice: *"Use Drizzle query builder, never raw SQL (**ESLint rule blocks it**)"*.
Verifiqué qué bloquea realmente `.eslint-rules/no-raw-db-queries.cjs`:

**Lo que detecta** (`:40-49`): solo llamadas de la forma `db.select()`, `db.update()`,
`db.insert()`, `db.delete()` — donde `callee.object.name === 'db'` literalmente.

**Lo que NO detecta:**

| Patrón | ¿Cubierto? | Presente en el código |
|---|---|---|
| `db.execute(sql\`...\`)` | ❌ `execute` no está en `dbMethodNames` | 28 ocurrencias de `.execute(` en `src/` |
| `tx.execute(sql\`...\`)` | ❌ | `lib/auth/config.ts:49-58` (4 `sql\``) |
| `db.query.*` (API relacional) | ❌ | 2 ocurrencias |
| `const s = db.select; s()` (aliasing) | ❌ | — |
| **Cualquier cosa fuera de `app/api/` y `worker/`** | ❌ la regla retorna temprano (`:71`) | `src/db/`, `src/lib/`, `scripts/` quedan **sin cubrir** |

**Prueba empírica de que el agujero es real, no teórico:** `src/app/api/health/route.ts:22`
tiene `await db.execute(sql\`SELECT 1 as ok\`)` — una query cruda a la DB, en una ruta de la API
(terreno donde la regla SÍ aplica), y **`pnpm lint:strict` pasa con exit 0**. Si alguien escribiera
`db.execute(sql\`SELECT * FROM orgs\`)`, la regla no lo tocaría.

**19 tagged templates `sql\`` en `src/`**, concentrados en `db/client.ts` (7),
`lib/auth/config.ts` (4), `llm-usage/stats/route.ts` (3), y uno en cada uno de
`sharing/get-public-dashboard.ts`, `auth/request.ts`, `alerts/dispatcher.ts`, `ai/quota.ts`, `health`.

**Matiz honesto:** no todos deberían bloquearse. Los de `llm-usage/stats/route.ts` son
expresiones escalares legítimas (`COUNT(*)`, `SUM(...)`) dentro de un `.select().from().where()`
correcto sobre `tx` — eso es Drizzle idiomático, no SQL crudo. El problema es que la regla
**distingue por forma sintáctica, no por semántica**, y su forma de detectar no cubre ni
siquiera el caso inequívocamente peligroso.

---

## P2-3 — CI corre un gate más débil del que AGENTS.md exige 🟠

| Gate que AGENTS.md exige | ¿En CI? | Evidencia |
|---|---|---|
| `lint:strict` (`--max-warnings 0`) | **NO** | `.github/workflows/ci.yml:51` corre `pnpm lint --max-warnings 100` |
| `pnpm audit` | **NO** | 0 coincidencias de `pnpm audit` en el workflow activo |
| `typecheck` | sí | `ci.yml:63` |
| `test` | sí (endurecido con `RLS_TESTS_REQUIRED`) | `ci.yml:75`, `:81` |
| `build` | sí | `ci.yml:108` |
| `test:e2e` | sí, bloqueante | `ci.yml:223` |

El TODO de `ci.yml:43-49` justifica los 100 warnings con *"59 warnings pre-existentes"* y
apunta a `https://github.com/berriosb/dash-bi/issues/<TBD>` — **ese issue nunca se creó**, y
la justificación caducó: **`pnpm lint:strict` hoy pasa limpio con 0 warnings** (lo verifiqué
en la Fase 1). El gate se puede endurecer a `--max-warnings 0` hoy mismo.

### Hay dos `ci.yml`, y el muerto tiene cosas que el activo no

`app/` no es un repo git propio — el repo es la raíz. GitHub Actions solo lee
`.github/workflows/` de la raíz. Por lo tanto **`app/.github/workflows/ci.yml` está muerto**:
un solo commit en toda su historia (`51d0b50`, "chore: initial commit (pre-Sprint 1 baseline)"),
nunca tocado desde julio.

**Lo que se perdió y nadie notó:** el workflow muerto tiene un job `audit` con OSV-Scanner
(`app/.github/workflows/ci.yml:202-226`) que **no existe en el workflow activo**. Es decir,
la auditoría de dependencias que `AGENTS.md` lista en "Common commands" **nunca corrió en CI**.

### 7 archivos de configuración no pasan lint

`eslint.config.mjs:28` lista `'*.config.{js,mjs,ts}'` dentro del objeto que **solo tiene la
clave `ignores`** (`:17-31`) → es un *global ignore*. Quedan sin lint:
`drizzle.config.ts`, `next.config.ts`, `playwright.config.ts`, `vitest.config.ts`,
`sentry.client.config.ts`, `sentry.server.config.ts`, `postcss.config.mjs`.

Verificado empíricamente: `pnpm exec eslint drizzle.config.ts` → *"File ignored because of a
matching ignore pattern"*.

**Bonus — bloque de reglas muerto:** `eslint.config.mjs:91` incluye `'*.config.{js,mjs,ts}'` en
el `files` de un bloque de *rules* (`:90-98`). Como el ignore de `:28` es global y tiene
precedencia, **ese bloque nunca aplica**. Código de configuración que no hace nada.

**Honestidad:** verifiqué los 7 archivos y **cero** usan `any`, `@ts-ignore`, `sql.unsafe` ni
`sql\``. El impacto real hoy es nulo; el riesgo es que la puerta queda abierta sin que nadie lo note.

---

## P2-4 — `setup-rls.ts` y `src/db/rls.ts` degradan la seguridad si se ejecutan 🟠

Hay **cuatro** definiciones de RLS en el repo, no tres: migraciones `.sql`,
`scripts/setup-rls.ts`, `src/db/rls.ts`, y el threat-model. El commit `aa4f01a` alineó las
migraciones entre sí, pero los otros dos quedaron atrás.

**Divergencia 1 — regresión de null-safety.** Las 8 policies org-scoped de `setup-rls.ts`
(`:53, :60, :66, :72, :78, :84, :90, :96, :102`) usan
`current_setting('app.current_org_id', true)::uuid`. Las migraciones finales usan el helper
null-safe `app_current_org_id()` (`0004_rls_null_safe.sql:40-46`).
**Correr `pnpm db:setup-rls` sobrescribe las policies endurecidas y reintroduce exactamente el
bug que `0004` dice corregir** (`invalid input syntax for type uuid: ""` para callers anónimos,
o sea share links públicos).

**Divergencia 2 — `org_members_isolation` es MÁS PERMISIVA en `setup-rls.ts`.** `:52-54` añade
`OR org_id = current_setting('app.current_org_id', true)::uuid`; la migración final
(`0004:34-37`) es **solo** `user_id = ...`. El script expondría las membresías de *todos* los
usuarios de la org, no solo las propias. Eso es ampliación de privilegios, no endurecimiento.

**Divergencia 3 — `src/db/rls.ts` (123 líneas) es la peor de las tres.** Usa `sql.raw()`
(`:31`, escape hatch que la regla custom no ve) y sus policies viejas usan
`current_setting(...)::uuid` **sin el flag `true` de missing-ok** (`:48, :60, :64, :68, :72, :76, :80, :85-86, :92`).
Correr `createRLSPolicies()` degradaría más que `setup-rls.ts`.

**Conclusión: correr cualquiera de los dos scripts es un downgrade de seguridad.** Esto ya estaba
señalado en `CODIGO-AUDIT.md` HIGH-6 y **sigue sin resolverse**. La causa de fondo es que la
migración nunca se convirtió en la única fuente de verdad.

**Gap preexistente confirmado:** `orgs` recibe la policy `orgs_isolation` (`0001:40`, `0004:22`)
pero **ninguna migración ejecuta `ALTER TABLE "orgs" ENABLE ROW LEVEL SECURITY`**. Una policy sin
RLS habilitado es inerte. Coherente en las tres definiciones → gap compartido, no divergencia.
`scheduled_reports` y `scheduled_report_runs` (`0009:3, :25`) no tienen RLS ni policy.

---

## 3. Escapes de reglas 🟢

**Este es el resultado más positivo de la segunda pasada, y contradice una idea razonable
sobre este tipo de proyecto.**

| Escape | `src/` | `tests/` | `scripts/` |
|---|---|---|---|
| `eslint-disable` | **0** | **0** | **0** |
| `: any` / `as any` | **0** | 13 | — |
| `@ts-ignore` | **0** | **0** | **0** |
| `@ts-nocheck` | **0** | **0** | **0** |
| `@ts-expect-error` | 0 | 3 (los 3 con comentario explicativo) | 0 |

**Cero `eslint-disable` en todo el repositorio.** Cero `any` en producción (forzado por
`lint:strict` = `--max-warnings 0` + `@typescript-eslint/no-explicit-any: warn`).

Los 3 `@ts-expect-error` están justificados: `tests/unit/query-engine/dashboard-role.test.ts:283,296`
verifica que omitir el `role` **no compile** (el fix de CRITICAL-3 hizo `role` requerido, y el
test pinea esa invariante). Eso es TDD correcto, no un escape.

**Los 6 "TODO/FIXME" que reporto como 0** — los matches son `placeholder="https://hooks.slack.com/.../xxx"`
y `Bearer xxx` en textos de ejemplo, no TODOs reales.

**Único escape real:** los 13 `any` en `tests/`, porque `eslint.config.mjs:94` desactiva
`no-explicit-any` para `tests/**`. Es una decisión defendible (los mocks de drizzle lo
justifican) pero implica que un `any` accidental en un test no se ve.

---

## 4. Corrección de la pasada 1 ⚠️

**La pasada 1 clasificó `lib/auth/config.ts` (272 líneas) como "un objeto de configuración de
better-auth, no es problema". Estaba mal, y el error era mío.**

La clasificación venía marcada `[INFERIDO]` en un explorador y **la repetí como si estuviera
verificada**, que es exactamente el fallo que el propio informe advertía en su §9 sobre no
convertir `[INFERIDO]` en hecho.

Recuento real de flujo de control: **23 bloques**, no 0. El archivo contiene:

- `slugify` (`:10-20`) — normalización
- `uniqueSlug` (`:22-32`) — loop con queries hasta 50 intentos
- **`provisionOrgForUser` (`:34-~100`)** — una transacción completa de provisioning multi-tenant:
  setea GUCs de RLS con `sql` crudo, inserta la `orgs`, inserta el `org_members` con rol admin,
  y escribe el audit log

Eso es lógica de negocio con SRP propia, no configuración. **Debe partirse:**
`lib/auth/provisioning.ts` (slug + provisioning) y `lib/auth/config.ts` (solo wiring de better-auth).
Agregado a la Fase 3 del plan de la pasada 1.

**Las otras clasificaciones se re-verificaron y siguen correctas:** `catalog.ts` 0 bloques,
`archetypes.ts` 1, `atomic-patterns.ts` 0, `errors/types.ts` 0, `db/schema.ts` datos.

`lib/alerts/evaluator.ts` (259) tiene 31 bloques — lo bajé a "límite pero cohesivo": 1 export
público (`runAlertEvaluator:51-178`) con pipeline lineal de pasos numerados + 5 helpers privados.
La lógica es real pero cohesiva; no es el mismo caso que `auth/config.ts`.

---

## 4b. La suite de tests: 1012 tests que se leen mejor que la cobertura que producen

| Categoría | Archivos | Casos | LOC |
|---|---:|---:|---:|
| `tests/unit/` | 112 | 830 | 13.403 |
| `tests/security/` | 6 | 105 | 784 |
| `tests/integration/` | 1 (+1 helper) | 2 | 401 |
| `tests/e2e/` | 9 `.spec.ts` | 40 | 613 |
| **Total** | **119 (+9 e2e)** | **1012 passed + 3 skipped** | **15.441** |

**Cero `it.skip` abandonados.** Los 3 skipped son los tests de RLS
(`tests/integration/rls-isolation.test.ts:102-110`), que llaman `ctx.skip()` sin runtime de
contenedor. El motivo está documentado en el propio header (`:15-25`) y **CI lo endurece** con
`RLS_TESTS_REQUIRED=1` (`.github/workflows/ci.yml:81`, `:98`) para que la falta de runtime sea
error duro, no skip. Eso es disciplina, no teatro.

### El gap estructural: `tests/security/` no toca ninguna ruta HTTP 🟠

**Verificado: `grep -rn "@/app/api" tests/security/ tests/unit/security/` → 0 resultados.**

Los 6 archivos de `tests/security/` (105 casos) importan funciones sueltas:
`validateQuery`, `assertRolePermissions`, `validateOutboundUrl`, `validatePostgresHost`,
`encryptApiKey`. **Ninguno comprueba que esas funciones estén en el camino de ejecución.**

La consecuencia es concreta: `src/app/api/nlqa/ask/route.ts` está entre los 11 handlers sin
ningún test, y los 105 tests de seguridad no llegan a él. **Si alguien comenta la llamada a
`validateQuery` en ese handler, los 105 tests siguen verdes.**

Los tests que sí atacan handlers reales existen y están bien hechos — están en `tests/unit/api/`,
no en `tests/security/`. El mejor patrón del repo es
`tests/unit/api/alert-rules.test.ts:3-10`: importa `GET`/`POST` del handler y usa un stand-in de
drizzle que **filtra por el WHERE emitido**, de modo que si falta un `org_id` el test falla con
un leak real. Ese patrón debería ser la norma de `tests/security/`, no la excepción.

### 35 tests no fallarían aunque la función estuviera vacía 🟡

**35 tests tienen exactamente un `expect()` y es `.not.toThrow()`. 31 están en seguridad.**
`.not.toThrow()` solo verifica ausencia de excepción: una función que hace `return undefined`
en la primera línea los pasa todos.

**Matiz a favor del proyecto:** parte de eso es correcto por diseño.
`assertRolePermissions` (`validate-query.ts:222`) tiene un early-return
`if (role !== 'viewer') return;` — es *correcto* que admin/editor no lanzen, y los 4 tests de
`pii-filter.test.ts:63-79` documentan ese contrato intencionalmente.

El riesgo real son los de `sql-injection.test.ts:11,20,29` (`'accepts SELECT queries'`, etc.)
y los de `validate-query-spreadsheet.test.ts`: sobre una función de ~260 líneas de parsing SQL,
"acepta SELECT" no distingue una validación completa de un `return` vacío.

### 87 asserts de componente que no pueden fallar 🟡

`expect(screen.getByText('Ventas por Región')).toBeDefined()` — **`getByText` ya lanza si no
encuentra el elemento**, así que el `.toBeDefined()` nunca se ejecuta cuando importa.
`tests/unit/components/TableWidget.test.tsx:35-42` tiene **12 asserts de este tipo** (12 weak
sobre 12 render), y `WidgetSkeleton.test.tsx` 9 de 9. Son decorativos.

### Distribución real de los 1012 tests

| Subject | casos | % |
|---|---:|---:|
| Funciones puras de `src/lib` | 652 | 69% |
| Stores / componentes / otros | 167 | 18% |
| Route handlers (`@/app/api`) | 118 | 12% |
| Postgres real | 2 | 0.2% |
| E2E browser (fuera de `pnpm test`) | 40 | 4% |

Y el denominador de cobertura es solo `src/lib` + `src/db` = **11.046 líneas (40% del código)**.
`vitest.config.ts:20-23` lo admite literalmente y pone el número real medido junto a cada
threshold, con el comentario de que ensancharlo es trabajo aparte. **Eso es transparencia, no
engaño** — pocos equipos lo documentan así.

**Riesgo concreto, en una frase:** *una regresión de seguridad dentro de `/api/nlqa/ask` — el
endpoint sin cubrir, con la función probada solo como función suelta y sin un solo test de
seguridad que recorra la ruta — es el fallo que esta suite no atrapa, y es el más caro del
producto.*

### 43 exports de `src/lib` no se referencian en ningún lado

Entre ellos, **7 símbolos completos de `src/lib/ai/quota.ts`** (`resolveBudgetUsd`,
`isOverBudget`, `assertWithinLLMBudget`, `getOrgMonthSpendUsd`, `monthStart`,
`PLAN_LLM_BUDGET_USD`, `LLMBudgetExceededError`) existen solo para que los tests puedan
afirmar sobre ellos, y los tests que lo hacen son precisamente los débiles
(`quota.test.ts:81` = un solo `.not.toThrow()`). **Sobre-testing de API que no está en producción.**

También son test-only: `MockEmailProvider` y `_resetEmailProvider` (`lib/email/index.ts`),
`resetRateLimit`/`resetAllRateLimits` (`lib/rate-limit.ts`), `evaluateLLMQuota`
(`lib/observability/llm-quota.ts`).

**⚠️ Segunda corrección a la pasada 1:** el informe de `ARQUITECTURA-AUDIT.md` (§B4) afirmó que
`validateArchetype` y enums de `validator.ts` "solo se usan desde tests, señal de API
sobredimensionada". **`validateArchetype` NO es código muerto**: se llama en producción desde
`validateDashboardWithArchetype` en `validator.ts:309` `[VERIFICADO]`. Sí es cierto para
`isValidArchetypeForWidgetCount` (`:319`), `archetypeConstraintsSummary` (`:328`, ni
siquiera referenciado en tests) y los enums `ArchetypeEnum`/`DensityEnum`/`ThemeAccentEnum`/
`TimeWindowEnum`/`ComparativoEnum`/`WidgetTypeEnum` (`:203-244`), que no se referencian en
`src/` ni en `tests/`.

### E2E: lo mejor de la suite 🟢

**9 archivos, 40 casos, cero `test.fixme`, cero marcadores flaky.** Solo 2 `test.skip`, ambos
condicionales por viewport móvil con motivo escrito.

El helper de auth **no mockea nada** (`tests/e2e/helpers/auth.ts:26-42`): hace signup HTTP real
contra la app viva, marca el email verificado contra la DB real (porque `MockEmailProvider` no
entrega correo), y `signInViaUI` navega la UI real usando los labels en español
(`Correo Electrónico`, `Contraseña`, `Iniciar Sesión`). Usa `pressSequentially` en vez de
`fill` por un race documentado en WebKit (`:51-54`).

Config anti-flake seria: `retries: 2` en CI, `workers: 1`, `trace: 'on-first-retry'`, 3
proyectos (chromium/firefox/mobile-safari), y un script dedicado
`test:e2e:flake-check` (`--repeat-each=3 --grep @critical`).

### Duplicación en tests: 8.29%, mal distribuida

`jscpd` sobre `tests/`: 1.299 líneas duplicadas de 15.666 (8.29%). El número es bajo y no es un
blocker. El problema es que **falta el helper compartido**: no existen `tests/helpers/`,
`tests/fixtures/` ni `tests/mocks/`, y **23 archivos construyen su propio `new Request(...)`**
con su propio mock de drizzle. El alias `@tests` está declarado en `vitest.config.ts:63` y
**nunca se usa** — intención de helper abandonado.

Los pares más caros son auto-duplicación dentro del mismo archivo: 77 líneas en
`organizations-members.test.ts` consigo mismo, 65 en `widgets/validator.test.ts`, 64 en
`files-commit.test.ts`.

---

## 5. Lo que está bien (y no debe tocarse)

- **Las 13 migraciones** están ordenadas, sin números duplicados ni huecos, **sin DDL destructivo**
  (0 coincidencias de `DROP TABLE`/`DROP COLUMN`/`TRUNCATE`/`RENAME`), e idempotentes
  (`IF NOT EXISTS` en `0006`, `0007`, `0009`, `0011`). El orden de dependencias es correcto:
  `app_current_org_id()` se define en `0004:40` y se consume primero en `0007:32`.
- **`app/vendor/xlsx-0.20.3.tgz` es una decisión correcta.** Referenciado como
  `"xlsx": "file:vendor/xlsx-0.20.3.tgz"` (`package.json:95`) y **pineado por sha512 en el
  lockfile** (`pnpm-lock.yaml:6368`). Calculé el sha512 del tarball en disco y **coincide
  byte por byte**, así que `pnpm install --frozen-lockfile` falla si alguien lo sustituye.
  El vendorizado existe porque SheetHub ya no publica `xlsx` en npm. 2.4 MB por un control de
  versión sin dependencia del registry: correcto.
- **`.gitignore` es exhaustivo.** `coverage/`, `test-results/`, `playwright-report/`, `.next/`,
  `.env*` — todo cubierto, en raíz y en `app/`.
- **`middleware.ts` (98 líneas) tiene test de su invariante de seguridad**
  (`tests/unit/middleware/public-paths.test.ts`) y exporta `__testing` explícitamente para eso.
  El `matcher` excluye `_next/static`, `_next/image` y favicon. La allowlist de paths públicos
  maneja bien el trailing-slash.
- **`instrumentation.ts` (5 líneas)** es un guard de runtime, correcto y sin lógica testeable.
- **CI hace bien varias cosas**: coverage gate real (activó thresholds que nunca se aplicaron),
  falla en vez de skipear si la suite RLS no corre, instala los 3 browsers de Playwright,
  sube artifacts con `if: always()`.
- **El job e2e es bloqueante** (contrario a un comentario stale en `ci.yml:124-125` que dice
  "non-blocking" en la línea siguiente de la que dice "now a blocking gate").
- **Las reglas ESLint están bien elegidas** y bien calibradas: jsx-a11y, react-hooks con
  `exhaustive-deps` en warn, la regla custom de DB, `consistent-type-imports`.
  Cero `eslint-disable` en el repo es el reflejo de que funcionan.

---

## 6. Higiene menor

| # | Hallazgo | Detalle |
|---|---|---|
| 1 | `AGENTS.md` está **gitignored** | `.gitignore` raíz lo lista explícitamente. Es el archivo que se inyecta en el contexto de cada agente y **no está en control de versiones** — no se puede revisar en un PR, ni diffear, ni rollbackear. Decisión documentada ("el repo guarda la aplicación, no el setup del dev") pero con consecuencias |
| 2 | `app/worker/` es un directorio **vacío** y está en los `ignores` de ESLint | El patrón `'worker/**'` ignora `app/worker/`, **no** `app/src/worker/` (que sí se lintea, correctamente). Si alguien pone código en `app/worker/`, escapa de lint silenciosamente |
| 3 | `scripts/seed.ts` son 270 líneas, ~86 de ellas fixtures | `DEMO_WIDGETS` en `seed.ts:40-125`. La lógica real (`seedDatabase:127-255`) son ~128 líneas. Extraer los fixtures lo deja en ~180 sin tocar lógica |
| 4 | `_journal.json` con timestamps sintéticos | Las 9 primeras migraciones tienen `when` en múltiplos exactos de 86400000; las 4 últimas usan wall-clock real. Firmas de escritura a mano |
| 5 | `meta/` solo tiene `0000`, `0009`, `0010`, `0011` | Faltan `0001-0008` y `0012`. No obvio cuál es la base del próximo `db:generate` |
| 6 | `drizzle.config.ts` ejecuta `getEnv()` a nivel de módulo (`:4`) | `drizzle-kit generate` no lee `dbCredentials`, así que Obliga a tener todas las vars de `src/lib/env.ts` (incl. `DATABASE_READONLY_URL`) solo para generar SQL |
| 7 | `middleware.ts:34` acepta como autenticado cualquier cookie cuyo nombre **contenga** `session` | Un cookie arbitrario llamado `xsession` pasa el gate. El propio `:78-81` reconoce que la presencia del cookie no es validación criptográfica — limitación conocida, pero el fallback es más ancho de lo que el comentario justifica |
| 8 | 11 de 34 rutas API siguen sin el contrato de error canónico | Después de la Fase 1. 2 son exenciones legítimas (`auth/[...all]` es el catch-all de better-auth; `health` no lleva auth por diseño). Las otras 9 son deuda real: `scheduled-reports` (5 sitios con 400 hardcodeado que pierden `code` y `correlationId`), `templates/route.ts` (enmascara todo como 401), etc. |
| 9 | `UnauthorizedError`/`ForbiddenError`/`BadRequestError`/`AuthContext` están **duplicados** | Definidos a la vez en `src/lib/auth/errors.ts` y `src/lib/auth/context.ts`. Dos clases distintas con el mismo nombre; `instanceof` entre ellas falla silenciosamente. Lo descubrí de rebote cuando un test de `withAuth` falló de forma inexplicable durante la Fase 1 |

---

## 7. Orden de ejecución sugerido

Lo accionable de esta pasada, por severidad real:

1. **P2-1** — borrar `app/scripts/postgres/init-readonly.sql:21` y agregar las funciones de
   lectura de archivos al blocklist de `validate-query.ts:49` y `:109`. Dos líneas, cierra una
   cadena completa.
2. **P2-2** — extender `no-raw-db-queries.cjs` para cubrir `db.execute()`, `db.query.*` y
   aliasing, y decidir si extiende su alcance más allá de `app/api/`. Alternativa honesta:
   ajustar la frase de `AGENTS.md` para que describa lo que la regla realmente hace.
3. **P2-3** — `--max-warnings 100` → `--max-warnings 0` (pasa hoy), borrar el `<TBD>`, y
   eliminar el `ci.yml` muerto de `app/` (o copiar su job `audit` al activo).
4. **P2-4** — borrar `src/db/rls.ts` y reducir `setup-rls.ts` a un assert de verificación, dejando
   las migraciones como única fuente de verdad. Habilitar RLS en `orgs` y en las
   `scheduled_reports*`.
5. **§4** — partir `lib/auth/config.ts`.
6. **§4b** — agregar **un** test de route handler para `/api/nlqa/ask` que verifique que
   `validateQuery` **es invocado** y que una query inyectada devuelve 400. Es la acción de
   mayor valor por línea de esfuerzo de toda la auditoría: convierte 105 tests de seguridad que
   prueban una función suelta en cobertura del camino real, y usa el patrón que ya existe y
   está bien hecho en `tests/unit/api/alert-rules.test.ts`.
7. **§6** — higiene: directorios vacíos, `meta/` desalineado, el bloque de rules muerto de ESLint,
   y los ~87 asserts `getByText(...).toBeDefined()` que no pueden fallar.

**Lo que NO recomiendo tocar:** las 13 migraciones (salvo el ENABLE faltante de `orgs`), el
tarball vendorizado, el `.gitignore`, `middleware.ts` más allá del punto 7, y toda la
calibración de ESLint.

---

## 8. Límites de esta segunda pasada

- **No corrí los gates** durante esta auditoría; es análisis estático de configuración y
  verificación por lectura. `pnpm lint:strict` sí estaba limpio al momento de verificar
  P2-2, porque lo corrí en la Fase 1 inmediatamente antes.
- **No verifiqué en runtime** la explotabilidad real de P2-1: no hay Postgres corriendo, así que
  no pude confirmar qué init script aplica en el despliegue real ni si el rol queda `LOGIN` ahí.
  La cadena está verificada **código a código**; el último eslabón (qué hace el despliegue) es
  el que queda abierto y **debe confirmarse contra el entorno real primero**.
- **No audité los route handlers que consumen `x-org-id`**, así que el impacto real del punto 7
  de §6 (inyección de org) queda abierto.
- **La calidad de la suite de tests no entró en este informe**: el barrido de `tests/**` se
  lanzó pero no terminó a tiempo. Es el hueco conocido más grande que queda.
- **No re-audité el interior de los 34 route handlers** más allá de lo que la Fase 1 ya cubrió.
