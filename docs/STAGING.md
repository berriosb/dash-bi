# Staging Runbook — dash-bi

> Operator-facing runbook for deploying dash-bi to a single-node staging
> VPS (4 GB RAM minimum, 8 GB recommended). Every step is copy-pasteable.
> For architectural rationale see `specs/deployment.md`; for the threat
> model see `docs/security/threat-model.md`.

**Owner:** codehak
**Last verified:** 2026-09-14
**Deploy topology:** Docker Compose (root `docker-compose.yml`) — Next.js
app on `:3000`, Puppeteer PDF worker (no public port), Postgres 16
(`:5432`), Redis 7 (`:6379`), all behind Nginx (TLS).

---

## 1. Prerequisites

| Resource     | Minimum       | Recommended    |
| ------------ | ------------- | -------------- |
| vCPU         | 2             | 4              |
| RAM          | 4 GB          | 8 GB           |
| Disk         | 40 GB SSD     | 100 GB SSD     |
| OS           | Ubuntu 24.04 LTS (or any systemd distro with Docker Engine ≥ 27) |
| Ports        | 22 (SSH), 80 + 443 (TLS), 3000 (internal) |
| DNS          | `A` record for `bi.<your-domain>` → VPS public IPv4 |

Docker Engine + Compose v2 installed:

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# log out and back in
docker --version          # ≥ 27.x
docker compose version    # ≥ v2.32
```

A domain you control (Let's Encrypt needs to reach `:80` for the
`http-01` challenge).

---

## 2. Bootstrap (first time)

### 2.1 Clone the repo

```bash
sudo mkdir -p /opt/dash-bi && sudo chown $USER:$USER /opt/dash-bi
cd /opt/dash-bi
git clone https://github.com/berriosb/dash-bi.git .
# Pin to a known-good tag, NOT main:
git checkout v0.1.0
```

### 2.2 Generate secrets

Each secret is generated locally, never stored in git. Run these once
and capture the output in your password manager. You will end up with
**six** distinct secrets — one per line below — and they are
**not interchangeable**.

```bash
# 1. POSTGRES_PASSWORD            — Postgres app role
openssl rand -base64 32
# 2. POSTGRES_READONLY_PASSWORD   — Postgres read-only role (AI queries)
openssl rand -base64 32
# 3. REDIS_PASSWORD               — Redis auth
openssl rand -base64 32
# 4. LLM_KEY_ENCRYPTION_KEY       — BYOK master key, 32 bytes hex (64 chars)
openssl rand -hex 32
# 5. BETTER_AUTH_SECRET           — session secret, 32 bytes hex
openssl rand -hex 32
# 6. PDF_WORKER_SECRET            — app↔worker shared secret, 16 bytes hex
openssl rand -hex 16
```

**Never reuse a secret across environments.** Each value below is
single-purpose; do not collapse them.

### 2.3 Write `/opt/dash-bi/.env.staging`

The repo ships a tracked template at `.env.staging.example`. Copy it,
substitute the placeholders, and lock the file down.

```bash
cp .env.staging.example .env.staging
chmod 600 .env.staging
chown root:root .env.staging
$EDITOR .env.staging

# Substitute every __PASTE_GENERATED__ / __YOUR_DOMAIN__ placeholder.
# After this, `grep -c __ .env.staging` must return 0 — if it returns
# anything, docker compose will refuse to start the stack.
sed -i "s|__YOUR_DOMAIN__|<your-real-domain>|g" .env.staging
```

The file is read by `docker compose` and by `scripts/smoke-staging.sh`.
Both refuse to start the stack if any of the `__PASTE_GENERATED__`
markers are still present — there are no insecure fallback defaults.

### 2.4 Run the staging smoke

This is the gate that proves the stack actually serves traffic before
you bolt Nginx + TLS on top of it.

```bash
set -a; source .env.staging; set +a
./scripts/smoke-staging.sh
```

Expected output (abbreviated):

```
[smoke-staging] Validating docker-compose.yml
[smoke-staging] Building image and starting stack
[smoke-staging] Polling http://localhost:3000/api/health (timeout=180s)
[smoke-staging] Health OK
[smoke-staging] Running @smoke Playwright spec
[smoke-staging] Smoke spec passed
```

If it fails, the script leaves the logs visible:

```bash
# Re-run with the stack kept up so you can poke at it:
KEEP_STACK=1 ./scripts/smoke-staging.sh
docker compose logs app --tail=200
docker compose logs pdf-worker --tail=100
docker compose down -v   # tear down before retrying
```

---

## 3. TLS + Nginx (production-shaped)

The Compose stack only exposes `:3000` on `localhost`. TLS termination
happens on the host with Nginx + Let's Encrypt.

### 3.1 Install Nginx + Certbot

```bash
sudo apt update && sudo apt install -y nginx certbot python3-certbot-nginx
sudo systemctl enable --now nginx
```

### 3.2 Site config

The repo ships a tracked drop-in at `deploy/nginx/dash-bi.conf`. Copy
it, substitute the `__YOUR_DOMAIN__` placeholder, and enable it.

```bash
sudo cp deploy/nginx/dash-bi.conf /etc/nginx/sites-available/dash-bi
sudo sed -i 's|__YOUR_DOMAIN__|<your-real-domain>|g' /etc/nginx/sites-available/dash-bi
sudo ln -s /etc/nginx/sites-available/dash-bi /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

The config listens on `80` (redirects to `443`), serves TLS 1.2/1.3,
sets HSTS + a strict CSP, and proxies to `localhost:3000`. The PDF
worker port (`3001`) is intentionally never proxied — it lives on the
internal `dashbi` Docker network.

### 3.3 Issue the cert

```bash
sudo certbot --nginx -d bi.<your-real-domain>
# Certbot installs a systemd timer for auto-renewal — verify it:
sudo systemctl status certbot.timer
```

---

## 4. Backups

### 4.1 Install the cron job

The repo ships a tracked drop-in at `deploy/cron/dashbi-backup`. Copy
it, substitute the `__REPO_PATH__` placeholder, and install.

```bash
sudo mkdir -p /var/backups/dashbi
sudo chown root:root /var/backups/dashbi
sudo chmod 700 /var/backups/dashbi
sudo install -m 644 /dev/null /etc/cron.d/dashbi-backup
sudo cp deploy/cron/dashbi-backup /etc/cron.d/dashbi-backup
sudo sed -i 's|__REPO_PATH__|/opt/dash-bi|g' /etc/cron.d/dashbi-backup
```

`scripts/backup.sh` is the canonical script. The cron runs on the host,
not inside a container, so it survives `docker compose down`.

### 4.2 Verify the first run

```bash
sudo bash /etc/cron.d/dashbi-backup
ls -lh /var/backups/dashbi/  # expect dashbi_YYYYMMDD_HHMMSS.dump
```

### 4.3 Off-host (recommended for prod)

Pipe the dump to S3/R2 once it's working locally:

```bash
# Inside the same cron line, after backup.sh:
aws s3 cp /var/backups/dashbi/$(date -u +%Y%m%d_%H%M%S).dump \
  s3://dashbi-staging-backups/ --storage-class STANDARD_IA
```

---

## 5. Restore drill (test monthly)

```bash
# 1. Spin up a throwaway Postgres on a different port
docker run -d --name pg-restore \
  -e POSTGRES_USER=dashbi -e POSTGRES_PASSWORD=test -e POSTGRES_DB=dashbi \
  -p 5433:5432 postgres:16-alpine

# 2. Restore the most recent dump
docker exec -i pg-restore pg_restore -U dashbi -d dashbi --clean --if-exists \
  < /var/backups/dashbi/$(ls -t /var/backups/dashbi/ | head -1)

# 3. Sanity-check
docker exec pg-restore psql -U dashbi -d dashbi -c "SELECT count(*) FROM organizations;"
# Expect > 0 if any orgs exist.

# 4. Tear down
docker rm -f pg-restore
```

**Acceptance:** restore completes in < 10 min (RTO), loses ≤ 24 h of
writes (RPO). Document the date and result in your incident log.

---

## 6. Upgrades

```bash
cd /opt/dash-bi
git fetch --tags
git checkout v0.2.0           # bump to target version

# 1. Back up first — ALWAYS, even for "trivial" version bumps
set -a; source .env.staging; set +a
docker compose exec -T postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc \
  > /var/backups/dashbi/pre-upgrade-$(date -u +%Y%m%d_%H%M%S).dump

# 2. Pull images + apply migrations (forward-compatible only — see CI gate)
docker compose pull
docker compose run --rm app pnpm drizzle-kit migrate

# 3. Restart with new image
docker compose up -d

# 4. Verify
sleep 10 && curl -fsS https://bi.<your-domain>/api/health | jq .
./scripts/smoke-staging.sh
```

---

## 7. Rollback

If the smoke fails after an upgrade:

```bash
cd /opt/dash-bi
git checkout v0.1.0            # back to previous known-good tag
docker compose up -d
./scripts/smoke-staging.sh
```

Migrations are forward-only. If `v0.2.0` shipped a destructive
migration, restore from `/var/backups/dashbi/pre-upgrade-*.dump` instead:

```bash
docker compose down
docker compose up -d postgres
docker compose exec -T postgres pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  --clean --if-exists < /var/backups/dashbi/pre-upgrade-*.dump
docker compose up -d
```

---

## 8. Monitoring

Minimum viable (free):

- **Uptime** — point UptimeRobot (or any HTTP checker) at
  `https://bi.<your-domain>/api/health`. Alert on non-200 for > 2 min.
- **Logs** — `journalctl -u docker` for system, `docker compose logs`
  for app/worker. Pino is JSON in production; pipe to your log
  aggregator when you outgrow local.
- **Disks** — `df -h` and `du -sh /var/lib/docker/volumes/*` weekly.
  Alert at 80%.

Nice to have (later):

- Prometheus + Grafana on a sibling host
- Sentry (set `SENTRY_DSN` in `.env.staging`)

---

## 9. Troubleshooting

See `specs/deployment.md` §9 for the long-form playbook. The six most
common staging failures:

| Symptom                              | First check                                                       |
| ------------------------------------ | ----------------------------------------------------------------- |
| `app` container exits immediately    | `docker compose logs app` — usually missing `LLM_KEY_ENCRYPTION_KEY` |
| `/api/health` returns 503            | Postgres/Redis not reachable from inside `app` — check `depends_on` |
| PDF worker OOM                       | Bump `pdf-worker` memory limit in `docker-compose.yml` to 3G      |
| Nginx 502 after restart              | `app` container still booting — `proxy_read_timeout` masked it    |
| Magic-link emails not delivered      | `RESEND_API_KEY` missing or wrong `EMAIL_FROM` domain unverified  |
| `LLM_KEY_ENCRYPTION_KEY` leaked      | Rotate immediately — see §10 below                               |

---

## 10. Rotating secrets

`LLM_KEY_ENCRYPTION_KEY` rotation requires key versioning (see
`specs/deployment.md` §4.2). Single-secret rotation (DB passwords,
Redis, etc.):

1. Generate new value with `openssl rand`.
2. Update `.env.staging`.
3. Restart only the affected service: `docker compose up -d postgres`
   (or `redis`, or `app`).
4. Verify `/api/health` and re-run `./scripts/smoke-staging.sh`.

For `BETTER_AUTH_SECRET`: rotating invalidates all sessions. Schedule
for a low-traffic window.

---

## 11. Handoff checklist

Before declaring staging "live":

- [ ] `docker compose ps` shows all 4 services healthy
- [ ] `curl https://bi.<your-domain>/api/health` returns 200 with
      `services.postgres.ok: true` and `services.redis.ok: true`
- [ ] `./scripts/smoke-staging.sh` passes
- [ ] TLS cert valid (`certbot certificates`)
- [ ] HSTS, CSP, X-Frame-Options headers present (`curl -I`)
- [ ] Cron backup installed and a real dump exists
- [ ] Restore drill executed against a throwaway DB
- [ ] Sentry DSN set (if using Sentry)
- [ ] DNS `A` record pointing to the VPS
- [ ] SSH hardening: key-only auth, fail2ban, non-standard port (optional)

---

## 12. References

- `specs/deployment.md` — full deployment spec (architecture, backups,
  TLS, troubleshooting)
- `docs/security/threat-model.md` — controls C1–C7 (multi-tenant RLS,
  AI SQL validation, SSRF, etc.)
- `scripts/backup.sh`, `scripts/restore.sh` — host-side backup tooling
- `scripts/smoke-staging.sh` — canonical smoke gate
- `.env.staging.example` — template for `/opt/dash-bi/.env.staging`
- `deploy/nginx/dash-bi.conf` — drop-in for `/etc/nginx/sites-available/dash-bi`
- `deploy/cron/dashbi-backup` — drop-in for `/etc/cron.d/dashbi-backup`
- `app/Dockerfile` + `app/Dockerfile.worker` — image build context
- `docker-compose.yml` (repo root) — production topology
- `app/docker-compose.yml` — local dev topology (NOT for staging)