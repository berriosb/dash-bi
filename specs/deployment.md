# Spec: Deployment & Operations

> Estrategia de deploy, operación, y troubleshooting para dash-bi. Único target MVP: Docker Compose single-node + worker PDF service separado. Cierra el gap **HIGH** marcado por `docs/audits/2026-07-21-arquitectura/STACK-AUDIT.md` §A7.

**Status:** Draft v0.1
**Prioridad:** P0 — sin esto el producto no se deploya en serio
**Responsable:** codehak
**Depende de:** toda la app (transversal)

---

## Cambios respecto a v0.1

> Primera versión. Cierra gap del audit §A7.

---

## 1. Objetivo

Que cualquier operador pueda:

1. **Levantar dash-bi** en un VPS de ~4GB RAM con `git clone && docker compose up -d`
2. **Hacer backup** diario de Postgres y restaurar en <10 minutos
3. **Rotar secrets** (master key, API keys LLM, OAuth secrets) sin downtime
4. **Monitorear salud** con healthchecks y métricas básicas
5. **Actualizar** a una nueva versión sin perder data
6. **Diagnosticar** problemas comunes vía logs estructurados

---

## 2. Topología

### 2.1 Servicios Docker Compose

```
┌────────────────────────────────────────────────────────────────┐
│ HOST (Docker Compose, single-node)                              │
│                                                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │
│  │   app       │  │ pdf-worker  │  │  postgres   │            │
│  │ Next.js 16  │  │ Puppeteer   │  │     16      │            │
│  │ Port 3000   │  │ (no port)   │  │ Port 5432   │            │
│  │ ~512MB      │  │ ~2GB        │  │ ~512MB      │            │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘            │
│         │                │                │                    │
│         └────────────────┼────────────────┘                    │
│                          │                                     │
│                   ┌──────┴──────┐                              │
│                   │   redis     │                              │
│                   │ (cache/queue)                              │
│                   │ Port 6379   │                              │
│                   └─────────────┘                              │
│                                                                 │
│  Volumes:                                                       │
│    pgdata    → /var/lib/postgresql/data                        │
│    exports   → /var/lib/dash-bi/exports                        │
│    uploads   → /var/lib/dash-bi/uploads (Fase 2)               │
│    redis-data → /var/lib/redis/data                            │
│                                                                 │
└────────────────────────────────────────────────────────────────┘
```

### 2.2 Recursos mínimos / recomendados

| Plan | CPU | RAM | Disco | Uso |
|------|-----|-----|-------|-----|
| **Mínimo** | 2 cores | 4 GB | 40 GB SSD | 1-10 orgs activas |
| **Recomendado** | 4 cores | 8 GB | 100 GB SSD | 10-50 orgs activas |
| **Producción pequeña** | 4 cores | 16 GB | 200 GB SSD | 50-200 orgs activas |

**Notas:**
- Postgres consume ~50MB por org (con demo data + queries cached)
- `exports/` crece ~1-5MB por PDF, retention 30 días
- Redis cache ~50MB típicamente, hasta 500MB en load alto

---

## 3. Docker Compose definitivo

### 3.1 `docker-compose.yml`

```yaml
version: '3.9'

services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
    image: dashbi/app:${VERSION:-latest}
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - DATABASE_URL=postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}
      - REDIS_HOST=redis
      - REDIS_PORT=6379
      - LLM_KEY_ENCRYPTION_KEY=${LLM_KEY_ENCRYPTION_KEY}  # OBLIGATORIO, 32 bytes hex
      - EMAIL_PROVIDER=${EMAIL_PROVIDER:-resend}
      - RESEND_API_KEY=${RESEND_API_KEY}
      - EMAIL_FROM=${EMAIL_FROM:-noreply@dash-bi.com}
      - GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID}
      - GOOGLE_CLIENT_SECRET=${GOOGLE_CLIENT_SECRET}
      - SENTRY_DSN=${SENTRY_DSN}
      - NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL}
      - LOG_LEVEL=${LOG_LEVEL:-info}
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:3000/api/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 1G
        reservations:
          cpus: '0.5'
          memory: 512M
    networks: [dashbi]
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "5"

  pdf-worker:
    build:
      context: .
      dockerfile: Dockerfile.worker
    image: dashbi/pdf-worker:${VERSION:-latest}
    restart: unless-stopped
    environment:
      - NODE_ENV=production
      - REDIS_HOST=redis
      - REDIS_PORT=6379
      - EXPORTS_DIR=/var/lib/dash-bi/exports
    depends_on:
      redis:
        condition: service_healthy
    volumes:
      - exports:/var/lib/dash-bi/exports
    healthcheck:
      test: ["CMD", "node", "-e", "process.exit(0)"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 20s
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 2G
        reservations:
          cpus: '0.5'
          memory: 512M
    networks: [dashbi]
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"

  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    ports:
      - "5432:5432"
    environment:
      - POSTGRES_USER=${POSTGRES_USER:-dashbi}
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
      - POSTGRES_DB=${POSTGRES_DB:-dashbi}
      # READ-ONLY user para queries de IA (defense in depth)
      - POSTGRES_READONLY_USER=${POSTGRES_READONLY_USER:-dashbi_ro}
      - POSTGRES_READONLY_PASSWORD=${POSTGRES_READONLY_PASSWORD}
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./scripts/postgres/init-readonly.sql:/docker-entrypoint-initdb.d/00-init-readonly.sql:ro
    command: >
      postgres
        -c shared_buffers=256MB
        -c max_connections=200
        -c log_statement=none
        -c log_min_duration_statement=1000
        -c statement_timeout=30000
        -c ssl=on
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-dashbi} -d ${POSTGRES_DB:-dashbi}"]
      interval: 10s
      timeout: 5s
      retries: 5
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 1G
    networks: [dashbi]
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "5"

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    ports:
      - "6379:6379"
    command: >
      redis-server
        --maxmemory 512mb
        --maxmemory-policy allkeys-lru
        --appendonly yes
        --requirepass ${REDIS_PASSWORD}
    volumes:
      - redis-data:/var/lib/redis/data
    healthcheck:
      test: ["CMD", "redis-cli", "-a", "${REDIS_PASSWORD}", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
    deploy:
      resources:
        limits:
          cpus: '1'
          memory: 600M
    networks: [dashbi]
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"

volumes:
  pgdata:
  exports:
  redis-data:

networks:
  dashbi:
    driver: bridge
```

### 3.2 `Dockerfile` (app principal)

```dockerfile
# Multi-stage build para minimizar tamaño
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile --prod

FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup -g 1001 -S nodejs && adduser -S dashbi -u 1001
COPY --from=builder --chown=dashbi:nodejs /app/.next/standalone ./
COPY --from=builder --chown=dashbi:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=dashbi:nodejs /app/public ./public

USER dashbi
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

CMD ["node", "server.js"]
```

### 3.3 `Dockerfile.worker` (Puppeteer PDF)

```dockerfile
FROM node:22-bookworm-slim

# Chromium dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    fonts-noto-color-emoji \
    libgbm1 \
    libnss3 \
    libatk-bridge2.0-0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libxkbcommon0 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2 \
  && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    NODE_ENV=production

WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile --prod
COPY pdf-worker/ ./

USER node
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "process.exit(0)"

CMD ["node", "server.js"]
```

### 3.4 `scripts/postgres/init-readonly.sql`

```sql
-- Crea usuario read-only para queries generadas por IA (defense in depth)
-- Se ejecuta una vez al primer start del contenedor

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = :'READONLY_USER') THEN
    EXECUTE format('CREATE ROLE %I WITH LOGIN PASSWORD %L', :'READONLY_USER', :'READONLY_PASSWORD');
  END IF;
END
$$;

-- Permisos: solo SELECT en tablas tenant-scoped (NO en tablas de sistema)
GRANT CONNECT ON DATABASE :"DB_NAME" TO :"READONLY_USER";
GRANT USAGE ON SCHEMA public TO :"READONLY_USER";
GRANT SELECT ON ALL TABLES IN SCHEMA public TO :"READONLY_USER";
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO :"READONLY_USER";

-- IMPORTANTE: NO grant a information_schema, pg_catalog (auto-restricted)
```

---

## 4. Configuración y secrets

### 4.1 Variables de entorno (`.env.example`)

```bash
# ============ OBLIGATORIAS ============

# PostgreSQL (generar password fuerte: openssl rand -base64 32)
POSTGRES_USER=dashbi
POSTGRES_PASSWORD=__REQUIRED__
POSTGRES_DB=dashbi
POSTGRES_READONLY_USER=dashbi_ro
POSTGRES_READONLY_PASSWORD=__REQUIRED__

# Redis (generar password fuerte: openssl rand -base64 32)
REDIS_PASSWORD=__REQUIRED__

# Master key para cifrado de API keys LLM y credenciales de data sources
# GENERAR: openssl rand -hex 32
LLM_KEY_ENCRYPTION_KEY=__REQUIRED_HEX_32_BYTES__

# URL pública (sin trailing slash)
NEXT_PUBLIC_APP_URL=https://bi.example.com

# Email (magic links, verificaciones)
EMAIL_FROM=noreply@dashbi.com
EMAIL_PROVIDER=resend
RESEND_API_KEY=__REQUIRED__

# Google OAuth (para Sheets connector)
GOOGLE_CLIENT_ID=__OAUTH__
GOOGLE_CLIENT_SECRET=__OAUTH__

# ============ OPCIONALES ============

# Versión de la imagen Docker (tag, no latest en prod)
VERSION=v0.1.0

# Sentry (errors + performance)
SENTRY_DSN=

# Log level: trace | debug | info | warn | error
LOG_LEVEL=info
```

### 4.2 Secrets management

**MVP: archivos `.env` en el host + permisos restrictivos.**

```bash
chmod 600 .env
chown root:root .env
# .env en .gitignore (sí lo está por default)
```

**Fase 2 (recomendado para producción):**
- Docker Swarm Secrets
- AWS Secrets Manager + ECS task definitions
- HashiCorp Vault

**Rotación de `LLM_KEY_ENCRYPTION_KEY`:**

1. Generar nueva key: `openssl rand -hex 32`
2. **Key versioning:** mantener la key vieja + la nueva simultáneamente por 30 días
3. Script de re-cifrado que lee con key vieja y reescribe con key nueva (`lib/security/encryption.ts` interface con `keyVersion`)
4. Después de 30 días, eliminar key vieja

```typescript
// lib/security/encryption.ts (key versioning)
const KEYS: Record<number, Buffer> = {
  1: Buffer.from(process.env.LLM_KEY_ENCRYPTION_KEY_V1!, 'hex'),
  2: Buffer.from(process.env.LLM_KEY_ENCRYPTION_KEY_V2!, 'hex'),
};

export function encryptApiKey(plaintext: string, version = 2): string {
  const key = KEYS[version];
  // ... AES-256-GCM con `key`
  return Buffer.concat([versionBuffer, iv, authTag, encrypted]).toString('base64');
}

export function decryptApiKey(ciphertext: string): string {
  const version = ciphertext.subarray(0, 1).readUInt8();
  const key = KEYS[version];
  // ... descifra con la key correspondiente
}
```

---

## 5. Backup y restore

### 5.1 Backup diario automatizado

**Cron job en el host** (no dentro del contenedor):

```bash
# /etc/cron.d/dashbi-backup
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

# Backup diario a las 03:00 UTC, retención 30 días
0 3 * * * dashbi bash -c 'docker compose exec -T postgres pg_dump -U $POSTGRES_USER -d $POSTGRES_DB -Fc > /var/backups/dashbi/$(date +\%Y\%m\%d).dump && find /var/backups/dashbi -mtime +30 -delete'
```

**Storage remoto (recomendado producción):**

```bash
# Subir a S3/R2 con lifecycle policy
aws s3 cp /var/backups/dashbi/$(date +%Y%m%d).dump s3://dashbi-backups/ --storage-class STANDARD_IA
```

### 5.2 Restore drill (probar una vez al mes)

```bash
# 1. Levantar Postgres temporal en otro puerto
docker run -d --name postgres-restore \
  -e POSTGRES_USER=dashbi \
  -e POSTGRES_PASSWORD=test \
  -e POSTGRES_DB=dashbi \
  -p 5433:5432 \
  postgres:16-alpine

# 2. Restaurar el último backup
docker exec -i postgres-restore pg_restore -U dashbi -d dashbi --clean --if-exists < /var/backups/dashbi/latest.dump

# 3. Verificar integridad
docker exec postgres-restore psql -U dashbi -d dashbi -c "SELECT count(*) FROM organizations;"
# esperado: > 0 si el backup tiene data

# 4. Limpiar
docker rm -f postgres-restore
```

### 5.3 Disaster recovery

**RPO (Recovery Point Objective):** 24 horas (backup diario).
**RTO (Recovery Time Objective):** 30 minutos (restore + verificación).

---

## 6. Healthchecks y readiness

### 6.1 `/api/health` endpoint

```typescript
// app/api/health/route.ts
import { db } from '@/lib/db/client';
import { redis } from '@/lib/cache/redis';

export async function GET() {
  const checks = {
    status: 'ok' as 'ok' | 'degraded' | 'down',
    timestamp: new Date().toISOString(),
    version: process.env.VERSION ?? 'dev',
    services: {
      postgres: { ok: false, latencyMs: null as number | null },
      redis: { ok: false, latencyMs: null as number | null },
    },
  };

  // Check Postgres
  const pgStart = Date.now();
  try {
    await db.execute(sql`SELECT 1 as ok`);
    checks.services.postgres = { ok: true, latencyMs: Date.now() - pgStart };
  } catch (err) {
    checks.status = 'down';
    checks.services.postgres = { ok: false, latencyMs: Date.now() - pgStart };
  }

  // Check Redis
  const redisStart = Date.now();
  try {
    await redis.ping();
    checks.services.redis = { ok: true, latencyMs: Date.now() - redisStart };
  } catch (err) {
    checks.services.redis = { ok: false, latencyMs: Date.now() - redisStart };
    if (checks.status === 'ok') checks.status = 'degraded';
  }

  const httpStatus = checks.status === 'ok' ? 200 : checks.status === 'degraded' ? 200 : 503;
  return Response.json(checks, { status: httpStatus });
}
```

### 6.2 Monitoring externo (recomendado)

**Opción A — Uptime monitoring (gratis/cheap):**
- [UptimeRobot](https://uptimerobot.com/) cada 5 min sobre `/api/health`
- Alerta vía email/Slack/PagerDuty si status ≠ 200

**Opción B — Prometheus + Grafana:**
- Endpoint `/metrics` con formato Prometheus (Fase 2)
- Grafana dashboard con latencia p50/p95/p99, error rate, cache hit rate

**Opción C — Solo logs (mínimo viable):**
- Logs estructurados (Pino JSON) → journald
- `journalctl -u docker-compose.service` para troubleshooting manual

---

## 7. Actualizaciones

### 7.1 Upgrade flow

```bash
# 1. Backup antes de upgrade (siempre)
docker compose exec -T postgres pg_dump -U $POSTGRES_USER -d $POSTGRES_DB -Fc > backup-pre-upgrade.dump

# 2. Pull nueva versión
export VERSION=v0.2.0
docker compose pull

# 3. Aplicar migrations (idempotente)
docker compose run --rm app pnpm drizzle-kit migrate

# 4. Restart con nueva imagen
docker compose up -d

# 5. Verificar health
sleep 10 && curl http://localhost:3000/api/health
```

### 7.2 Rollback

```bash
# Si algo sale mal, volver a versión anterior
export VERSION=v0.1.0
docker compose up -d

# Las migrations Drizzle son forward-only por default.
# Si la v0.2.0 incluye migration destructiva, hacer rollback MANUAL:
docker compose exec -T postgres psql -U $POSTGRES_USER -d $POSTGRES_DB -c "DROP TABLE IF EXISTS new_table;"
```

### 7.3 Política de migrations

- **Backward-compatible:** agregar columnas es OK, renombrar requiere migration en 2 pasos
- **Drizzle migrations** commiteadas a `db/migrations/`
- **CI gate:** `pnpm drizzle-kit check` antes de mergear PR que toque `db/schema.ts`
- **Pre-deploy:** migrations aplicadas ANTES de levantar nueva app (evita incompatibilidad)

---

## 8. Reverse proxy / TLS

### 8.1 Nginx config (production)

```nginx
# /etc/nginx/sites-available/dashbi
server {
    listen 80;
    server_name bi.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name bi.example.com;

    ssl_certificate /etc/letsencrypt/live/bi.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/bi.example.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers 'ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384';
    ssl_prefer_server_ciphers off;

    # HSTS
    add_header Strict-Transport-Security "max-age=63072000" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # CSP
    add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https://api.openai.com https://api.anthropic.com https://generativelanguage.googleapis.com; frame-ancestors 'none';" always;

    client_max_body_size 110M;  # para CSV/Excel uploads

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;

        proxy_read_timeout 60s;
        proxy_send_timeout 60s;
    }

    # PDF worker interno (NO expuesto públicamente)
    # Se accede solo desde la app Next.js
    location /pdf-internal {
        internal;
        proxy_pass http://pdf-worker:3001;
        proxy_read_timeout 60s;
    }

    # Healthcheck (sin auth, usado por monitoring)
    location = /api/health {
        proxy_pass http://localhost:3000;
        access_log off;
    }
}
```

### 8.2 Let's Encrypt

```bash
# Install
sudo apt install certbot python3-certbot-nginx

# Obtener cert
sudo certbot --nginx -d bi.example.com

# Auto-renewal (cron systemd ya incluido)
sudo systemctl status certbot.timer
```

---

## 9. Troubleshooting común

### 9.1 App no arranca

```bash
# Ver logs
docker compose logs app --tail=100

# Errores comunes:
# - "LLM_KEY_ENCRYPTION_KEY is required" → configurar .env
# - "Connection refused postgres" → verificar pgdata volume + healthcheck
# - "FATAL: role 'dashbi' does not exist" → reiniciar postgres (init scripts solo corren en primer start)
```

### 9.2 Postgres no arranca después de crash

```bash
# 1. Ver logs
docker compose logs postgres --tail=50

# 2. Si el volumen está corrupto, recovery
docker compose down
docker volume ls  # anotar pgdata name
docker run --rm -v dashbi_pgdata:/volume alpine sh -c "rm -rf /volume/pg_wal/*"
docker compose up -d postgres

# 3. Si nada funciona, restaurar desde backup
docker compose down -v  # ⚠️ BORRA el volumen
bash /etc/cron.d/dashbi-backup  # o restaurar manualmente
```

### 9.3 PDF generation falla

```bash
# 1. Ver logs del worker
docker compose logs pdf-worker --tail=50

# 2. Errores comunes:
# - "Could not find Chromium" → rebuild worker: docker compose build pdf-worker
# - "Job timeout" → aumentar timeout en pdf-worker, o reducir concurrencia
# - "Out of memory" → memoria del worker < 2GB, aumentar en docker-compose.yml

# 3. Probar manualmente
docker compose exec pdf-worker node -e "console.log(process.env.PUPPETEER_EXECUTABLE_PATH)"
# debería ser /usr/bin/chromium
```

### 9.4 Redis lleno / cache miss

```bash
# Ver uso de memoria
docker compose exec redis redis-cli -a $REDIS_PASSWORD INFO memory

# Limpiar cache (forzar re-fetch de queries)
docker compose exec redis redis-cli -a $REDIS_PASSWORD FLUSHDB

# Si persiste > 80% memoria, considerar:
# - Aumentar maxmemory en docker-compose.yml
# - Reducir TTL en query-engine (hoy default 60s)
```

### 9.5 LLM provider rate limit

```bash
# 1. Ver logs de error
docker compose logs app | grep -i "rate.limit"

# 2. Configurar fallback provider (multi-llm-router)
# Settings → AI Configuration → Fallback provider

# 3. Verificar uso en org
SELECT org_id, count(*), sum(cost_usd) 
FROM llm_usage 
WHERE created_at > now() - interval '1 hour'
GROUP BY org_id ORDER BY sum(cost_usd) DESC;
```

### 9.6 Disco lleno

```bash
# Ver uso por directorio
df -h
du -sh /var/lib/docker/volumes/* | sort -hr | head -10

# Limpiar exports viejos (>30 días)
find /var/lib/docker/volumes/dashbi_exports -name "*.pdf" -mtime +30 -delete

# Limpiar imágenes Docker dangling
docker image prune -f

# Limpiar logs antiguos
docker system prune --volumes=false
```

---

## 10. Roadmap Fase 3 — Deploy serverless

Cuando el producto esté validado:

- **Vercel + Neon Postgres + Upstash Redis** (sin Puppeteer)
- **PDF export con `@sparticuz/chromium`** en Lambda function
- **Cloudflare R2** para storage de PDFs (lifecycle 30 días)
- **Hyperdrive** para connection pooling entre Vercel y Postgres externo

Ver `docs/architecture.md` §"Deploy architecture" para el rationale.

---

## 11. Acceptance criteria

- [ ] `docker compose up -d` levanta los 4 servicios en <60 segundos
- [ ] `/api/health` retorna 200 con `services.postgres.ok: true` y `services.redis.ok: true`
- [ ] Backup diario automatizado vía cron, retención 30 días
- [ ] Restore drill probado (1 vez por mes) — RPO 24h, RTO 30min
- [ ] TLS con Let's Encrypt, HSTS habilitado, CSP header restrictivo
- [ ] Master key `LLM_KEY_ENCRYPTION_KEY` rotable con key versioning
- [ ] Nginx reverse proxy con rate limiting + headers de seguridad
- [ ] Upgrade documentado con backup pre-upgrade
- [ ] Rollback posible bajando a versión anterior
- [ ] Drizzle migrations son backward-compatible
- [ ] Logs estructurados (JSON) en todos los servicios
- [ ] Monitoring uptime configurado (UptimeRobot o equivalente)
- [ ] Troubleshooting doc cubre los 6 errores más comunes

---

## 12. Out of scope (MVP)

- ❌ Kubernetes / multi-node (Fase 3)
- ❌ Auto-scaling (Fase 3)
- ❌ HA / failover (Fase 3)
- ❌ Multi-region (Fase 3)
- ❌ CDN para assets estáticos (Fase 2)
- ❌ WAF / DDoS protection más allá de nginx básico (Fase 3)
- ❌ Log aggregation centralizado (Loki/Datadog) (Fase 2)
- ❌ APM distributed tracing (Sentry Performance / Honeycomb) (Fase 2)

---

## 13. Riesgos

| Riesgo | Mitigación |
|--------|-----------|
| Disco se llena (PDFs, logs, backups) | Cleanup jobs + alertas de disco >80% |
| Postgres corrupto tras crash | Backup verificado + WAL archiving + restore drill |
| Container se queda sin memoria (PDF worker) | `memory: 2G` limit + monitoring + alert |
| LLM provider caído | Fallback provider configurado (multi-llm-router) |
| TLS cert expira | Let's Encrypt auto-renew + monitoring |
| Upgrade rompe schema | Migrations backward-compatible + backup pre-upgrade |
| Secrets leak en logs | Pino redact + .env en .gitignore + permisos 600 |
| `LLM_KEY_ENCRYPTION_KEY` comprometida | Rotación con key versioning (sin downtime) |

---

## 14. Dependencias

```json
{
  "dependencies": {
    "@sentry/node": "^8.40.0",
    "pino": "^9.5.0",
    "pino-pretty": "^11.3.0",
    "dotenv": "^16.4.0"
  }
}
```

```yaml
# services externos (no npm)
postgres: 16-alpine
redis: 7-alpine
chromium: (en pdf-worker)
nginx: (reverse proxy, no docker)
```

---

## 15. Specs relacionados

- `docs/architecture.md` — topología general y decisiones de deploy
- `docs/IMPLEMENTATION-PLAN-v1.0.md` — week-by-week setup
- `multi-tenant.md` — RLS + DB user read-only
- `auth.md` — secrets de OAuth + magic links
- `multi-llm-router.md` — fallback provider config
- `export.md` — pdf-worker separado
- `email.md` — EmailProvider config
- `docs/security/threat-model.md` — controles transversales C3-C5
- `testing.md` — CI gates asumen Docker Compose levantable
