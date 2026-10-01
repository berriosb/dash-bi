# Auditoría de arquitectura y tamaño de código — dash-bi

**Fecha:** 2026-09-30
**Alcance:** 208 archivos TS/TSX de producción en `app/src/` (27.410 líneas totales, **23.213 de código** tras excluir blancos y comentarios), 34 route handlers, 9 conectores, `db/`, `hooks/`, `stores/`, `worker/`, `eslint.config.mjs`, `package.json`.
**Snapshot:** `HEAD` = `e149975`, con el diff sin commitear del working tree. Durante la auditoría se aplicaron los fixes de CRITICAL-2/CRITICAL-3/HIGH-2 de `CODIGO-AUDIT.md` (5 archivos de `src/` modificados, 2 tests nuevos). **Se re-verificó que la distribución por tramos no cambia** (112/38/20/18/13/7) y que los conteos de `errorResponse` (23) y archivos >200 (38) siguen idénticos, así que las conclusiones son válidas para el estado actual.
**Complementa** a `CODIGO-AUDIT.md` (seguridad y calidad), que no cubría estos dos ejes, y a `docs/audits/2026-07-21-arquitectura/` (decisiones de stack y producto, no de código).
**Pregunta que responde:** *¿sigue el proyecto el estándar de 150-200 líneas por archivo, y está la arquitectura en buen estado?*

**Método:** medición mecánica de LOC y complejidad efectiva (script propio sobre el árbol de imports y conteo de código), grafo de dependencias con detección de ciclos, y tres exploradores en paralelo (conectores / route handlers / `lib`+hooks). **Cada afirmación marcada `[VERIFICADO]` fue re-verificada por mí leyendo el código o ejecutando el comando**; las marcadas `[INFERIDO]` son juicio arquitectónico.

### Gates verificados al cerrar esta auditoría

| Gate | Comando | Resultado |
|---|---|---|
| Typecheck | `pnpm typecheck` | ✅ exit 0 |
| Lint | `pnpm lint:strict` | ✅ exit 0, 0 warnings |
| Unit | `pnpm test` | ✅ 117 archivos, 988 tests, 3 skipped |

Los 988 tests (vs 942 en `CODIGO-AUDIT.md`) confirman que los fixes de CRITICAL-2/CRITICAL-3/HIGH-2 aplicados en paralelo a esta auditoría no rompieron nada.

---

## Veredicto en una página

**La arquitectura de módulos está mejor que el estándar de tamaño sugiere, y ese es el hallazgo más importante — y más tranquilizador.**

Tres cosas que probablemente no esperabas oír:

1. **El grafo de dependencias está limpio.** Cero ciclos de importación reales, cero violaciones de capa (`lib → components` no existe, `components → db` no existe, `db → lib` es 1 import de tipo + el logger). La dirección de dependencias es coherente y mantenible.
2. **~40% de los archivos "grandes" están perfectamente bien.** `templates/catalog.ts` (374), `widgets/archetypes.ts` (534), `widgets/atomic-patterns.ts` (235), `db/schema.ts` (663) y `widgets/types.ts` (172) son **datos declarativos con cero o casi cero flujo de control** `[VERIFICADO: catalog.ts y atomic-patterns.ts tienen 0 bloques `if/for/while/switch/try`]`. Partirlos en archivos de 100 líneas sería *peor*: más archivos, sin menos complejidad. El umbral de líneas no aplica a datos.
3. **El problema real está en la UI, no en el dominio.** `src/lib/` está sorprendentemente bien factorizado (86 archivos, 21 módulos, granularidad sensata, ningún "basural"). El dolor se concentra en `src/components/` (54 archivos, 8.716 líneas) y en los route handlers.

**El problema de fondo es otro, y es el que hay que arreglar primero:** el estándar de 150-200 líneas **no está codificado en ningún lado**. No hay regla `max-lines` en `eslint.config.mjs`, ni step en CI, ni mención en `AGENTS.md`, `README.md` ni `CONTRIBUTING.md` `[VERIFICADO: grep de "150 líneas|200 líneas|max-lines|SOLID|responsabilidad única|cohesión|acoplamiento" sobre todos esos archivos devuelve 0 resultados relevantes]`. Hoy es una convención que solo existe en tu cabeza, y por eso se ha degradado sin que nadie lo notara. **Un estándar que no tiene dónde romperse no es un estándar.**

### Las tres cifras que resumen el estado

| Métrica | Valor | Lectura |
|---|---|---|
| Archivos >200 líneas de código | **29 / 208 (14%)** | Dentro de lo razonable para un proyecto de esta edad |
| Archivos >200 líneas de código que son **problema real** de SRP | **~11 / 208 (5%)** | El resto es data o configuración legítima |
| Route handlers que no usan el contrato de error canónico | **12 / 34 (35%)** | La deuda más grande y más barata de arreglar |

---

## 1. Distribución de tamaño

208 archivos, 27.410 líneas (23.213 de código).

| Tramo | Archivos | % |
|---|---:|---:|
| 0-100 líneas | 112 | 54% |
| 101-150 | 38 | 18% |
| 151-200 | 20 | 10% |
| **201-300** | **18** | **9%** |
| **301-500** | **13** | **6%** |
| **501+** | **7** | **3%** |

**Veredicto: 72% de los archivos está dentro del umbral de 150.** El problema no es generalizado — es una cola larga y concentrada. Eso es buena noticia: significa que un plan de refactor es acotado, no un proyecto de reescritura.

### Reparto por capa (líneas totales)

| Capa | Archivos | Líneas | Nota |
|---|---:|---:|---|
| `src/lib/` | 86 | 9.976 | **La mejor factorizada** |
| `src/components/` | 54 | 8.716 | **La peor** — 12 archivos >200 |
| `src/app/api/` | 34 | 4.020 | 8 archivos >150 |
| `src/app/(dashboard)/` | 9 | 1.995 | 3 archivos >200 |
| `src/db/` | 3 | 995 | `schema.ts` = 663 (data, sano) |
| `src/app/(auth)/` | 4 | 509 | |
| `src/hooks/` + `src/stores/` | 7 | 573 | **0 archivos >150 — impecable** |
| `src/worker/` | 2 | 248 | |

### Los 10 peores, clasificados honestamente

Aquí está el corazón de la auditoría. **La clasificación importa más que el número.**

| Archivo | tot / código | Clasificación | Motivo |
|---|---|---|---|
| `components/dashboard/ExportShareDialog.tsx` | 727 / 673 | **🔴 SRP** | 4 features (PDF, PNG, links públicas CRUD, embed) en un componente, 17 `useState`, 8 handlers |
| `components/alerts/AlertFormModal.tsx` | 656 / 597 | **🟡 SRP parcial** | El modal (305 líneas) + 3 sub-componentes + validación propia; el archivo es coherente, el modal no |
| `app/(dashboard)/data-sources/page.tsx` | 588 / 551 | **🔴 SRP** | 16 `useState`, 5 formularios de conector distintos en un archivo; viola OCP y SRP |
| `components/demo/DemoDashboardViewer.tsx` | 533 / 513 | **🟡 Sep. data/code** | Líneas 30-303 son `DEMO_PRESETS` (datos) + 304-513 el componente. Los datos deben estar en su propio archivo |
| `lib/widgets/archetypes.ts` | 535 / 508 | **🟢 Sano (data)** | 88% catálogo; 7 accessors one-liner. **No tocar** |
| `db/schema.ts` | 664 / 467 | **🟢 Sano (data)** | 19 `pgTable()` declarativos |
| `components/settings/MembersManager.tsx` | 475 / 433 | **🔴 SRP** | Lista + modal de invitación + cambio de rol + borrado, 12 `useState` |
| `lib/ai/gateway.ts` | 509 / 412 | **🔴 SRP** | 3 dominios distintos (generar dashboards / NLQA / explicar) en una clase sin estado |
| `app/(dashboard)/reports/page.tsx` | 455 / 431 | **🔴 SRP** | Lista + creación + 9 `useState` en un archivo |
| `components/datasources/FileUploadModal.tsx` | 463 / 420 | **🟡 SRP parcial** | Drag&drop + preview + inferencia de columnas + commit; 4 responsabilidades |

**De los 7 archivos >500 líneas, 2 están perfectamente bien.** Ese matiz es el que evita un plan de refactor inútil.

---

## 2. Hallazgos de arquitectura

### A1 — No existe capa de servicio: la lógica de negocio vive dentro de los route handlers 🔴

`ls src/services src/repositories src/server` → **no existen** `[VERIFICADO]`. El árbol real es `app/ components/ db/ hooks/ lib/ stores/ types/ worker/`.

Los 6 handlers >200 líneas contienen reglas de negocio que deberían estar en `src/lib` `[VERIFICADO por lectura]`:

- `api/data-sources/route.ts:148-320` — 8 ramas `if (type === ...)` de ~21 líneas cada una (schema + validación + error + asignación). **Debería ser `validateDataSourceConfig(type, config)` en `src/lib/connectors/`.** Los 8 schemas zod están definidos *inline en el handler* (`:16-75`), así que ni `data-sources/[id]/test/route.ts` ni el worker pueden reutilizarlos.
- `api/dashboards/[id]/alerts/route.ts:37-64` — plan gating, quota check y ownership manual inline, cuando `src/lib/alerts/` ya tiene 1.100 líneas.
- `api/organizations/members/[id]/route.ts:69-86` — invariante "no degradar al único admin" con su query dentro del handler.
- `api/nlqa/ask/route.ts:36-314` — orquesta rate-limit → validate → quota → gateway → validateQuery → execute → persistir. 90 de sus 314 líneas son reglas de negocio.

**Lo relevante:** los handlers *sí* son adaptadores delgados en unos 10 casos (`widgets/explain/route.ts` delega 1461 líneas de lógica a `src/lib/widgets/`; `onboarding/complete` son 34 líneas). **El patrón correcto ya existe dentro del propio repo** — no hay que inventarlo, hay que generalizarlo.

### A2 — No existe un HOF de handler: 23 copias de `errorResponse`, 21 byte-idénticas 🔴

`grep -rn "function errorResponse" src/app/api/` → **23 definiciones**. Hasheando el cuerpo: **21 archivos comparten el md5 `513318ba`** (8 líneas cada uno) = **~168 líneas duplicadas**, más 2 variantes menores `[VERIFICADO]`.

```
Idéntico (8L × 21):  audit · dashboards/generate · dashboards/[id]/embed ·
                     dashboards/[id]/export/pdf · dashboards/[id] · dashboards/[id]/share ·
                     data-sources · files/commit · files/[id] · files/route · files/upload ·
                     llm-usage/stats · nlqa/ask · onboarding/{complete,resume,step,track} ·
                     organizations/members · organizations/members/[id] · public-links/[id] ·
                     widgets/explain
Variante A (8L × 1):  organizations/route.ts      — solo comillas dobles
Variante B (9L × 1):  dashboards/route.ts         — añade fallbackStatus = 500
```

Y `grep "export function errorResponse" src/lib/` → **vacío**. La función que debería estar en `src/lib/errors/` está escrita 23 veces a mano. Esto no es Cosmético: es la **integración de `toUserError` + `statusFromCode`**, y por estar duplicada es también la causa directa de A3.

Igual pasa con el esqueleto `try { requireAuth } catch { errorResponse }`: ~10-14 líneas × 34 handlers ≈ **350-490 líneas de repetición** `[INFERIDO, extrapolado de 22 call-sites de errorResponse + 30 con requireAuth verificados]`. Y `lib/middleware/rate-limit.ts:48` es un wrapper de **Express**, no un HOF de route handler de Next — no sirve.

### A3 — Tres contratos de error conviviendo, sin fuente única de verdad 🔴

| Grupo | Handlers | Forma |
|---|---:|---|
| **A** — canónico `AppError` vía `toUserError` | 22 | `{code, message, correlationId, retryable, fieldErrors?}` + header `x-correlation-id` |
| **B** — `{error: '<string>'}` plano | 9 archivos, 11 sitios | Sin `code`, sin `correlationId` |
| **C** — `fieldErrors` divergente | 4 sub-variantes | `.flatten()` vs `.format()` vs `issues[]` |

**38 respuestas `400` en el repo, de las cuales solo 12 llevan `x-correlation-id`** `[VERIFICADO por conteo]`.

Consecuencia práctica: el cliente no puede confiar en la forma de la respuesta, y un `correlationId` ausente rompe la trazabilidad en Sentry justo en los errores de validación, que son los más frecuentes.

### A4 — El circuit breaker vive en memoria de módulo 🟠

`query-engine/execute.ts:12` — `const circuitBreakers = new Map()`. Umbral 3 fallos, cooldown 5 min hardcodeados (`:17`, `:25`).

En un deploy multi-réplica cada proceso tiene su propio breaker, así que **un tenant puede abrir el circuito solo en una réplica** y las otras siguen gastando conexiones. Y en serverless se pierde en cada cold start. El proyecto **ya tiene Redis** (`query-engine/cache.ts:12` lo usa) — la infraestructura correcta está a un import de distancia.

### A5 — El presupuesto LLM se impone por convención, no por arquitectura 🟠

`ai/quota.ts` **nunca es importado por `ai/gateway.ts`** `[VERIFICADO]`. Lo invocan los 3 route handlers que usan `AiGateway`:
```
dashboards/generate:96  ·  nlqa/ask:149  ·  widgets/explain:88
```
**Los 3 la llaman, hoy, correctamente** `[VERIFICADO]`. Pero el control depende de que cada handler LLM futuro recuerde hacerlo — y nada lo obliga. `assertOrgCanSpendLlm` es una precondición que debería ser invariante del gateway, no un recordatorio en cada call site. Una cuarta ruta LLM lo omite y nadie se entera hasta que la factura llega.

### A6 — Los conectores no tienen abstracción base 🟠 (pero la duplicación es menor de lo que parece)

`grep "abstract class|extends " src/lib/connectors/` → **cero resultados** `[VERIFICADO]`. Los 9 son `implements Connector` plano.

Medido con `jscpd` sobre los 18 archivos del módulo: **151 líneas duplicadas = 6.81%**, 1768 tokens `[VERIFICADO por herramienta]`. Los patrones repetidos:
- `testConnection()` — el mismo esqueleto de 6 líneas en los **9** conectores (incluida la línea `const msg = error instanceof Error ? ...`, byte-idéntica en 8 de 9). `postgres.ts:54-63` y `mysql.ts:46-55` son idénticos salvo una línea.
- Guard de constructor (parse + validación de config) — **14 líneas idénticas** en `ga4.ts`, `hubspot.ts` y `snowflake.ts` (el clon más grande).
- Wrapper SSRF — 4 archivos.
- `private get headers()` — 3 archivos.

**Matiz honesto:** el *cuerpo* de cada método sí es understandably distinto (el mapeo de filas de Stripe no se parece al de Shopify, y está bien que sea así). Lo que se repite es el **andamiaje que la propia interface fuerza a repetir 9 veces**, no la lógica de negocio. Por eso 6.81% suena a poco y aun así importa: es el modo de fallo exacto que produce A7.

**La interface en sí es buena y está bien cumplida** — 3 métodos (`testConnection`, `getSchema`, `executeQuery`), 9/9 los implementan, sin LSP ni ISP que violar. No la toques.

### A7 — Consecuencia de A6: 5 de 9 conectores no pueden cancelarse 🟠

`grep -rn "AbortSignal|signal:|AbortController|setTimeout" implementations/` → **ninguna coincidencia** `[VERIFICADO]`. Los 5 SaaS llaman `fetch` sin `signal`.

Esto es exactamente la clase de fallo que un wrapper común previene: **añadir cancelación a los 5 son 5 ediciones, y el olvido de una es silencioso** (nada falla; la query simplemente no se cancela). El `AGENTS.md` §4 declara timeouts como frontera de seguridad y aquí no hay ninguno a nivel de query.

Bug de contrato relacionado `[VERIFICADO]`: solo **3 de 9** emiten el campo `truncated` (`postgres.ts`, `sheets.ts`, `spreadsheet.ts`). Los 5 SaaS lo omiten pese a truncar en el servidor (Shopify `limit=250`, HubSpot `limit=100`, GA4 `limit=10000`) → la UI **no avisa al usuario de que perdió datos**.

Y un detalle de DRY con consecuencias de correctitud `[VERIFICADO]`: en `hubspot.ts` la lista de columnas de `contacts` está escrita **dos veces** — `hubspot.ts:88-95` (schema, con sus tipos) y `hubspot.ts:183` (`propertiesFor`, solo nombres). Los nombres coinciden exactamente (`email`, `firstname`, `lastname`, `phone`, `company`, `lifecyclestage`, `createdate`, `lastmodifieddate`). Agregar una columna obliga a editar ambos, o el schema miente frente a la API. Mismo patrón en `companies` (`hubspot.ts:102-110` vs `:185`) y `deals` (`hubspot.ts:118-124` vs `:187`).

### A8 — `close()` existe pero es inalcanzable desde el registry 🟡

`postgres.ts:124-126` define un método público `close()` que hace `await this.client.end()`. La interface `Connector` (`connectors/types.ts:67-71`) declara una propiedad (`type`) y **3 métodos** (`testConnection`, `getSchema`, `executeQuery`) — **`close()` no está** — y el registry tipa el registro como `new (config) => Connector` (`registry.ts:18-29`) `[VERIFICADO]`. Como el tipo declarado es `Connector`, **ningún consumidor puede llamar a `close()`**.

`grep -rn "\.close()" src/` devuelve solo dos sitios: `worker/index.ts:150` (workers de BullMQ) y `worker/render-pdf.ts:63` (browser de Puppeteer). **Ninguno cierra conectores** `[VERIFICADO]`.

Consecuencia: cada `resolveConnector` (`query-engine/resolve.ts:52` → `createConnector`) de un data source Postgres abre un `postgres({ max: 5, idle_timeout: 20 })` nuevo (`postgres.ts:40-51`) que nunca se cierra explícitamente. `idle_timeout: 20` limita las conexiones ociosas, pero no los pools: con consultas frecuentes el pool queda abierto y se acumulan. Y como `hydrateDashboard` corre `Promise.allSettled` sobre `widgets.map(...)` (`query-engine/dashboard.ts:68-70`), **`hydrateWidgetFromQuery` resuelve un connector por widget** → **un dashboard con 12 widgets Postgres abre 12 pools** en lugar de reutilizar uno.

Es un bug de contrato de la interface, no de tamaño de archivo — y la solución no es "agrandar la interface" (eso rompería LSP para los 8 conectores sin pool), sino cachear la instancia por `dataSourceId` en `registry.ts` más un `dispose?(): Promise<void>` opcional en `Connector` para el shutdown del proceso.

---

## 3. Hallazgos de tamaño por archivo (los que sí importan)

### B1 — `ExportShareDialog.tsx`: 4 features en un componente 🔴

727 líneas / 673 de código, 17 `useState`, 8 handlers, 4 pestañas `[VERIFICADO: líneas 336-502 confirman 4 bloques condicionales por pestaña]`.

Cada pestaña es una feature independiente con su propio estado, sus propios handlers y su propio ciclo async:
- **PDF** — `:98-124` (progress state, polling)
- **PNG** — `:125-172` (48 líneas: `html2canvas`, es una operación de browser distinta)
- **Share** — `:173-217` (crear + revocar links: CRUD)
- **Embed** — `:218+` (generar snippet, origin, theme)

Cuatro razones para cambiar que no tienen nada que ver entre sí. **Es el SRP-violation más claro del repo**, y el refactor es mecánico: un componente por pestaña, con el estado compartido subido al padre. De 727 a ~120 + 4×~130.

Bonus: `html2canvas` (194 KB) entra al chunk inicial de **toda** vista de dashboard por import estático en `:5`, para una acción que el 95% de los usuarios nunca usa. Va con `next/dynamic` y desaparece del bundle base.

### B2 — `data-sources/page.tsx`: 5 formularios en un archivo 🔴

588 líneas, **16 `useState`** `[VERIFICADO]`. Estado de `postgres` (name, host, port, database, user, password), de `stripe` (stripeKey), de `sheets` (spreadsheetId), de `shopify` (shopifyUrl, shopifyToken), de `mysql` (reutiliza host/port/database/user/password).

Es una **unión discriminada deshecha en 16 useState sueltos** — el type system no puede garantizar que si `selectedType === 'stripe'` no se esté enviando un host de Postgres. El fix correcto es un `ConnectionForm` por tipo, y que el estado sea `{type, config}` validado como unión.

### B3 — `lib/ai/gateway.ts`: 3 dominios en una clase sin estado 🟠

508 líneas / 412 de código, **1 sola declaración top-level** `[VERIFICADO]`. La clase `AiGateway` tiene 5 métodos públicos que son 3 dominios:
- `generateDashboard:175` — generar dashboards
- `generateNLQASql:247`, `generateNLQAAnswer:283`, `generateNLQAEdit:335` — NLQA
- `explainWidgetData:400` — explicar métricas

Sin estado mutable, así que **heredar de la clase no compra nada**: son 5 módulos de función con un prefijo. (No es el switch de providers que se suele temer en este tipo de monolito — eso está correctamente aislado en `ai/router.ts`, 39 líneas, buen diseño.)

Matiz: los 3 métodos NLQA comparten boilerplate `generateObject` + `toLLMUsage`, así que ahí sí hay factorización real. La separación de mayor valor es **NLQA vs el resto**.

### B4 — `lib/widgets/validator.ts`: 2 responsabilidades 🟡

336 líneas: validación de dominio de arquetipo (`:36-201`) + contratos zod del Dashboard (`:203-290`), que **duplican los enums que ya viven en `types.ts`**.

Detalle que evita un error de diagnóstico: `validateArchetype:36-183` son 148 líneas pero es una **secuencia lineal de guards** que hacen `errors.push(...)` sobre un array local — early-return, sin anidamiento. **No es una God function.** El problema es la mezcla de dos responsabilidades, no la longitud de la función.

> ⚠️ **Corrección de la 2ª pasada.** Este texto afirmaba que `validateArchetype` y varios enums
> de `:203-244` "solo se usan desde tests, señal de API sobredimensionada".
> **`validateArchetype` NO es código muerto**: se llama en producción desde
> `validateDashboardWithArchetype` en `validator.ts:309` `[VERIFICADO]`. Sí es cierto para
> `isValidArchetypeForWidgetCount` (`:319`), `archetypeConstraintsSummary` (`:328`, ni
> siquiera referenciado en tests) y los 6 enums de `:203-244`, que no se referencian en
> `src/` ni en `tests/`. Ver `PASADA-2.md` §4b.

### B5 — Archivos que parecen problemas y no lo son 🟢

> ⚠️ **Corrección de la 2ª pasada (2026-09-30).** La clasificación de `lib/auth/config.ts`
> en esta tabla estaba **mal, y el error era mío**: venía marcada `[INFERIDO]` en un
> explorador y la repetí como si estuviera verificada. Recuento real de flujo de control:
> **23 bloques**, no 0. El archivo contiene `slugify` (`:10-20`), `uniqueSlug` (`:22-32`,
> loop con queries) y **`provisionOrgForUser` (`:34-~100`)**: una transacción completa de
> provisioning multi-tenant que crea la org, inserta el `org_members` con rol admin y
> escribe el audit log, todo con `sql` crudo para setear los GUCs de RLS. Eso es lógica de
> negocio con SRP propia, no configuración.
> **Debe partirse:** `lib/auth/provisioning.ts` (slug + provisioning) y `lib/auth/config.ts`
> (solo el wiring de better-auth). Se agrega a la Fase 3 del plan.
>
> El resto de esta tabla **se re-verificó y sigue correcta** (`catalog.ts` 0, `archetypes.ts` 1,
> `atomic-patterns.ts` 0, `errors/types.ts` 0 bloques de control).

| Archivo | Por qué está bien |
|---|---|
| `lib/templates/catalog.ts` (374) | 1 array de literales + 2 lookups. **0 bloques de control** `[VERIFICADO]` |
| `lib/widgets/archetypes.ts` (534) | 88% catálogo; solo 1 bloque `if` en 534 líneas |
| `lib/widgets/atomic-patterns.ts` (235) | **0 bloques de control** `[VERIFICADO]` |
| `db/schema.ts` (663) | 19 declaraciones `pgTable()` |
| `lib/errors/types.ts` (203) | Catálogo de ~50 códigos de error + `statusFromCode`. Código real: 126 |
| `lib/auth/config.ts` (272) | ⚠️ **CORREGIDO en la 2ª pasada** — ver nota abajo. **No es solo config**: es un problema real de SRP |
| `lib/alerts/evaluator.ts` (259) | 1 export público + 5 helpers privados coherentes; pipeline lineal de pasos numerados. **Límite**, pero cohesivo |
| `lib/security/validate-query.ts` (260) | Código real: 162. Bajo el umbral |
| `hooks/*` y `stores/*` (7 archivos) | **0 exceden 150 líneas.** El hook más grande son 134 |

**Y dos que SÍ son un problema real de tamaño, con matiz:**
- `lib/widgets/types.ts` (172): fan-in alto (28 archivos) pero es el **tipo de dominio central** — alta cardinalidad es la consecuencia correcta, no un smell. Lo que sí debería moverse: `KPIWidgetConfig`/`ChartConfig`/`TableConfig` (son de render, no de dominio) y `StripeOperation` (modela el connector dentro del tipo genérico `Query` — la fuga más clara de ese archivo).
- `lib/connectors/parsers/load.ts` (201): 3 responsabilidades mezcladas (generación de DDL / coerción de tipos / escritura batched), y el mismo error de validación lanzado 3 veces literal (`:27`, `:56`, `:98`), con `buildIndexSQL:76` degradando a `return []` en vez de lanzar — inconsistencia de contrato dentro del mismo archivo.

---

## 4. SOLID, principio por principio

| Principio | Veredicto | Evidencia |
|---|---|---|
| **S** — Responsabilidad única | 🟠 **Parcial** | Los ~11 SRP-violations están casi todos en `components/` y route handlers. `lib/` en general la respeta bien |
| **O** — Abierto/Cerrado | 🟠 **Débil en 2 puntos** | `data-sources/page.tsx` (5 formularios, añadir un tipo toca el archivo entero) y conectores (añadir un `ConnectorType` = editar `types.ts` ×2 + `registry.ts`) |
| **L** — Sustitutabilidad | 🟢 **Sano** | `Connector` tiene 3 métodos, 9/9 los implementan, sin implementaciones parciales. Ninguna violación LSP detectada |
| **I** — Segregación de interfaces | 🟢 **Sano** | La interface `Connector` es mínima y todos la cumplen. SinGod interfaces |
| **D** — Inversión de dependencias | 🟡 **Mitigada a mano** | No hay inyección real de dependencias: los handlers llaman `withOrgContext` + Drizzle inline. El único punto de indirección real es `validateQuery`. Funciona, pero a base de convención |

**D y S están conectadas:** la ausencia de capa de servicio (A1) es la causa directa de que la lógica se filtre a los handlers, y la ausencia de HOF (A2) es la causa de que la repetición sea de ~400 líneas. Arreglando esas dos, S y D improves simultáneamente.

---

## 5. Lo que está bien (verificado — no re-auditar esto)

Esto importa tanto como los hallazgos: es la razón por la que el plan de refactor es acotado.

- **✅ El grafo de dependencias es limpio.** Cero ciclos de importación. Los 2 "ciclos" que reporta un detector automático son **falsos positivos**: son docblocks que mencionan un path de import como ejemplo (`lib/auth/client.ts:15`, `lib/security/validate-query.ts:6`). Las capas van en la dirección correcta: `app/api → lib → db`, sin retrocesos.
- **✅ La granularidad de `src/lib/` es buena.** 21 módulos de dominio, 86 archivos, ningún catch-all, ninguna responsabilidad duplicada entre archivos del mismo módulo. Esto es lo que hace bien el proyecto.
- **✅ `hooks/` y `stores/` sonbic-clean.** 0 de 7 archivos exceden 150 líneas. `useAutoSave` tiene una responsabilidad; `useToast` es 16 líneas de hook sobre su propia store layer.
- **✅ La interface `Connector` es un buen diseño.** Mínima, cumplida al 100%, sin violaciones LSP/ISP.
- **✅ `ai/router.ts` aísla correctamente el selection de provider** (39 líneas) en vez de contaminar el gateway.
- **✅ `atomic-patterns.ts` y `archetypes.ts` no se solapan** — son nivel 1 (primitivas visuales) y nivel 2 (composiciones de negocio), referenciados por id, no duplicados.
- **✅ La capa de seguridad (`lib/security/`, 561 líneas) está bien estructurada y sus tests pasan.** Ver `CODIGO-AUDIT.md` §Fortalezas.
- **✅ Los componentes shadcn/ui multi-export están bien** (`dropdown-menu.tsx` con 8 exports, `card.tsx` con 6) — es el patrón idiomático de Radix, no una violación.
- **✅ Las modularizaciones pequeñas son correctas**: `lib/middleware/`, `lib/observability/`, `lib/onboarding/` (101 líneas), `lib/sharing/` (98), `lib/email/` (112). La disciplina de tamaño *sí* se aplicó en los módulos más recientes.

**Patrón de fondo que vale la pena notar:** los módulos más jóvenes (`alerts/`, `export/`, `reports/`, `onboarding/`, `sharing/`) están todos por debajo de 150 líneas por archivo. **La disciplina se mantuvo donde se aplicó conscientemente.** Lo que se degradó son los archivos que:*:*imsieron antes de que existiera esa disciplina: `components/` y los route handlers fundacionales.

---

## 6. Lo que falta: el estándar no está en ningún lado

Esto es un hallazgo, no un comentario. Verificado:

| Lugar | ¿Menciona el estándar? |
|---|---|
| `app/eslint.config.mjs` | ❌ Ni `max-lines`, ni `max-statements`, ni `complexity`, ni `max-depth` |
| `.github/workflows/ci.yml` | ❌ Solo `eslint . --max-warnings 100` |
| `AGENTS.md` | ❌ 0 menciones a 150/200 líneas, SOLID, o cohesión |
| `README.md` | ❌ |
| `CONTRIBUTING.md` | ❌ |
| `docs/` | ❌ (la única mención de "200 líneas" habla de specs, no de código) |

### Propuesta: hacer el estándar ejecutable, en 3 tiers

Un límite duro de 200 líneas para todo se vuelve una\authoridad inútil — se terminaponiendo `eslint-disable` por todas partes, que es peor que no tener regla. La forma que funciona es **tiered**:

```js
// eslint.config.mjs — propuesto, NO aplicado todavía
import tseslint from 'typescript-eslint';

export default tseslint.config({
  rules: {
    // TIER 1 — bloquea crecimiento futuro. Barato de cumplir.
    'max-lines': ['warn', { max: 250, skipBlankLines: true, skipComments: true }],
    'max-lines-per-function': ['warn', { max: 60, skipBlankLines: true, skipComments: true, IIFEs: true }],
    'max-statements': ['warn', 30],
    'max-depth': ['warn', 4],
    'max-params': ['warn', 4],
  },
}, {
  // TIER 2 — data/config/UI primitives: umbral alto, porque partirlos es peor.
  files: ['**/schema.ts', '**/catalog.ts', '**/archetypes.ts', '**/types.ts',
          '**/components/ui/**', '**/*.test.ts', '**/*.test.tsx'],
  rules: { 'max-lines': 'off', 'max-lines-per-function': 'off' },
}, {
  // TIER 3 — excepciones explícitas y temporales, con fecha.
  // La deuda se vuelve explícita y se gasta, en vez de vivir para siempre.
  files: ['src/components/dashboard/ExportShareDialog.tsx',
          'src/components/alerts/AlertFormModal.tsx',
          'src/app/(dashboard)/data-sources/page.tsx',
          'src/components/settings/MembersManager.tsx',
          'lib/ai/gateway.ts'],
  rules: { 'max-lines': 'off' },
});
```

Y un **step de CI que falle si sube el número**, que es la parte que realmente detiene la regresión:

```yaml
- name: Architecture budget
  run: pnpm arch:budget
```

`scripts/arch-budget.ts` compara contra un baseline versionado (`app/arch-budget.json`) y falla si **el número de archivos sobre el umbral sube**, aunque el total de líneas baje. Eso convierte "no hagamos esto" en una puerta que no se puede abrir por descuido — que es exactamente lo que hoy falta.

**Nota de calibración:** `max-lines` con `skipComments` es justo para este repo porque tiene comentarios muy valiosos (`validate-query.ts` explica el threat model en detalle). Con el límite sin `skipComments`, ese archivo se marcaría falsamente.

---

## 7. Plan de refactor priorizado

Ordenado por **ratio de valor / riesgo**. Los tres primeros son casi mecánicos y no requieren decisiones de diseño.

### Fase 1 — Deuda barata, alto valor (riesgo bajo, ~1 día)

> **Estado: 3 de 4 items aplicados** (ejecutado 2026-09-30). El item 2 se revirtió —
> ver nota de reversión abajo. Resultado medido: **−220 líneas netas**, typecheck/lint/test/build
> verdes, **+18 tests nuevos**.

| # | Acción | Ganancia | Riesgo |
|---|---|---|---|
| 1 | ✅ Extraer `errorResponse` a `src/lib/errors/response.ts` y reemplazar las copias locales | **−249 líneas / +29** en 23 route handlers. Unifica el contrato de error (A3) | Bajo: 9 tests nuevos (`tests/unit/errors/response.test.ts`) |
| 2 | ❌ **REVERTIDO** — ver nota | — | Alto en la práctica |
| 3 | ✅ `html2canvas` → `import()` dinámico dentro del handler | −194 KB del chunk inicial de **toda** vista de dashboard. El `try/catch` existente ya cubría el fallo de carga | Bajo |
| 4 | ✅ Mover `detectFormat` a `src/lib/connectors/parsers/detect-format.ts` | Cierra la violación de OCP. 9 tests nuevos | Bajo |

**Nota sobre el item 1:** la auditoría original estimaba 23 copias; al ejecutarlo
habían quedado **18**, porque el commit de seguridad paralelo `05926b4` ya había consolidado 5.

**⚠️ Nota de reversión — item 2 (HOF `withRouteHandler`):**

La migración se implementó y se aplicó a 16 handlers con un script de transformación de
código. **`tsc` la rechazó: 8 de los 16 quedaron sintácticamente rotos** (la extracción del
prelude capturó líneas parciales, dejando fragmentos como `uth(req, 'dashboard.create');`).
Typecheck y los 1012 tests de la suite completa son los que detectaron la corrupción; el
revert fue completo.

**Causa de fondo, y es un hallazgo valuable:** la auditoría original extrapolo
"350-490 líneas duplicadas" de andamiaje `try/catch + requireAuth + errorResponse` suponiendo
que los 32 handlers eran uniformes. **Medidos: solo 16 de 32 lo son.** Los otros 16 tienen
manejo de error intencional y específico:

| Handler | Razón para no migrar |
|---|---|
| `dashboards/route.ts` | loguea el error con `reqLogger` antes de responder |
| `data-sources/route.ts` | maneja `SSRFError` con un `code` dedicado (`connector.ssrf_blocked`) |
| `nlqa/ask/route.ts` | loguea el SQL que falló validación y limpia mensajes |
| `files/commit`, `files/upload` | formatean `ZodError` / error de multipart con su propio shape |
| `export/pdf`, `templates/*` | loguean o reintentan con otro status |
| 6 sin `try/catch` | `requireAuth` vive fuera del bloque; otra estructura |

**Conclusión revisada:** el HOF no es un refactor mecânico. Adoptarlo requiere migrar
**archivo por archivo**, leyendo cada catch, y decidir conscientemente cuáles conservan su
manejo custom. El ahorro real sería ~70 líneas, no ~400 — y a cambio de un contrato de auth
centralizado. Es un trade-off real, no una deuda que borrar a machete.

> El revert siguió la disciplina de `AGENTS.md` ("stop and revert before continuing",
> no apilar fix-on-fix). El trabajo de seguridad paralelo ya estaba commiteado en
> `05926b4` / `2b6f66b`, así que `git checkout` restauró los 16 archivos sin perder nada.
> El módulo `withAuth` y su test también se eliminaron para no dejar código muerto.

> **Fase 1 → Fase 2** (recomendación de la ejecución): aplicar primero las reglas ESLint
> tiered de §6, porque ahora la Fase 2 toca `components/` y tener el gate puesto evita
> que el código nuevo suba mientras se hace el refactor.

### Fase 2 — SRP en la UI (riesgo medio, ~1 semana)

| # | Acción | Resultado |
|---|---|---|
| 5 | Partir `ExportShareDialog` en 4 pestañas | 727 → ~120 + 4×130 |
| 6 | Un `ConnectionForm` por tipo de conector en `data-sources/page.tsx` | 16 `useState` → estado `{type, config}` como unión validada |
| 7 | Extraer `DEMO_PRESETS` de `DemoDashboardViewer.tsx` a su archivo de datos | −270 líneas de componente |
| 8 | `MembersManager` → `<MemberList>` + `<InviteModal>` | 475 → 2 archivos <200 |

### Fase 3 — Límites de dominio (riesgo medio, ~3 días)

| # | Acción | Resultado |
|---|---|---|
| 9 | `AiGateway` → 3 módulos de función (`generateDashboard`, `nlqa/*`, `explainWidget`) | 508 → 3 archivos <200 |
| 10 | Mover `assertOrgCanSpendLlm` al gateway (A5) | El presupuesto LLM pasa a ser invariante, no recordatorio |
| 11 | Mover los 8 schemas de `data-sources/route.ts:16-75` a `lib/connectors/` | Reutilizables por `/test` y el worker |
| 12 | `validator.ts` → `archetype-validator.ts` + `dashboard-schemas.ts` | Elimina la duplicación de enums con `types.ts` |
| 13 | `alerts/route.ts` → extraer plan-gating y quota a `lib/alerts/` | −50 líneas de reglas inline |

### Fase 4 — Corrección estructural (riesgo medio, ~1 semana)

| # | Acción | Resultado |
|---|---|---|
| 14 | **Clase base `HttpConnector`** con `testConnection()`, envoltura de `QueryResult` y manejo de errores | **−120 líneas** y elimina la deuda latente de A7 |
| 15 | Propagar `signal: AbortSignal.timeout(ms)` a los 5 SaaS via la clase base | Cierra A7 de una vez, no 5 veces |
| 16 | Unificar `truncated` en los 9 conectores | La UI avisa de pérdida de datos |
| 17 | Eliminar la doble lista de columnas en `hubspot.ts` | Correctitud del schema |
| 18 | Circuit breaker → Redis (`query-engine/cache.ts` ya existe) | A4 cerrado, coherente multi-réplica |
| 19 | Mover los configs de render (`KPIWidgetConfig`, `ChartConfig`, `TableConfig`) fuera de `lib/widgets/types.ts` | Coherencia de capas |
| 20 | `parsers/load.ts` → `ddl.ts` + `coerce.ts` + `bulk-insert.ts`; unificar el contrato de throw | Fin de la inconsistencia `:76` vs `:27` |

### Fase 5 — Hacer el estándar permanente (riesgo bajo, ~1 día) ← **no hacer esto al final**

| # | Acción |
|---|---|
| 21 | Añadir las reglas ESLint tiered de §6 como `warn` |
| 22 | Crear `scripts/arch-budget.ts` + `arch-budget.json` con el baseline actual |
| 23 | Documentar el estándar en `AGENTS.md` y `CONTRIBUTING.md` |
| 24 | Bajar el presupuesto a 0 deltas en 30 días; cuando llegue a 0, `--max-warnings 0` |

> **El paso 21 va primero, no último.** Aplicar las reglas *antes* de refactorizar te da la lista exacta de archivos a arreglar y te impide que el código nuevo suba mientras trabajas. Aplicarlas al final solo documenta la deuda que ya existía.

---

## 8. Respuesta directa a tu pregunta

> *"Yo antes hacía que cada archivo tuviera SOLID, 150 o 200 líneas máximo"*

**¿Lo sigue? Parcialmente, y con un patrón claro.**

- **Sí lo sigue donde se aplicó con disciplina reciente**: `hooks/`, `stores/`, `alerts/`, `export/`, `reports/`, `onboarding/`, `sharing/`, `email/`, `observability/` — todos por debajo de 150 líneas, con `0` archivos >200 en hooks/stores.
- **No lo sigue en los cimientos**: `components/` (12 archivos >200) y los route handlers fundacionales (`data-sources` 360, `nlqa/ask` 314, `generate` 253).
- **El número bruto miente.** De 29 archivos >200 líneas de código, solo **~11 son problemas reales**. Los otros 18 son catálogos de datos, schemas, configuración o shadcn primitives donde partir el archivo **empeoraría** la base. Aplicar "200 líneas" mecánicamente habría roto `db/schema.ts` en 4 archivos sin ganar nada.
- **Y el estándar no está escrito en ningún lado**, así que la regresión era inevitable. No es culpa de nadie: no había dónderecordarlo.

> *"Sé que hoy hay mejores arquitecturas, pero no hemos revisado eso"*

**Las revisiting. Tres observaciones concretas:**

1. **El grafo de módulos ya es "la arquitectura moderna".** App Router, feature-scoped components, `lib/` por dominio, barrel `index.ts`, TanStack Query para estado remoto y Zustand solo para UI state, `withOrgContext` como frontera RLS. La estructura de directorios que se suele recomendar en 2024-2026 la tienes.

2. **Lo que falta no es una arquitectura nueva — es una capa y un presupuesto.**
   - **Falta la capa de aplicación/servicio** (A1). Es lo que separa "framework moderno" de "arquitectura mantenida": en este repo, las reglas de negocio viven en los route handlers y se repiten. Añadir `src/server/` con los 6-8 servicios que ya se insinúan en `lib/` es el cambio con mayor retorno.
   - **Falta enforcement** (§6). Sin un presupuesto medible y automático, cualquier estándar se erosiona en 6 meses — y este se eritó.

3. **Lo que NO conviene "modernizar":** no toques la interface `Connector` (es correcta), ni `ai/router.ts` (bien aislado), ni los módulos de datos grandes (partirlos es un retroceso), ni `db/schema.ts`. La tentación de modernity aquí sería **empeorar** la base.

---

## 9. Límites de esta auditoría

Honestidad sobre lo que no pude verificar:

- **LOC de código** excluye blancos y comentarios vía un clasificador propio. Los LOC *totales* son exactos (`wc -l`); los de código pueden variar ±10 líneas por archivo. La clasificación por tipo (data vs lógica) es **juicio**, respaldado por el conteo de bloques de control que hice explícito.
- **La duplicación de conectores (6.81%) viene de `jscpd`**, herramienta de terceros que no es gate de CI. Es un piso, no un techo — con umbral más agresivo daría más.
- **No ejecuté los gates** (`lint`/`typecheck`/`test`/`build`) durante esta auditoría; el análisis es estático. Los resultados de gates de `CODIGO-AUDIT.md` son de la misma fecha.
- **No medí runtime**: nada de esto se validó ejecutando la app. Los hallazgos A4 (circuit breaker) y A5 (quota) tienen impacto real *dependiente del despliegue* (réplicas, cold starts).
- **No audité los `.test.ts`** para simetría (¿los tests de archivos de 700 líneas son legibles?) ni el e2e suite, fuera del encargo.
- **La cuenta de ~350-490 líneas del esqueleto auth (A2) es extrapolada** desde call-sites verificados, no medida archivo por archivo. Es una estimación, marcada como tal.

---

## Anexo: comandos para reproducir las mediciones

```bash
cd app
# LOC totales por archivo, orden descendente
find src -name "*.ts" -o -name "*.tsx" | grep -v "\.test\." | xargs wc -l | grep -v " total$" | sort -rn | head -40

# Archivos sobre el umbral
find src -name "*.ts" -o -name "*.tsx" | grep -v "\.test\." | xargs wc -l | awk '$1>200 && $2!="total"'

# Duplicación de conectores
npx jscpd --min-lines 5 --min-tokens 40 src/lib/connectors

#(error) Deteccion de ciclos de import (los 2 resultados son falsos positivos: docblocks)
npx madge --circular --extensions ts,tsx src/

#(error)Copias de errorResponse
grep -rn "function errorResponse" src/app/api/ | wc -l

#(error) Ausencia de capa de servicio y de HOF
ls -d src/services src/repositories src/server 2>&1
grep -rn "withAuth\|withHandler\|createRouteHandler" src/

#(error) Conectores sin cancelacion
grep -rn "AbortSignal\|signal:\|AbortController" src/lib/connectors/implementations/

#(error) Ausencia de enforcement de tamano
grep -n "max-lines\|max-statements\|complexity" eslint.config.mjs
```
