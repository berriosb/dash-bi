#!/usr/bin/env bash
set -euo pipefail

# scripts/smoke-staging.sh
#
# Brings up the production stack (root docker-compose.yml), waits for
# /api/health to return 200, runs the @smoke Playwright spec against the
# running container, then tears the stack down. On any failure, the
# trap prints the last 50 lines of the app logs so the run is debuggable
# from the CI artifact alone.
#
# Required env (no insecure fallbacks; the script aborts if any are
# missing — see the `Required secrets` check below):
#
#   POSTGRES_PASSWORD, POSTGRES_READONLY_PASSWORD
#   REDIS_PASSWORD
#   LLM_KEY_ENCRYPTION_KEY        (32 bytes hex)
#   BETTER_AUTH_SECRET            (>= 32 bytes hex)
#   PDF_WORKER_SECRET             (>= 16 bytes)
#
# Usage:
#   set -a; source .env.staging; set +a
#   ./scripts/smoke-staging.sh
#
# Useful overrides:
#   COMPOSE_FILE=other.yml        (default: docker-compose.yml at repo root)
#   HEALTH_TIMEOUT=300            (seconds to wait for /api/health)
#   KEEP_STACK=1                  (don't tear down on exit; for debugging)
#   SMOKE_CMD='pnpm test:e2e:smoke'  (override the smoke command)

# ── Configuration ────────────────────────────────────────────────────
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
HEALTH_URL="${HEALTH_URL:-http://localhost:3000/api/health}"
SMOKE_CMD="${SMOKE_CMD:-pnpm --filter app test:e2e:smoke}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-180}"
KEEP_STACK="${KEEP_STACK:-}"

# ── Logging helpers ─────────────────────────────────────────────────
log() { printf '\033[1;34m[smoke-staging]\033[0m %s\n' "$*"; }
err() { printf '\033[1;31m[smoke-staging]\033[0m %s\n' "$*" >&2; }

# ── --help (does not require secrets) ───────────────────────────────
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,30p' "$0"
  exit 0
fi

# ── Required secrets ────────────────────────────────────────────────
# We deliberately do NOT provide fallback defaults. The README's
# quickstart inherits insecure placeholder passwords via the root
# compose file; this script exists so the smoke gate never silently
# succeeds against a deploy that picked those up.
required_vars=(
  POSTGRES_PASSWORD
  POSTGRES_READONLY_PASSWORD
  REDIS_PASSWORD
  LLM_KEY_ENCRYPTION_KEY
  BETTER_AUTH_SECRET
  PDF_WORKER_SECRET
)
for v in "${required_vars[@]}"; do
  if [ -z "${!v:-}" ]; then
    err "Required env var $v is empty."
    err "Refusing to run with insecure defaults."
    err "Set it explicitly, e.g.  set -a; source .env.staging; set +a"
    exit 2
  fi
done

# ── Pre-flight: compose file is well-formed ─────────────────────────
if [ ! -f "$COMPOSE_FILE" ]; then
  err "Compose file not found: $COMPOSE_FILE (run from repo root)"
  exit 1
fi
log "Validating $COMPOSE_FILE"
docker compose -f "$COMPOSE_FILE" config --quiet

# ── Teardown on any failure ─────────────────────────────────────────
cleanup() {
  local code=$?
  if [ -n "${KEEP_STACK}" ]; then
    log "KEEP_STACK set; leaving stack running (exit=$code)"
    return
  fi
  log "Tearing down stack (exit=$code)"
  docker compose -f "$COMPOSE_FILE" down --remove-orphans --volumes || true
}
trap cleanup EXIT

# ── Bring up the production stack ───────────────────────────────────
log "Building image and starting stack"
docker compose -f "$COMPOSE_FILE" up -d --build

# ── Wait for /api/health to return 200 ──────────────────────────────
log "Polling $HEALTH_URL (timeout=${HEALTH_TIMEOUT}s)"
deadline=$((SECONDS + HEALTH_TIMEOUT))
until curl -fsS -o /dev/null "$HEALTH_URL"; do
  if [ "$SECONDS" -ge "$deadline" ]; then
    err "Health endpoint never returned 200 within ${HEALTH_TIMEOUT}s"
    err "--- last 50 lines of app logs ---"
    docker compose -f "$COMPOSE_FILE" logs app --tail=50 >&2 || true
    exit 1
  fi
  sleep 2
done
log "Health OK"

# ── Run @smoke Playwright spec against the container ────────────────
log "Running @smoke Playwright spec: $SMOKE_CMD"
PLAYWRIGHT_BASE_URL="${HEALTH_URL%/api/health}" $SMOKE_CMD

log "Smoke spec passed"