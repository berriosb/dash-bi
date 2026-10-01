-- Init script: crear read-only user para queries ejecutadas por IA
-- Defense in depth: aunque validateQuery() falle, este user no puede DROP/DELETE/etc.

-- Crear usuario read-only
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'dashbi_readonly') THEN
    CREATE ROLE dashbi_readonly NOLOGIN;
  END IF;
END
$$;

-- Dar permisos SELECT sobre todas las tablas existentes
GRANT USAGE ON SCHEMA public TO dashbi_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO dashbi_readonly;

-- Aplicar a tablas futuras (Drizzle genera migrations)
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO dashbi_readonly;

-- NO permitir: DML, DDL, escritura
-- (no GRANT INSERT/UPDATE/DELETE/DROP/CREATE/ALTER)
--
-- Tampoco se concede EXECUTE sobre funciones de lectura de archivos del
-- servidor (pg_read_file, pg_ls_dir, lo_import, ...) ni sobre las de egress
-- de red (dblink, pg_connect_backend). Conceder pg_read_file aquí convertía
-- una inyección de prompt en NLQA en lectura arbitraria de archivos del host
-- de Postgres. `validateQuery` (src/lib/security/validate-query.ts) también
-- las bloquea: esto es la segunda capa, no la única.