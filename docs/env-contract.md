# env-contract — variables de entorno canónicas de dash-bi

> Single source of truth para todas las variables de entorno de la app.
> Cualquier spec o `app/.env.example` debe referenciar este documento.

**Status:** v0.1 (sync 2026-07-27)
**Ubicación canónica:** `app/.env.example` (valores por defecto) + este doc (semántica).

---

## 1. Convención

- Todas las vars de servidor en **MAYÚSCULAS_CON_SNAKE_CASE**.
- Vars expuestas al cliente **deben** llevar prefijo `NEXT_PUBLIC_`.
- Cualquier secret (key, password, token) debe estar marcada como **REQUIRED** en dev y production.
- Rotación: las keys con sufijo `_V1`, `_V2`, ... se rotan sin downtime.

---

## 2. Tabla canónica

### Runtime

| Variable | Tipo | Default dev | REQUIRED | Notas |
|----------|------|-------------|----------|-------|
| `NODE_ENV` | enum | `development` | no | `development` \| `production` \| `test` |
| `NEXT_PUBLIC_APP_URL` | URL | `http://localhost:3000` | no | URL pública del front (deep links, emails) |
| `LOG_LEVEL` | enum | `info` | no | `trace` \| `debug` \| `info` \| `warn` \| `error` |
| `PORT` | int | `3000` | no | Puerto HTTP del server |

### Database

| Variable | Tipo | Default dev | REQUIRED | Notas |
|----------|------|-------------|----------|-------|
| `DATABASE_URL` | URL | `postgresql://dashbi:changeme@localhost:5432/dashbi` | sí (prod) | Conexión app role con DDL/DML limitados |
| `DATABASE_READONLY_URL` | URL | `postgresql://dashbi_readonly:changeme@localhost:5432/dashbi` | sí (prod) | Conexión usada por AI queries (defense in depth, threat T2) |
| `POSTGRES_DB` / `POSTGRES_USER` / `POSTGRES_PASSWORD` | string | dev defaults | sí (prod) | Bootstrap del container |
| `POSTGRES_READONLY_USER` / `POSTGRES_READONLY_PASSWORD` | string | dev defaults | sí (prod) | Usuario sin permisos DML/DDL |
| `POSTGRES_PORT` | int | `5432` | no | |

### Redis

| Variable | Tipo | Default dev | REQUIRED | Notas |
|----------|------|-------------|----------|-------|
| `REDIS_URL` | URL | `redis://localhost:6379` | sí (prod) | Cache + BullMQ |
| `REDIS_PORT` | int | `6379` | no | |

### Auth (better-auth)

| Variable | Tipo | Default dev | REQUIRED | Notas |
|----------|------|-------------|----------|-------|
| `BETTER_AUTH_SECRET` | hex 64 chars | dev placeholder | sí (prod) | `openssl rand -hex 32` |
| `BETTER_AUTH_URL` | URL | `http://localhost:3000` | sí (prod) | |

### Google OAuth (Sheets connector)

| Variable | Tipo | REQUIRED | Notas |
|----------|------|----------|-------|
| `GOOGLE_CLIENT_ID` | string | sí (Sheets) | https://console.cloud.google.com/apis/credentials |
| `GOOGLE_CLIENT_SECRET` | string | sí (Sheets) | |
| `GOOGLE_REDIRECT_URI` | URL | sí (Sheets) | `${NEXT_PUBLIC_APP_URL}/api/auth/google/callback` |

### Email

| Variable | Tipo | Default dev | REQUIRED | Notas |
|----------|------|-------------|----------|-------|
| `EMAIL_PROVIDER` | enum | `resend` | no | `resend` \| `mock` (dev/test) |
| `RESEND_API_KEY` | string | empty | sí (prod) | |
| `EMAIL_FROM` | RFC 5322 | `dash-bi <noreply@dash-bi.com>` | sí (prod) | |

### Encryption / BYOK

| Variable | Tipo | REQUIRED | Notas |
|----------|------|----------|-------|
| `LLM_KEY_ENCRYPTION_KEY` | hex 64 chars | sí (prod) | AES-256-GCM master key. `openssl rand -hex 32`. Cifra API keys LLM **y** credenciales de data sources (ver T4 + `specs/connectors.md §3`). |
| `LLM_KEY_ENCRYPTION_KEY_V1` | hex 64 chars | no (Fase 2) | Rotación. Si está presente, decrypt intenta V1 → V2. |
| `LLM_KEY_ENCRYPTION_KEY_V2` | hex 64 chars | no (Fase 2) | Key activa actual. |

**Estado MVP:** solo `LLM_KEY_ENCRYPTION_KEY` está implementado. Key versioning (`_V1`/`_V2`) está en `specs/deployment.md §rotation` pero no implementado aún. **No documentar** las `_V1`/`_V2` como funcionales hasta que se implemente.

### LLM providers (BYOK)

| Variable | Tipo | REQUIRED | Notas |
|----------|------|----------|-------|
| `OPENAI_API_KEY` | string | sí si se usa OpenAI | Fallback solo si no hay BYOK por org |
| `ANTHROPIC_API_KEY` | string | sí si se usa Anthropic | Fallback solo si no hay BYOK por org |
| `GOOGLE_GENERATIVE_AI_API_KEY` | string | sí si se usa Gemini | Fallback solo si no hay BYOK por org |

> **MODEL_COSTS — discrepancia corregida:** el spec `multi-llm-router.md` menciona `MODEL_COSTS` "env var" pero la implementación actual (`app/src/lib/ai/types.ts:21`) lo define **hardcoded** como constante TS. No usar env var hasta que se implemente la carga desde env. Si en el futuro se carga desde env, el nombre canónico será `MODEL_COSTS_JSON` (JSON string con el mismo shape).

### PDF worker

| Variable | Tipo | Default dev | REQUIRED | Notas |
|----------|------|-------------|----------|-------|
| `PDF_WORKER_URL` | URL | `http://pdf-worker:3001` | sí (prod) | URL del worker Puppeteer (threat T8) |
| `PDF_WORKER_SECRET` | string ≥ 16 chars | dev placeholder | sí (prod) | Shared secret app ↔ worker |
| `PUPPETEER_TIMEOUT_MS` | int | `30000` | no | Timeout por export |
| `PUPPETEER_MAX_CONCURRENT` | int | `3` | no | Concurrencia máxima de la queue |

### Monitoring

| Variable | Tipo | REQUIRED | Notas |
|----------|------|----------|-------|
| `SENTRY_DSN` | URL | no (dev) / sí (prod) | |
| `SENTRY_ENVIRONMENT` | string | no | `development` \| `production` \| `preview` |

### Docker

| Variable | Tipo | Default | Notas |
|----------|------|---------|-------|
| `APP_PORT` | int | `3000` | Host port mapeado |
| `DOCKER_TARGET` | enum | `production` | `production` \| `development` para multi-stage build |

---

## 3. Reglas de redacción

- **Nunca** loguear valores de variables secretas. La lista de nombres redactados está en `app/src/lib/logger.ts:22`.
- **Nunca** commitear `.env.local` ni `.env` (`.gitignore` lo cubre).
- En CI, validar con `app/src/lib/env.ts` (Zod schema) al boot — la app falla loud si falta una var `REQUIRED` en prod.

---

## 4. Cambios de contrato

Cualquier cambio (alta, baja, rename, default) requiere:

1. Editar este doc.
2. Editar `app/.env.example` en el mismo PR.
3. Actualizar `app/src/lib/env.ts` (Zod) si se agrega validación.
4. Bump `SPEC.md` a `v0.x` si el cambio afecta a un spec público.
