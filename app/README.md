# dash-bi — App

Aplicación Next.js 16 + React 19.2 de dash-bi.

> **NOTA:** Este es el directorio de la app. La raíz del workspace vive en `../`.

## Estructura

```
app/
├── package.json                ← Next.js 16 + deps
├── docker-compose.yml          ← Postgres + Redis + app + worker
├── Dockerfile                  ← multi-stage (Node 22 Alpine)
├── Dockerfile.worker           ← PDF worker (Puppeteer)
├── next.config.ts              ← security headers + webpack tweaks
├── tailwind.config.ts          ← theme tokens via CSS vars
├── tsconfig.json               ← TS strict + path aliases
├── vitest.config.ts            ← unit + security tests
├── playwright.config.ts        ← e2e (chromium/firefox/mobile-safari)
├── drizzle.config.ts           ← migration config
├── eslint.config.mjs           ← ESLint 9 flat config
├── .github/workflows/ci.yml    ← CI (lint/typecheck/test/e2e/build/audit)
├── .env.example                ← template
├── .eslint-rules/              ← custom rule anti-data-leak
│   └── no-raw-db-queries.cjs
├── drizzle/migrations/         ← generated migrations
│   ├── 0000_initial.sql
│   └── 0001_rls_policies.sql
├── scripts/
│   ├── postgres/init-readonly.sql   ← defense in depth (read-only DB user)
│   └── setup-rls.ts                 ← programmatic RLS setup
└── src/
    ├── app/                    ← Next.js App Router
    │   ├── (auth)/             ← /login, /signup
    │   ├── (dashboard)/        ← /dashboards, /data-sources, /settings, /onboarding
    │   ├── demo/dashboard      ← showcase (no auth)
    │   └── api/                ← REST endpoints
    │       ├── auth/[...all]   ← better-auth catch-all
    │       ├── dashboards/     ← CRUD + /generate + /share + /export/pdf
    │       ├── data-sources/   ← CRUD + /:id/test
    │       ├── public-links/   ← revocar links públicos
    │       └── health/         ← health check
    ├── components/             ← shadcn/ui + custom
    │   ├── ui/                 ← primitives (button, card, input, label, badge, separator, skeleton, dropdown-menu, toast, toaster)
    │   ├── dashboard/          ← DashboardGrid (dnd-kit)
    │   ├── widgets/            ← 7 widgets + WidgetRenderer + WidgetSurface
    │   ├── errors/             ← ErrorState + WidgetErrorState
    │   ├── layout/             ← Header + Sidebar
    │   ├── org/                ← OrgSwitcher
    │   └── providers/          ← TanStack Query + Toaster
    ├── lib/
    │   ├── ai/                 ← AiGateway + multi-LLM router
    │   ├── audit/              ← audit() helper + events catalog
    │   ├── auth/               ← better-auth config + permissions + schemas
    │   ├── connectors/         ← Postgres + Stripe + Sheets
    │   ├── email/              ← EmailProvider abstraction + Resend + Mock
    │   ├── errors/             ← toUserError + ERROR_CATALOG
    │   ├── query-engine/       ← execute + cache + hydrate + resolve + dashboard
    │   ├── security/           ← encryption + validate-query + validate-connection
    │   ├── widgets/            ← types + archetypes + atomic-patterns + validator + selector
    │   ├── env.ts              ← Zod validation
    │   ├── logger.ts           ← Pino con redaction
    │   ├── redact.ts           ← API key redaction
    │   └── cn.ts
    ├── db/                     ← Drizzle
    │   ├── schema.ts           ← 12 tablas (incl. accounts + verifications)
    │   ├── client.ts           ← withOrgContext() wrapper
    │   └── rls.ts              ← RLS policies (programmatic)
    ├── hooks/                  ← use-toast
    ├── stores/                 ← Zustand (uiStore + dashboardStore con zundo)
    └── types/
└── tests/
    ├── security/               ← P0 threat model tests
    │   ├── sql-injection.test.ts
    │   ├── ssrf.test.ts
    │   ├── encryption.test.ts
    │   └── tenant-isolation.test.ts
    ├── unit/
    │   ├── audit/
    │   ├── auth/
    │   ├── errors/
    │   ├── widgets/
    │   ├── email/
    │   ├── connectors.test.ts
    │   ├── env.test.ts
    │   ├── query-engine.test.ts
    │   └── redact.test.ts
    └── e2e/
        └── smoke.spec.ts
```

## Status actual

**MVP funcional — estabilización y cierre:**

La base Foundation y el vertical slice principal ya están implementados. El
estado detallado, incluyendo qué está probado y qué depende de Docker/E2E, vive
en [`../docs/MVP-STATUS.md`](../docs/MVP-STATUS.md).

- [x] Scaffolding Next.js 16 + configs
- [x] Schema Drizzle (12 tablas: orgs, users, accounts, sessions, verifications, org_members, data_sources, dashboards, dashboard_versions, public_links, llm_usage, audit_log)
- [x] Drizzle migrations (`drizzle/migrations/0000_initial.sql`)
- [x] RLS policies migration (`0001_rls_policies.sql`)
- [x] `db:setup-rls` script (programmatic RLS setup)
- [x] `withOrgContext()` wrapper + ESLint rule anti-data-leak (v1.1 — tolera `withOrgContext` callbacks)
- [x] better-auth setup (magic link + Google OAuth + email verification + RBAC)
- [x] Auto org provisioning en signup (`databaseHooks.user.create.after`)
- [x] EmailProvider abstraction + Resend adapter + Mock para dev
- [x] shadcn/ui: button, card, input, label, badge, separator, skeleton, dropdown-menu, toast, toaster
- [x] 7 widgets UI (KPI + line/bar/pie/area/scatter/table) + WidgetRenderer + WidgetSurface
- [x] DashboardGrid con dnd-kit (12-col grid + density + density tokens)
- [x] Security utilities (encryption AES-256-GCM, validate-query con role PII filter, validate-connection SSRF)
- [x] Multi-LLM router (OpenAI, Anthropic, Gemini)
- [x] Query engine (cache + execute con circuit breaker + hydrate + resolve)
- [x] 3 conectores (Postgres, Stripe, Sheets)
- [x] Dashboard archetypes (8 curados + 7 patrones atómicos + 4 axes de variación)
- [x] Auth flows: /login, /signup, magic link, Google OAuth
- [x] App shell: Header + Sidebar + selector real de organizaciones + theme switcher
- [x] Logger Pino con redaction + Sentry setup
- [x] Docker Compose (Postgres + Redis + app + PDF worker)
- [x] CI: lint + typecheck + unit + security + e2e + audit
- [x] Tests unitarios y de seguridad para API, seguridad, conectores y UI
- [x] ESLint 9 flat config + custom rule
- [x] ErrorState + WidgetErrorState components
- [x] Demo dashboard público en `/demo/dashboard`

**Pendiente para declarar el MVP listo:**

- [ ] Ejecutar integración RLS y E2E con Docker real
- [ ] Validar signup → onboarding → fuente → generación → edición → exportación → sharing
- [ ] Completar UI de scheduled reports y las superficies parciales de NLQA/demo mode
- [ ] Actualizar las acceptance criteria con evidencia de pruebas

## Cómo arrancar

```bash
cp .env.example .env.local
# Editar .env.local con valores reales:
#   openssl rand -hex 32    → BETTER_AUTH_SECRET
#   openssl rand -hex 32    → LLM_KEY_ENCRYPTION_KEY (32 bytes hex = 64 chars)

docker compose up -d postgres redis
pnpm install
pnpm db:migrate              # aplica migrations SQL
pnpm db:setup-rls            # habilita RLS (idempotente)
pnpm dev
```

App corre en http://localhost:3000.

## Scripts principales

```bash
pnpm dev              # dev server (Next.js 16 con webpack)
pnpm build            # build producción
pnpm start            # arrancar build
pnpm lint             # ESLint (warnings OK, errors no)
pnpm lint:strict      # igual pero --max-warnings 0
pnpm typecheck        # tsc --noEmit
pnpm test             # vitest run (386 tests)
pnpm test:watch       # watch mode
pnpm test:security    # solo threat-model P0 tests
pnpm test:e2e         # playwright
pnpm db:generate      # drizzle-kit generate
pnpm db:migrate       # drizzle-kit migrate
pnpm db:studio        # drizzle-kit studio
pnpm db:setup-rls     # habilita RLS en DB
```

## Stack

- **Next.js 16** + React 19.2 (App Router)
- **TypeScript strict** + ESLint 9 flat config
- **Tailwind CSS 4** + tokens via CSS variables
- **shadcn/ui** primitives (10 componentes)
- **Recharts** para widgets
- **better-auth** + Drizzle adapter (PostgreSQL)
- **Drizzle ORM** + 12 tablas + 2 migrations
- **Postgres 16** con RLS multi-tenant
- **AI SDK v6** + multi-provider (OpenAI, Anthropic, Gemini)
- **Resend** email + Mock para dev
- **Pino** logger + redaction
- **Sentry** monitoring
- **Puppeteer** en worker separado
- **TanStack Query** + Zustand + zundo
- **dnd-kit** drag-and-drop

## Decisiones congeladas

Ver `../docs/IMPLEMENTATION-PLAN-v1.0.md` para el plan consolidado.

## License

AGPL v3 — ver [`../LICENSE`](../LICENSE).
