-- ─────────────────────────────────────────────────────────────────────────────
-- 0019 — Revocar SELECT de dashbi_readonly sobre las tablas internas de tenant.
--
-- Por qué:
--
-- El rol `dashbi_readonly` existe para leer las tablas de upload por org, que
-- viven en un esquema por org (`org_<uuid>`) y NO en `public` — los GRANT de
-- la migración 0018 son los que le abren ese paso. Es el único rol que
-- ejecuta SQL generado por el usuario (SpreadsheetConnector, evaluador de
-- alertas).
--
-- Ese rol no tiene ningún motivo de negocio para leer las tablas internas de
-- dash-bi: `dashboards`, `dashboard_versions`, `llm_usage`,
-- `nlqa_conversations`, `nlqa_messages`, `scheduled_reports`,
-- `scheduled_report_runs`, `alert_events` y `uploaded_files` son datos de
-- tenants y de uso interno. La migración 0017 ya revocó SELECT sobre otras
-- diez tablas internas (auth, sesiones, `data_sources`, `orgs`, `org_members`,
-- `audit_log`, `alert_rules`); estas nueve se le quedaron fuera.
--
-- Con la revocación, una inyección SQL en el texto de una consulta de
-- usuario no puede exfiltrar las tablas internas aunque logra re-apuntar el
-- GUC `app.current_org_id` (el `set_config` que lo haría ya está bloqueado
-- en `validateQuery`). La aislamiento de tenant deja de depender de una
-- sola capa.
--
-- Idempotente: si el rol no existe (instalación sin el rol de solo lectura)
-- se omite con un NOTICE, y las tablas que no existan en esa instalación se
-- saltan una por una.
--
-- Además se revoca el DEFAULT PRIVILEGE del rol sobre `public`: el bootstrap
-- (`scripts/postgres/init-roles.sh`) lo concedía, y con él cada tabla interna
-- creada en el futuro volvía a ser legible por el rol que ejecuta SQL
-- generado por el usuario, sin que ninguna migración tuviera que revocarlo.
-- El propósito real del rol son las tablas de upload por org (esquemas
-- `org_*`), cuyo GRANT se aplica por tabla en cada commit.
-- ─────────────────────────────────────────────────────────────────────────────

DO $dashbi$
DECLARE
  tbl text;
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'dashbi_readonly') THEN
    RAISE NOTICE 'dashbi_readonly no existe; se omite la revocación de tablas internas';
    RETURN;
  END IF;

  -- Primero el default privilege: si la instalación tiene el bootstrap
  -- anterior, las tablas internas que se creen a partir de ahora quedarían
  -- legibles para el rol de solo lectura.
  EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE SELECT ON TABLES FROM dashbi_readonly';

  FOREACH tbl IN ARRAY ARRAY[
    'dashboards',
    'dashboard_versions',
    'llm_usage',
    'nlqa_conversations',
    'nlqa_messages',
    'scheduled_reports',
    'scheduled_report_runs',
    'alert_events',
    'uploaded_files'
  ] LOOP
    IF EXISTS (
      SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = tbl
    ) THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM dashbi_readonly', tbl);
    END IF;
  END LOOP;
END
$dashbi$;
