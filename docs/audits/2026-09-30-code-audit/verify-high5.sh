#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# HIGH-5 — ¿el rol con el que conecta la app es superuser?
#
# Si lo es, RLS no se aplica: un superuser ignora las policies aunque la tabla
# tenga ENABLE + FORCE ROW LEVEL SECURITY. Eso vuelve decorativa toda la capa
# de aislamiento multi-tenant (T1) y sube su severidad a CRITICAL.
#
# Uso:  ./verify-high5.sh          (desde la raíz del repo)
#
# No imprime ninguna credencial: deriva POSTGRES_* de app/.env.local y solo
# muestra atributos de rol.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
die() { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

# ── 1. Preflight ──────────────────────────────────────────────────────────────
say "1/5  Preflight"
command -v docker >/dev/null || die "docker no está instalado"
docker version --format '{{.Server.Version}}' >/dev/null 2>&1 \
  || die "no se puede hablar con el daemon de docker.
       Si dice 'permission denied': sudo usermod -aG docker \$USER  (y re-logueate)
       Si dice 'connection refused': sudo systemctl start docker"
echo "    docker $(docker version --format '{{.Client.Version}}') → daemon $(docker version --format '{{.Server.Version}}')"

# ── 2. Credenciales: derivarlas de app/.env.local si existe ───────────────────
say "2/5  Credenciales"
PG_USER= PG_PASS= PG_DB=
if [[ -f app/.env.local ]]; then
  # Extrae el userinfo de postgres://user:pass@host:port/db sin imprimirlo.
  url="$(grep -m1 '^DATABASE_URL=' app/.env.local | cut -d= -f2- || true)"
  if [[ -n "$url" ]]; then
    PG_USER="$(printf '%s' "$url" | sed -E 's#^postgres(ql)?://([^:@]*):?([^@]*)@.*#\2#')"
    PG_PASS="$(printf '%s' "$url" | sed -E 's#^postgres(ql)?://([^:@]*):?([^@]*)@.*#\3#')"
    PG_DB="$(printf '%s' "$url" | sed -E 's#^postgres(ql)?://[^@]*@[^/]*/([^?]*).*#\1#')"
    echo "    derivadas de app/.env.local (user=$PG_USER, db=$PG_DB)"
  fi
fi
: "${PG_USER:=dashbi}"
: "${PG_DB:=dashbi}"
: "${PG_PASS:=dashbi_local_dev_password}"
[[ -n "$PG_PASS" ]] || die "no pude obtener POSTGRES_PASSWORD"

# El compose usa ${VAR:?required}: sin esto aborta antes de levantar nada.
export POSTGRES_USER="$PG_USER" POSTGRES_PASSWORD="$PG_PASS" POSTGRES_DB="$PG_DB"
export POSTGRES_PORT=5432 POSTGRES_READONLY_USER="${POSTGRES_READONLY_USER:-dashbi_readonly}"
export POSTGRES_READONLY_PASSWORD="${POSTGRES_READONLY_PASSWORD:-dashbi_readonly_local_dev_password}"
# Vars no relacionadas que el compose también exige. Valores de relleno: este
# script solo levanta el servicio `postgres`, no la app.
export APP_PORT=3000 BETTER_AUTH_SECRET=verify-high5-local-only \
  BETTER_AUTH_URL=http://localhost:3000 NEXT_PUBLIC_APP_URL=http://localhost:3000 \
  LLM_KEY_ENCRYPTION_KEY=verify-high5-local-only-32-byte-key!!!! \
  PDF_WORKER_SECRET=verify-high5-local-only EMAIL_PROVIDER=mock EMAIL_FROM=verify@example.invalid \
  RESEND_API_KEY= LOG_LEVEL=info REDIS_PORT=6379 REDIS_PASSWORD=verify-high5-local-only

# ── 3. Levantar solo postgres ────────────────────────────────────────────────
say "3/5  Levantar postgres"
docker compose up -d postgres
for i in {1..30}; do
  if docker compose exec -T postgres pg_isready -q -U "$PG_USER" -d "$PG_DB" 2>/dev/null; then
    echo "    postgres listo (~$((i))s)"; break
  fi
  [[ $i -eq 30 ]] && die "postgres no respondió a tiempo"
  sleep 1
done

# ── 4. LA PREGUNTA ───────────────────────────────────────────────────────────
say "4/5  ¿La app conecta como superuser?"
q() { docker compose exec -T postgres psql -U "$PG_USER" -d "$PG_DB" -tAc "$1"; }

rolsuper="$(q "SELECT rolsuper FROM pg_roles WHERE rolname = current_user;")"
printf '    current_user = %s\n' "$(q 'SELECT current_user;')"
printf '    rolsuper     = %s\n' "$rolsuper"

say "    Estado de RLS por tabla"
q "SELECT relname||'  enable='||relrowsecurity||' force='||relforcerowsecurity
   FROM pg_class WHERE relkind='r' AND relnamespace='public'::regnamespace
   ORDER BY relname;" | sed 's/^/      /'

# ── 5. Veredicto ─────────────────────────────────────────────────────────────
say "5/5  Veredicto"
if [[ "$rolsuper" == "t" ]]; then
  cat <<'EOF'
    ⛔ HIGH-5 CONFIRMADO — T1 sube a CRITICAL.

    Un superuser ignora RLS por completo, aunque la tabla tenga
    ENABLE + FORCE ROW LEVEL SECURITY. Las policies que acabamos de
    escribir en la migración 0013 no se están aplicando.

    El fix NO es agregar más policies: es
      ALTER ROLE <rol_de_la_app> NOSUPERUSER;
    y mover el DDL (migraciones, CREATE TABLE del connector) a un rol
    con privilegios, como ya se hace con dashbi_readonly.
EOF
  exit 2
else
  cat <<'EOF'
    ✅ HIGH-5 DESCARTADO — la app NO es superuser.

    RLS se está aplicando de verdad. La severidad de T1 se queda en HIGH
    y la migración 0013 sí está protegiendo scheduled_reports.
EOF
fi
