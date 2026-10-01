-- ─────────────────────────────────────────────────────────────────────────────
-- 0014 — Reemplaza el "bypass de RLS" implícito por funciones con nombre.
--
-- El problema
-- -----------
-- `withSystemContext()` en db/client.ts siempre fue `db.transaction(fn)` con un
-- comentario que decía "Bypassea RLS". No lo hacía. Funcionaba solo porque la
-- app conectaba como superuser (HIGH-5), y para un superuser RLS no aplica.
-- Corregido HIGH-5, quedó sujeto a RLS como cualquier otra cosa: sin GUC,
-- `app_current_org_id()` devuelve el UUID cero, así que un SELECT ve 0 filas y
-- un INSERT falla el WITH CHECK.
--
-- La mayoría de los call sites ya no lo usan (ver el guard en
-- tests/unit/db/system-context-usage.test.ts). Quedan cuatro que sí cruzan
-- orgs de verdad, y cada uno merece una capacidad con nombre, firma,
-- search_path pineado y un GRANT auditables — no un wrapper de transacción.
--
-- Seguridad de estas funciones
-- ----------------------------
--   SECURITY DEFINER          corre con los privilegios del owner (superuser),
--                             que es justamente lo que saltea RLS.
--   SET search_path           pineado. Sin esto, cualquiera con CREATE en
--                             public puede secuestrar una función y ejecutarla
--                             como superuser. Es el ataque clásico de
--                             SECURITY DEFINER.
--   REVOKE FROM PUBLIC        las funciones tienen EXECUTE para PUBLIC por
--                             defecto. Sin revocar, cualquier rol —incluido
--                             dashbi_readonly— podría llamarlas y saltarse
--                             RLS sin necesidad.
--   parámetros                $1/$2, nunca concatenación de texto.
--
-- Cada función es deliberadamente estrecha. Si alguna terminara necesitando
-- "más cosas", ese es el momento de replantearla, no de abrirle el alcance.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Reglas de alerta vencidas (dispatcher, corre cada minuto) ─────────────
-- Un worker de plataforma tiene que ver todas las orgs: no pertenece a
-- ninguna. Devuelve solo lo que el dispatcher necesita para encolar.
CREATE OR REPLACE FUNCTION dashbi_due_alert_rules()
RETURNS TABLE (
  id uuid,
  evaluation_interval_minutes integer,
  last_evaluated_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT r.id, r.evaluation_interval_minutes, r.last_evaluated_at
  FROM public.alert_rules r
  WHERE r.enabled
    AND (
      r.last_evaluated_at IS NULL
      OR r.last_evaluated_at + (r.evaluation_interval_minutes || ' minutes')::interval <= NOW()
    );
$$;

-- ── 2. Contar reglas habilitadas (helper de tests) ───────────────────────────
CREATE OR REPLACE FUNCTION dashbi_count_enabled_alert_rules()
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT count(*) FROM public.alert_rules WHERE enabled;
$$;

-- ── 3. Cargar una regla con el título de su dashboard (evaluator) ────────────
-- El evaluator recibe un id de regla de la cola, que no trae org. La función
-- devuelve la org junto con la regla para que el Evaluator pueda seguir
-- trabajando bajo `withOrgContext`.
-- Devuelve la fila completa como tipo compuesto en vez de enumerar columnas:
-- el evaluator usa casi todos los campos, y una lista explícita acá se
-- quedaría vieja en silencio la próxima vez que se agregue una columna.
CREATE OR REPLACE FUNCTION dashbi_load_alert_rule(p_rule_id uuid)
RETURNS TABLE (
  rule public.alert_rules,
  dashboard_title text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT r, d.title
  FROM public.alert_rules r
  JOIN public.dashboards d ON d.id = r.dashboard_id
  WHERE r.id = p_rule_id;
$$;

-- ── 4. Resolver un link público por token (sharing) ─────────────────────────
-- El token es la credencial. Nadie sabe la org hasta resolver el link, así que
-- este lookup no puede filtrar por org: eso es lo que lo hace público, y es
-- exactamente lo que hace segura la tabla (el token es aleatorio, y el
-- dashboard se carga después bajo `withOrgContext`).
CREATE OR REPLACE FUNCTION dashbi_resolve_public_link(p_token text)
RETURNS SETOF public.public_links
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT pl.*
  FROM public.public_links pl
  WHERE pl.token = p_token
  LIMIT 1;
$$;

-- ── Grants: solo los roles de la app, y explícitamente no PUBLIC ───────────
-- `REVOKE FROM PUBLIC` is the load-bearing statement: functions grant EXECUTE
-- to PUBLIC by default, and PUBLIC is not a role anyone can revoke itself
-- from. Without it, dashbi_readonly — the role AI-written SQL runs as — could
-- call these and read every tenant, which is the exact hole HIGH-5 closed.
--
-- The role list tolerates a missing member so the migration applies both to a
-- compose stack (where init-roles.sh has created POSTGRES_APP_USER) and to the
-- integration harness (which creates its own `dashbi`).
DO $$
DECLARE
  fn record;
  app_role text;
BEGIN
  FOREACH app_role IN ARRAY ARRAY['dashbi_app', 'dashbi'] LOOP
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = app_role) THEN
      CONTINUE;
    END IF;
    FOR fn IN
      SELECT p.oid::regprocedure AS sig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN (
          'dashbi_due_alert_rules',
          'dashbi_count_enabled_alert_rules',
          'dashbi_load_alert_rule',
          'dashbi_resolve_public_link'
        )
    LOOP
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn.sig);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %I', fn.sig, app_role);
    END LOOP;
  END LOOP;

  -- The role that runs the migration keeps access, so the setup helpers in
  -- db/rls.ts can still call them while provisioning.
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
END
$$;
