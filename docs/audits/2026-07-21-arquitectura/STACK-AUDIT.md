# Auditoría crítica del stack — dash-bi

**Fecha:** 2026-07-21 · **Alcance:** decisiones confirmadas antes de implementar. **Conclusión:** el stack es viable para un MVP self-hosted, pero hay cuatro riesgos de diseño que conviene resolver antes de escribir features: aislamiento multi-tenant, ejecución segura de SQL/conectores, elección del motor de layout y estrategia de runtime para Puppeteer. No recomiendo congelar versiones sin una matriz de compatibilidad y pruebas de integración.

> **Nota de evidencia.** El repositorio contiene especificaciones y `docs/architecture.md`, pero no `package.json` ni código ejecutable; por tanto no es posible reportar bundle real, tiempos de build, CVEs instaladas o tests. Las afirmaciones de versiones deben validarse al crear el lockfile.

## Resumen priorizado

| ID | Severidad | Riesgo | Decisión |
|---|---|---|---|
| A1 | CRITICAL | SQL/conectores server-side + BYOK pueden convertirse en SSRF, exfiltración y DoS | Diseñar sandbox, allowlist de destinos, timeouts, límites y auditoría antes de P0 |
| A2 | CRITICAL | `org_id` + RLS es insuficiente si la conexión de cada request no fija el tenant | Política DB con `SET LOCAL`, transacciones obligatorias y tests de aislamiento |
| A3 | HIGH | Puppeteer dentro de un contenedor Next único complica tamaño, sandbox, concurrencia y operación | Separar worker/export service; Playwright solo si aporta cobertura, no como sustitución automática |
| A4 | HIGH | `react-grid-layout` es una apuesta fuerte y puede chocar con React 19/Next 16 y layouts responsive | Spike con RGL y comparar dnd-kit/pragmatic DnD; persistir modelo propio de layout |
| A5 | HIGH | “AI SDK v4” ya no es una base estable en 2026 | Fijar AI SDK 5/6 compatible con providers y encapsular adaptador propio |
| A6 | HIGH | Tremor añade dependencia Recharts y limita visualizaciones BI avanzadas | Mantenerlo para primitives MVP, evaluar ECharts para series grandes/interacción |
| A7 | HIGH | Docker Compose no es HA ni despliegue multiusuario por sí mismo | Documentar target operativo: backup, TLS, secrets, upgrades, healthchecks y worker |
| A8 | MEDIUM | Auth/orgs de better-auth tiene ecosistema joven y compatibilidad ORM sensible | Pruebas de migración, sesiones, recovery, OAuth y autorización por recurso |
| A9 | MEDIUM | Zustand + zundo puede duplicar estado servidor y generar historiales enormes | Zustand solo para UI; TanStack Query para server state; historial acotado/serializable |
| A10 | MEDIUM | Falta un plan de testing, observabilidad, CI y gestión de secretos | Introducir gates desde el primer commit |

## Evidencia y recomendaciones por categoría

### Frontend: Next.js 16 + React 19.2 — HIGH
Next.js 16 trae Turbopack estable, Cache Components y cambios de arquitectura; la documentación oficial de Next.js 16 destaca que el bundler y el modelo de caching cambian defaults relevantes ([nextjs.org/blog/next-16](https://nextjs.org/blog/next-16)). Es una buena elección si el equipo conoce RSC, pero para un producto de dashboards con mucha interactividad aumenta la superficie de errores: boundaries server/client, caché accidental de datos, acciones y streaming.

**Alternativas:** Vite+React reduce magia y es excelente si API y frontend se separan; Remix ofrece servidor web más explícito; SvelteKit reduce JS enviado pero cambia el pool de talento/ecosistema; Astro no es ideal para una app altamente interactiva. **Recomendación:** conservar Next.js, pero fijar Node/Next/React, prohibir acceso DB desde Client Components, definir política de caching (`dynamic`/`no-store`/`use cache`) y añadir smoke tests de tenant.

### UI: shadcn/ui + Radix bajo Tailwind 4 — LOW/MEDIUM
shadcn/ui no es una dependencia versionada única: se copia código al repo. Eso reduce lock-in, pero convierte actualizaciones y accesibilidad en responsabilidad propia. Radix es buen fundamento. Mantine/Chakra aceleran CRUD pero imponen tokens/CSS y aumentan lock-in; Headless UI es más pequeño pero menos completo.

**Recomendación:** mantener shadcn/Radix; fijar tokens de diseño y una política de actualización; no mezclar primitives de tres sistemas.

### Charts: Tremor/Recharts — HIGH
Tremor acelera KPI y charts comunes, pero hereda límites de Recharts: SVG/DOM, rendimiento degradado con muchos puntos, interacción avanzada y personalización BI limitada. Recharts tiene gran adopción, pero Tremor añade una capa que puede quedar desfasada con React/Next. Visx ofrece control D3 y menor abstracción; ECharts aporta canvas, dataZoom y gráficos ricos; Nivo facilita theming pero añade runtime.

**Recomendación:** usar Tremor solo para 7 widgets MVP y establecer umbral: downsampling/aggregación server-side; si se requieren >5–10k puntos o brushing/zoom, ECharts (o una capa canvas) debe ser la ruta. No renderizar datos crudos ilimitados.

### ORM: Drizzle — MEDIUM
Drizzle es ligero, SQL-first y adecuado para Postgres/RLS; su coste es que migraciones, relaciones complejas y tooling requieren más disciplina. Prisma tiene mejor onboarding/migraciones y ecosistema, a cambio de runtime/client generado; Kysely es excelente si se quiere query builder tipado sin ORM; TypeORM no sería mi elección nueva.

**Recomendación:** mantener Drizzle, pero imponer migraciones reproducibles, revisión SQL, índices por `(org_id, ...)`, `EXPLAIN` para queries de widgets y tests de rollback. No almacenar credenciales de conectores en JSONB sin cifrado envelope/rotación.

### Auth: better-auth — MEDIUM/HIGH
better-auth es flexible y TypeScript-native, pero más joven que Auth.js/Clerk/Supabase Auth; ya existen reportes públicos de conflictos de peer dependencies con versiones de Drizzle (por ejemplo issue #6925 en GitHub). Auth.js v5 ofrece ecosistema conocido aunque su estado y mantenimiento deben verificarse; Clerk reduce trabajo operativo pero crea lock-in y coste; Supabase Auth acopla proveedor.

**Recomendación:** si self-hosting es requisito, conservar better-auth con lockfile y pruebas de upgrade. Separar autenticación de autorización: membership, rol y permisos por dashboard/data source deben verificarse server-side en cada mutación. Añadir rate limiting, email verification, recovery, CSRF/origin checks y revocación de sesiones.

### Drag-drop: react-grid-layout — HIGH
RGL encaja en dashboards tipo grid, pero históricamente ha sufrido fricción con cambios de React, SSR y responsive layouts. dnd-kit es más composable pero requiere construir grid/keyboard semantics; pragmatic-drag-and-drop tiene buen enfoque de performance y accesibilidad, pero también requiere modelo propio; react-dnd es potente y pesado.

**Recomendación:** hacer un spike antes de congelar. Renderizar 100 widgets, resize, teclado, touch, SSR/hydration y persistencia. Independientemente de librería, no persistir el objeto interno: definir `LayoutItem {i,x,y,w,h,minW,...}` versionado y migrable.

### Estado: Zustand + zundo — MEDIUM
Zustand es sencillo para estado cliente; zundo puede producir snapshots grandes si guarda dashboard completo y datos. El riesgo principal es mezclar datos de servidor, streaming AI, layout y undo en un store global. Redux Toolkit es más explícito; Jotai granular; Valtio proxy-based; TanStack Query es mejor para cache/server state pero no reemplaza estado de edición.

**Recomendación:** TanStack Query para dashboards, fuentes y resultados cacheables; Zustand para UI/editor; zundo únicamente sobre comandos o patches, con límite de profundidad, compresión y exclusión de resultados de queries.

### AI: Vercel AI SDK v4 — HIGH
La documentación oficial publica guías de migración v4→v5 y también v5→v6 ([ai-sdk.dev/docs/migration-guides](https://ai-sdk.dev/docs/migration-guides)); mantener v4 en un proyecto nuevo crea deuda inmediata y riesgo de incompatibilidad entre cliente/servidor/providers. El SDK no resuelve por sí solo seguridad de prompts, SQL, cuotas, trazabilidad ni evaluación.

**Recomendación:** escoger una versión actual soportada (validar v6 en lockfile), fijar versiones coordinadas de `ai`, `@ai-sdk/*` y Zod, y encapsularlo detrás de `AiGateway`. Structured output debe validarse con schema; nunca aceptar SQL/URL generado sin policy engine. Añadir budgets por org, timeout/retries, redacción de secretos, prompt/version registry y tests con fixtures.

### PDF: Puppeteer — HIGH
Chromium añade cientos de MB y consumo de CPU/RAM; en un proceso Next compartido, exports concurrentes pueden agotar memoria y bloquear requests. Docker requiere sandbox correcto, fuentes, locale, límites y graceful shutdown. Playwright mejora multi-browser pero no elimina coste; react-pdf evita navegador pero no reproduce CSS real; wkhtmltopdf está envejecido; `@sparticuz/chromium` es útil en serverless pero no para cualquier Docker.

**Recomendación:** separar exportación a worker/cola con límite de concurrencia, timeout, tamaño máximo, cleanup y métricas. Mantener Puppeteer si fidelidad CSS es requisito; evaluar Playwright solo por features, no por esperanza de menor consumo.

### Email — MEDIUM
Resend es DX excelente y API moderna, Postmark suele destacar en entrega transaccional, SES minimiza coste pero exige más operación; SendGrid es amplio pero históricamente complejo. Nodemailer+SMTP es portable pero deja entregabilidad, rebotes y observabilidad al operador.

**Recomendación:** abstraer `EmailProvider`; elegir Postmark/Resend para MVP según región y requisitos de inbound, SES si el usuario administra AWS. Configurar SPF, DKIM, DMARC, bounce handling, templates versionados y no bloquear signup por proveedor caído.

### Deploy: Docker Compose — HIGH
Compose es adecuado para instalación self-hosted simple, no para rolling deploy, HA, autoscaling, backups, secretos, logs centralizados o Chromium aislado. Vercel simplifica frontend pero no encaja bien con Postgres/conectores persistentes y Puppeteer largo; Cloudflare limita Node/browser; Railway/Fly reducen ops pero introducen dependencia SaaS.

**Recomendación:** mantener Compose como distribución local/single-node, no llamarlo arquitectura de producción. Entregar `healthcheck`, migración explícita, backup/restore probado, volúmenes, TLS/reverse proxy, límites de recursos, rotación de secretos y servicio separado para worker/export.

### Testing — CRITICAL (ausente)
No hay `package.json`, código ni configuración de tests en el repo actual, así que no puede verificarse nada. Para este dominio faltan pruebas de aislamiento tenant y seguridad de SQL, que son más importantes que snapshots visuales.

**Matriz mínima:** Vitest para schemas, policies y servicios; Playwright para login→crear dashboard→editar→exportar; tests de integración con Postgres real (Testcontainers o servicio CI); contract tests de conectores; property/fuzz tests para dashboard JSON y SQL policy. Cypress es válido, pero no aporta ventaja clara sobre Playwright para multi-browser y PDF.

### Monitoring/operations — CRITICAL (ausente)
Sentry cubre excepciones y performance; PostHog producto/flags; Axiom logs; Pino solo logs locales. Ninguno reemplaza al otro. Instrumentar correlation/request ID, org_id hash/no PII, latencia DB/LLM/conector/PDF, tokens/coste, retries, memory Chromium, errores por provider, audit events y métricas de aislamiento. Sentry + Pino estructurado + OpenTelemetry es una base razonable; PostHog opt-in y con controles de privacidad.

### Forms — LOW/MEDIUM
react-hook-form es maduro y liviano; TanStack Form es más moderno y tipado; Conform encaja bien con progressive enhancement/Server Actions; Formik es la opción menos atractiva nueva por rendimiento y mantenimiento relativo.

**Recomendación:** Conform si se priorizan Server Actions y validación server-first; RHF si el equipo ya domina su ecosistema. Usar un único estándar con Zod compartido.

## Riesgos transversales que faltan

1. **Aislamiento:** RLS debe usar contexto de sesión DB por transacción; `org_id` en el WHERE de aplicación no basta. Testear lecturas, escrituras, exports, caché, logs y errores cross-tenant.
2. **Ejecución de datos:** allowlist de hosts/puertos, bloqueo RFC1918/metadata endpoints, egress control, credenciales de mínimo privilegio, read-only, límites de filas/bytes/tiempo, cancelación y pool separado.
3. **Caché:** nunca cachear respuestas con datos de tenant sin clave de tenant; invalidación tras edición.
4. **Modelo:** JSONB `widgets/layout` necesita `schema_version`, migraciones y compatibilidad hacia atrás. Consultas deben guardar versión, parámetros redacted y resultado resumido; no secretos.
5. **Seguridad de BYOK:** cifrado en reposo, KMS/secret key externa, no enviar keys al browser, rotación y borrado; límites de coste y abuso.
6. **CI/CD:** pnpm/npm lockfile verificado, Node LTS fijado, lint/typecheck/build/test/e2e, `npm audit`/OSV, Dependabot/Renovate, imágenes Docker pinned por digest, SBOM y escaneo de imagen.
7. **Operación:** backups Postgres y restore drill, migraciones backward-compatible, health/readiness, graceful shutdown, colas y dead-letter para exports.
8. **Privacidad:** retención configurable de prompts, query text y audit logs; redacción de PII; política de telemetría opt-in para OSS.

## Plan de decisión antes de codear

- **P0:** threat model y contrato de ejecución SQL; tenant/RLS integration tests; elegir AI SDK soportado; spike RGL; decidir arquitectura worker PDF.
- **P1:** lockfile + Node/DB version policy; esquema versionado de dashboard; testing/CI; observabilidad mínima; secrets/email abstraction.
- **P2:** benchmark de charts con datasets representativos; accesibilidad (keyboard drag, screen reader); documentación de Compose y backup.

## Veredicto
**Aprobable como MVP con condiciones, no listo para congelar implementación.** Conservar Next.js, shadcn/Radix, Drizzle, Zustand y Puppeteer (si PDF fiel es requisito), pero no conservar literalmente “AI SDK v4 + Next único con Chromium + RLS declarativa” sin los controles anteriores. Las alternativas con mayor potencial de evitar arrepentimiento son ECharts para datasets grandes, TanStack Query para server state, Conform/RHF con Zod y un worker de exportación.
