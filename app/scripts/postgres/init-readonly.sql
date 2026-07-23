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

-- EXPLAIN permitido (útil para debugging de queries lentas)
GRANT EXECUTE ON FUNCTION pg_read_file(text) TO dashbi_readonly;

-- NO permitir: DML, DDL, escritura
-- (no GRANT INSERT/UPDATE/DELETE/DROP/CREATE/ALTER)