# dash-bi — Local Workspace

> **NOTA:** Este es el directorio de trabajo local del proyecto. El código de la aplicación vive en `./app/`.

## Estructura del workspace

```
dash-bi/
├── README.md                       ← este archivo (índice del workspace)
├── SPEC.md                         ← spec master del producto
├── docs/                           ← docs de diseño + auditorías
│   ├── IMPLEMENTATION-PLAN-v1.0.md ← plan de implementación 6 semanas
│   ├── architecture.md             ← arquitectura técnica
│   ├── security/
│   │   └── threat-model.md         ← amenazas + controles
│   └── audits/
│       └── 2026-07-21-arquitectura/
│           ├── REPORTE.md          ← auditoría arquitectura
│           └── STACK-AUDIT.md      ← auditoría stack
│
├── specs/                          ← specs por feature
│   ├── widget-system.md
│   ├── ai-generate-dashboards.md
│   ├── multi-llm-router.md
│   ├── connectors.md
│   ├── layouts-themes.md
│   ├── multi-tenant.md
│   ├── auth.md
│   ├── export.md
│   ├── onboarding.md
│   ├── manual-editing.md
│   └── email.md
│
├── research/                       ← research de competidores
│   ├── competitors.md              ← 18 competidores mapeados
│   └── critical-competitors.md     ← deep dive Metabase/Wren/Briefer
│
├── diagrams/                       ← (vacío por ahora)
│
└── app/                            ← CÓDIGO DE LA APLICACIÓN
    ├── package.json                ← Next.js 16 + deps
    ├── docker-compose.yml          ← Postgres + Redis + app + worker
    ├── Dockerfile
    ├── Dockerfile.worker           ← PDF worker con Puppeteer
    ├── next.config.ts
    ├── tailwind.config.ts
    ├── tsconfig.json
    ├── vitest.config.ts
    ├── playwright.config.ts
    ├── drizzle.config.ts
    ├── .github/workflows/ci.yml    ← CI/CD
    ├── .env.example                ← template de env vars
    ├── .eslint-rules/              ← ESLint custom rule anti-data-leak
    ├── scripts/
    │   └── postgres/init-readonly.sql
    └── src/
        ├── app/                    ← Next.js App Router
        ├── components/             ← shadcn/ui + custom
        ├── lib/                    ← utilities
        │   ├── env.ts              ← Zod validation
        │   ├── logger.ts           ← Pino con redaction
        │   ├── redact.ts           ← API key redaction
        │   ├── cn.ts
        │   └── security/           ← T1-T8 del threat model
        │       ├── encryption.ts   ← AES-256-GCM BYOK
        │       ├── validate-query.ts ← SQL injection prevention
        │       └── validate-connection.ts ← SSRF prevention
        ├── db/                     ← Drizzle
        │   ├── schema.ts           ← 11 tablas
        │   ├── client.ts           ← withOrgContext() wrapper
        │   └── rls.ts              ← RLS policies
        ├── hooks/                  ← (vacío)
        ├── stores/                 ← Zustand stores
        └── types/
    └── tests/
        ├── security/               ← P0 tests del threat model
        │   ├── sql-injection.test.ts
        │   ├── ssrf.test.ts
        │   └── encryption.test.ts
        ├── unit/                   ← Unit tests
        │   ├── redact.test.ts
        │   └── env.test.ts
        └── e2e/                    ← Playwright (vacío por ahora)
```

## Status actual

**Semana 0 (pre-implementación):**

- [x] Specs escritos (11 specs + 4 docs arquitectura + 2 research)
- [x] Auditorías hechas (arquitectura + stack)
- [x] Threat model + 10 controles de seguridad
- [x] Scaffolding de Next.js 16 + configs
- [x] Schema Drizzle (11 tablas)
- [x] `withOrgContext()` wrapper + ESLint rule anti-data-leak
- [x] Security utilities (encryption, validate-query, validate-connection)
- [x] Tests de seguridad críticos (P0 del threat model)
- [x] Docker Compose (Postgres + Redis + app + PDF worker)
- [x] CI/CD (lint + typecheck + unit + security + e2e + audit)
- [x] Logger con redaction (Pino)
- [x] Env validation (Zod)
- [x] Sentry setup (client + server + edge)
- [x] README del repo

**Próximo paso: Semana 1 — Foundation**

- [ ] Auth (better-auth: magic links + Google OAuth + email verification)
- [ ] Drizzle migrations + RLS setup script
- [ ] UI completa (shadcn/ui setup + 2 themes)
- [ ] EmailProvider + Resend adapter
- [ ] Signup/Login/Logout pages
- [ ] Multi-tenant context (org switcher)

## Cómo arrancar

```bash
cd app/
cp .env.example .env.local
# Editar .env.local con valores reales (openssl rand -hex 32 para secrets)

docker compose up -d postgres redis
pnpm install
pnpm db:migrate
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

**Sin GitHub todavía (per usuario).** Repo local listo para subir cuando el usuario dé OK.