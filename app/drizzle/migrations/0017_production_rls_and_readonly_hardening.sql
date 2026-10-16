-- ─────────────────────────────────────────────────────────────────────────────
-- 0017 — Endurecimiento de producción para RLS de org_members, helper de
--        reportes programados y revocación de tablas sensibles a dashbi_readonly.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. org_members: permitir lectura/escritura dentro de la org activa ───────
-- La policy 0004 solo permitía `user_id = current_user_id`, bloqueando a los
-- admins bajo `dashbi_app` (FORCE RLS) al listar otros miembros, invitar
-- usuarios (`targetUser.id != ctx.userId`) o actualizar/remover membresías.
DROP POLICY IF EXISTS "org_members_isolation" ON "org_members";
CREATE POLICY "org_members_isolation" ON "org_members"
  USING (
    user_id = COALESCE(
      NULLIF(current_setting('app.current_user_id', true), '')::uuid,
      '00000000-0000-0000-0000-000000000000'::uuid
    )
    OR org_id = app_current_org_id()
  )
  WITH CHECK (
    user_id = COALESCE(
      NULLIF(current_setting('app.current_user_id', true), '')::uuid,
      '00000000-0000-0000-0000-000000000000'::uuid
    )
    OR org_id = app_current_org_id()
  );

-- ── 2. Helper SECURITY DEFINER para reportes programados vencidos ────────────
-- El worker de plataforma (`processDueScheduledReports`) necesita consultar
-- reportes vencidos en todas las orgs antes de despachar cada corrida bajo
-- `withOrgContext(report.orgId, ...)`.
CREATE OR REPLACE FUNCTION dashbi_due_scheduled_reports(p_now timestamptz DEFAULT NOW())
RETURNS SETOF public.scheduled_reports
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT sr.*
  FROM public.scheduled_reports sr
  WHERE sr.enabled = true
    AND sr.next_run_at <= p_now;
$$;

-- ── 3. Grants incondicionales de REVOKE FROM PUBLIC para funciones dashbi_* ──
DO $$
DECLARE
  fn record;
  app_role text;
BEGIN
  -- Revocar de PUBLIC siempre, sin depender de que exista un rol específico
  FOR fn IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname LIKE 'dashbi\_%'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %I', fn.sig, current_user);
  END LOOP;

  FOREACH app_role IN ARRAY ARRAY['dashbi_app', 'dashbi'] LOOP
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = app_role) THEN
      CONTINUE;
    END IF;
    FOR fn IN
      SELECT p.oid::regprocedure AS sig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname LIKE 'dashbi\_%'
    LOOP
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %I', fn.sig, app_role);
    END LOOP;
  END LOOP;
END
$$;

-- ── 4. Revocar SELECT de dashbi_readonly sobre tablas internas de auth/sistema
DO $$
DECLARE
  tbl text;
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'dashbi_readonly') THEN
    FOREACH tbl IN ARRAY ARRAY[
      'users',
      'sessions',
      'accounts',
      'verifications',
      'data_sources',
      'public_links',
      'orgs',
      'org_members',
      'audit_log',
      'alert_rules'
    ] LOOP
      IF EXISTS (
        SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = tbl
      ) THEN
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM dashbi_readonly', tbl);
      END IF;
    END LOOP;
  END IF;
END
$$;
