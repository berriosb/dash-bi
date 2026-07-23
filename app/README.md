# dash-bi

> Open source BI platform with AI-genera-dashboards. Self-hosted. Multi-LLM. Beautiful.

**Status:** Week 0 — pre-implementation. Specs ready, scaffolding in progress.

## What is dash-bi?

dash-bi is a business intelligence platform that lets you create dashboards by describing what you want to see in natural language. The AI generates the dashboard with **real data** from your connected sources (Postgres, Stripe, Google Sheets).

- 🤖 **AI-genera-dashboards** — "Show me revenue last 6 months" → dashboard in 5 seconds
- 🔌 **Multi-source** — Postgres, Stripe, Google Sheets (more coming)
- 🧠 **Multi-LLM** — Bring your own key: OpenAI, Anthropic, Gemini
- ✏️ **Manual editing** — Drag-and-drop, property panel, undo/redo (Notion-style)
- 🎨 **Beautiful by default** — Modern SaaS look, not legacy BI
- 📤 **Export** — PDF with branding, PNG, public links
- 🏠 **Self-hosted** — Docker Compose, your data stays home

## Stack

- **Frontend**: Next.js 16 + React 19.2 + TypeScript strict + Tailwind 4
- **UI**: shadcn/ui + Radix + Tremor
- **DB**: PostgreSQL 16 + Drizzle ORM
- **Auth**: better-auth (multi-tenant + magic links + Google OAuth)
- **AI**: Vercel AI SDK v6 (OpenAI, Anthropic, Gemini)
- **Drag-drop**: dnd-kit
- **State**: Zustand (UI) + TanStack Query (server)
- **PDF**: Puppeteer (separate worker service)
- **Monitoring**: Sentry + Pino + OpenTelemetry
- **Testing**: Vitest + Playwright + Testcontainers

## Quick start (local development)

```bash
# 1. Clone
git clone https://github.com/your-user/dash-bi.git
cd dash-bi/app

# 2. Install deps
pnpm install

# 3. Setup env
cp .env.example .env.local
# Edit .env.local: BETTER_AUTH_SECRET and LLM_KEY_ENCRYPTION_KEY (use openssl rand -hex 32)

# 4. Start services
docker compose up -d postgres redis

# 5. Migrate DB
pnpm db:migrate

# 6. Start app
pnpm dev
```

App runs at http://localhost:3000.

## Documentation

- [`../SPEC.md`](../SPEC.md) — Product specification (single source of truth)
- [`../docs/IMPLEMENTATION-PLAN-v1.0.md`](../docs/IMPLEMENTATION-PLAN-v1.0.md) — 6-week implementation plan
- [`../docs/security/threat-model.md`](../docs/security/threat-model.md) — Security threats and controls
- [`../specs/`](../specs/) — Detailed feature specs
- [`../docs/audits/`](../docs/audits/) — Architecture and stack audits

## Architecture

```
┌─────────────────────────────────────────────────┐
│  Docker Compose                                  │
│                                                  │
│  ┌──────────────┐    ┌──────────────┐           │
│  │  Next.js 16  │    │  PDF Worker   │           │
│  │  (app)       │←───│  (Puppeteer)  │           │
│  └──────┬───────┘    └──────────────┘           │
│         │                                        │
│         ↓                                        │
│  ┌──────────────┐    ┌──────────────┐           │
│  │ PostgreSQL 16│    │  Redis 7     │           │
│  │ (with RLS)   │    │  (cache/queue)│           │
│  └──────────────┘    └──────────────┘           │
└─────────────────────────────────────────────────┘
```

## Security

- **Multi-tenant isolation**: Row Level Security on all tables
- **Mandatory wrapper**: All API queries go through `withOrgContext()` (enforced by ESLint rule)
- **BYOK encryption**: API keys encrypted with AES-256-GCM, master key from env var
- **Read-only DB user**: Defense in depth — even if SQL injection bypasses validation, DB user can't DROP/DELETE
- **SQL validation**: All AI-generated queries pass through `validateQuery()` (blocks DML/DDL, stacked queries, missing LIMIT)
- **SSRF prevention**: Postgres host validation blocks localhost, AWS/GCP metadata, RFC1918 private IPs
- **Secret redaction**: Pino logger automatically redacts API keys in logs
- **Audit log**: Every important action tracked per org

See [`../docs/security/threat-model.md`](../docs/security/threat-model.md) for the full threat model.

## Testing

```bash
pnpm test           # Unit + security tests
pnpm test:watch     # Watch mode
pnpm test:security  # Security tests only (SQL injection, SSRF, encryption)
pnpm test:e2e       # E2E with Playwright
pnpm test:coverage  # Coverage report
```

## License

MIT