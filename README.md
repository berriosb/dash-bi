# dash-bi

> **Open source + self-hosted BI con IA que compone dashboards completos con datos reales y elección de proveedor LLM.**
>
> Como Metabase, Superset, Lightdash y Wren AI — pero con AI generativa + multi-LLM como citizens first-class.

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Stack: Next.js 16](https://img.shields.io/badge/Next.js-16-black)](https://nextjs.org)
[![TypeScript: strict](https://img.shields.io/badge/TypeScript-strict-blue)](https://www.typescriptlang.org)
[![Tests: 252+](https://img.shields.io/badge/tests-252%2B%20passing-brightgreen)](./app/tests)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](./CONTRIBUTING.md)

> **NOTA:** Este es el directorio de trabajo local del proyecto. El código de la aplicación vive en `./app/`.

## Estructura del workspace

```
dash-bi/
├── README.md                       ← este archivo (índice del workspace)
├── .gitignore                      ← ignores raíz (OS, editor, secrets, .agents/)
├── SPEC.md                         ← spec master del producto
├── PRODUCT.md                      ← contexto durable del producto
├── DESIGN.md                       ← design system (Impeccable)
│
├── docs/                           ← docs de diseño + auditorías
│   ├── IMPLEMENTATION-PLAN-v1.0.md ← plan de implementación 6 semanas
│   ├── architecture.md             ← arquitectura técnica
│   ├── security/
│   │   └── threat-model.md         ← amenazas + controles
│   ├── audits/
│   │   └── 2026-07-21-arquitectura/
│   │       ├── REPORTE.md          ← auditoría arquitectura
│   │       └── STACK-AUDIT.md      ← auditoría stack
│   └── design/
│       └── dashboard-surface-brief.md
│
├── specs/                          ← specs por feature (22 archivos)
│   ├── widget-system.md
│   ├── dashboard-archetypes.md
│   ├── ai-generate-dashboards.md
│   ├── multi-llm-router.md
│   ├── connectors.md
│   ├── layouts-themes.md
│   ├── multi-tenant.md
│   ├── auth.md
│   ├── export.md
│   ├── onboarding.md
│   ├── manual-editing.md
│   ├── email.md
│   ├── query-engine.md
│   ├── nlqa.md
│   ├── testing.md
│   ├── deployment.md
│   ├── scheduled-reports.md
│   ├── errors-ux.md
│   ├── csv-excel-connector.md
│   ├── demo-mode.md
│   └── README.md
│
├── research/                       ← research de competidores
│   ├── competitors.md              ← 18 competidores mapeados
│   └── critical-competitors.md     ← deep dive Metabase/Wren/Briefer
│
├── diagrams/                       ← (vacío por ahora)
│
├── .hermes/                        ← planes de trabajo
├── .impeccable/                    ← config Impeccable
├── .opencode/                      ← skills OpenCode (source of truth)
├── .agents/                        ← gitignored — mirror runtime, NO se commitea
│
└── app/                            ← CÓDIGO DE LA APLICACIÓN (ver app/README.md)
    ├── src/                        ← Next.js App Router + componentes
    ├── drizzle/migrations/         ← SQL migrations
    ├── scripts/                    ← setup-rls + init-readonly
    ├── tests/                      ← 208 tests passing
    └── ...
```

## Status actual

**Sprint 1 — Foundation (~60% completo):**

Ver [`app/README.md`](./app/README.md) para detalle completo.

- [x] Specs escritos (22 specs + 4 docs arquitectura + 2 research)
- [x] Auditorías hechas (arquitectura + stack, 2026-07-21)
- [x] Threat model + 10 controles de seguridad
- [x] Scaffolding Next.js 16 + configs
- [x] Schema Drizzle (12 tablas) + migrations generadas
- [x] RLS policies + script de setup
- [x] `withOrgContext()` wrapper + ESLint rule anti-data-leak v1.1
- [x] Security utilities (encryption, validate-query, validate-connection)
- [x] **208 tests passing** (unit + security, sin DB)
- [x] Docker Compose (Postgres + Redis + app + PDF worker)
- [x] CI/CD (lint + typecheck + unit + security + e2e + audit)
- [x] Logger con redaction (Pino) + Sentry
- [x] better-auth (magic link + Google OAuth + RBAC + email verification)
- [x] Auto org provisioning en signup
- [x] EmailProvider + Resend + Mock para dev
- [x] shadcn/ui (10 componentes) + 7 widgets + DashboardGrid (dnd-kit)
- [x] ESLint 9 flat config + custom rule funcional
- [x] AI Gateway + multi-LLM router (OpenAI, Anthropic, Gemini)
- [x] Query engine completo (cache, circuit breaker, hydrate)
- [x] 3 conectores (Postgres, Stripe, Sheets)
- [x] Demo dashboard público en `/demo/dashboard`

**Próximo (cierre Sprint 1):**

- [ ] Toast wiring en actions
- [ ] Templates pre-hechos
- [ ] Wizards de conectores
- [ ] Dark mode
- [ ] E2E tests auth flow completo

## Cómo arrancar

Ver [`app/README.md`](./app/README.md) para instrucciones detalladas.

```bash
cd app/
cp .env.example .env.local
docker compose up -d postgres redis
pnpm install
pnpm db:migrate
pnpm db:setup-rls
pnpm dev
```

App corre en http://localhost:3000.

## Decisiones congeladas

Ver `docs/IMPLEMENTATION-PLAN-v1.0.md` para el plan consolidado.

**Cambios clave vs v0.1:**
- AI SDK v6 (no v4)
- dnd-kit (no react-grid-layout)
- TanStack Query (separado de Zustand)
- Worker PDF separado
- 7 widgets (no 10)
- 2 themes (no 4)
- 3 LLM providers (no 5)
- Puppeteer en container separado

## License

AGPL v3 — ver [`LICENSE`](./LICENSE).

Elegida por la misma razón que Metabase, Wren AI, Briefer y Grafana: el código es libre para self-host, pero si alguien ofrece dash-bi como servicio en la nube debe publicar sus modificaciones. Esto protege que un proveedor cloud forkee el código sin contribuir.

## Contributing

Ver [`CONTRIBUTING.md`](./CONTRIBUTING.md). Resumen:

- **Issues:** bugs, features, preguntas — todo welcome.
- **PRs:** abrir PR contra `main`. CI corre lint + typecheck + unit + e2e + audit.
- **Branches:** `feat/*`, `fix/*`, `chore/*`, `docs/*`.
- **Commits:** conventional commits (`feat:`, `fix:`, `chore:`, `docs:`).

## Code of Conduct

[`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md) — basado en Contributor Covenant 2.1.