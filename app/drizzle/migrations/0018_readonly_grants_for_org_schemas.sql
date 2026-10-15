-- ─────────────────────────────────────────────────────────────────────────────
-- 0018 — Grant de lectura a dashbi_readonly sobre los esquemas por org.
--
-- Contexto: los archivos subidos (CSV/Excel) se materializan en un esquema
-- por org (`org_<uuid_sanitizado>`), fuera de `public`. Los GRANT de
-- `scripts/postgres/init-roles.sh` solo cubren
-- `GRANT SELECT ON ALL TABLES IN SCHEMA public`, así que el rol de solo
-- lectura no podía siquiera resolver el esquema.
--
-- Esto estaba oculto porque el SpreadsheetConnector ejecutaba el SQL del
-- usuario con el rol de la app, que sí tiene DML global. Al mover esa
-- ejecución a `dashbi_readonly` (el rol correcto: no puede leer `users`,
-- `sessions` ni `data_sources` de otros tenants), toda tabla de upload
-- existente en una instalación ya desplegada habría fallado con
-- `permission denied for schema`.
--
-- El nuevo flujo de commit (`buildReadOnlyGrantsSQL`) aplica el grant en
-- cada upload nuevo; esta migración lo cierra para las tablas que ya
-- existen. Idempotente.
-- ─────────────────────────────────────────────────────────────────────────────

DO $dashbi$
DECLARE
  org_schema text;
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'dashbi_readonly') THEN
    RAISE NOTICE 'dashbi_readonly no existe; se omite el grant de esquemas por org';
    RETURN;
  END IF;

  FOR org_schema IN
    SELECT nspname
    FROM pg_namespace
    WHERE nspname LIKE 'org\_%'
      AND nspname NOT LIKE 'pg\_%'
  LOOP
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO dashbi_readonly', org_schema);
    EXECUTE format(
      'GRANT SELECT ON ALL TABLES IN SCHEMA %I TO dashbi_readonly',
      org_schema
    );
  END LOOP;
END
$dashbi$;