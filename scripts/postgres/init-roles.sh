#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Crea los roles de Postgres para dash-bi. HIGH-5.
#
# Por qué este archivo existe
# --------------------------
# El compose usaba POSTGRES_USER como rol de la app. Ese rol lo crea la imagen
# oficial de Postgres como SUPERUSER, y un superuser ignora RLS por completo,
# aunque la tabla tenga ENABLE + FORCE ROW LEVEL SECURITY. Verificado el
# 2026-09-30 contra una DB real: con el contexto seteado a la org A, la query
# devolvía también los dashboards de la org B.
#
# Y no se arregla con `ALTER ROLE dashbi NOSUPERUSER`: PostgreSQL 15+ protege
# al bootstrap superuser y responde
#   ERROR:  permission denied to alter role
#   DETAIL: The bootstrap user must have the SUPERUSER attribute.
# ni siquiera desde otro superuser. La única salida es que el rol de la app
# deje de ser el bootstrap, que es lo que hace este script.
#
# Tres roles, con responsabilidades separadas:
#
#   POSTGRES_USER      owner/migrations. Superuser. Corre drizzle-kit.
#                      Dueño de las tablas, así que el rol de la app recibe
#                      GRANTs explícitos sobre ellas (RLS filtra filas; GRANT
#                      decide si podés tocar la tabla).
#   app_user           la app. NOSUPERUSER NOBYPASSRLS. Acá sí aplica RLS.
#   dashbi_readonly    SQL generado por la IA. Solo SELECT.
#
# Este script corre una sola vez, cuando la imagen oficial inicializa el data
# directory. Cambiar los passwords después no lo re-dispara: hay que hacerlo a
# mano con ALTER ROLE.
#
# Nota de implementación: los CREATE ROLE no van dentro de bloques `$$ … $$`
# porque psql NO interpola `:'var'` dentro de dollar-quoting — el servidor se
# come el `:` y responde `syntax error at or near ":"`. Por eso la
# idempotencia se resuelve preguntando primero desde bash.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

: "${POSTGRES_DB:?POSTGRES_DB required}"
: "${POSTGRES_APP_USER:?POSTGRES_APP_USER required}"
: "${POSTGRES_APP_PASSWORD:?POSTGRES_APP_PASSWORD required}"
: "${POSTGRES_READONLY_USER:=dashbi_readonly}"
: "${POSTGRES_READONLY_PASSWORD:?POSTGRES_READONLY_PASSWORD required}"

psql_run() {
  psql -v ON_ERROR_STOP=1 \
       --username "$POSTGRES_USER" \
       --dbname "$POSTGRES_DB" \
       -v app_user="$POSTGRES_APP_USER" \
       -v app_password="$POSTGRES_APP_PASSWORD" \
       -v readonly_user="$POSTGRES_READONLY_USER" \
       -v readonly_password="$POSTGRES_READONLY_PASSWORD" \
       -v db="$POSTGRES_DB" \
       "$@"
}

# ── Rol de la app ────────────────────────────────────────────────────────────
# NOSUPERUSER + NOBYPASSRLS es el punto de todo esto. Con cualquiera de los dos
# en true, RLS no filtra nada.
if [ -z "$(psql_run -tAc 'SELECT 1 FROM pg_roles WHERE rolname = :'"'"'app_user'"'"';')" ]; then
  psql_run <<'EOSQL'
CREATE ROLE :"app_user" LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD :'app_password';
EOSQL
fi

# ── Rol read-only para el SQL que genera la IA ───────────────────────────────
if [ -z "$(psql_run -tAc 'SELECT 1 FROM pg_roles WHERE rolname = :'"'"'readonly_user'"'"';')" ]; then
  psql_run <<'EOSQL'
CREATE ROLE :"readonly_user" LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD :'readonly_password';
EOSQL
fi

# ── Grants ───────────────────────────────────────────────────────────────────
# CONNECT: entrar a la base.
# CREATE en la base: el connector de archivos crea un schema por org
#   (CREATE SCHEMA "org_<id>") y después sus propias tablas, que puede
#   habilitarle RLS porque es su owner. DDL no pasa por RLS.
psql_run <<'EOSQL'
GRANT CONNECT, CREATE ON DATABASE :"db" TO :"app_user";
GRANT CONNECT ON DATABASE :"db" TO :"readonly_user";

GRANT USAGE, CREATE ON SCHEMA public TO :"app_user";
GRANT USAGE ON SCHEMA public TO :"readonly_user";

-- DML, no DDL: la app no es owner de las tablas, las crea el rol de migrations.
-- FORCE RLS aplica igual al owner, así que estas tablas quedan protegidas.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO :"app_user";
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO :"app_user";
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"app_user";
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO :"app_user";

-- La IA solo lee.
GRANT SELECT ON ALL TABLES IN SCHEMA public TO :"readonly_user";
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO :"readonly_user";
EOSQL

echo "roles listos: ${POSTGRES_APP_USER} (NOSUPERUSER NOBYPASSRLS), ${POSTGRES_READONLY_USER} (solo SELECT)"
