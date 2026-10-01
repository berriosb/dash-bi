-- ─────────────────────────────────────────────────────────────────────────────
-- 0015 — RLS sobre `orgs`, por membresía.
--
-- Por qué no alcanza con `USING (id = app_current_org_id())`
-- -------------------------------------------------------
-- Medido el 2026-09-30 contra una DB real, no razonado. Con esa policy:
--
--   org switcher   ve 1 org en vez de N  → roto
--   signup          ERROR: new row violates row-level security policy
--   uniqueSlug      ve 0 orgs             → elige un slug tomado y el
--                                            INSERT falla por orgs_slug_idx
--
-- El signup falla por un detalle: el id de la org lo genera la base
-- (defaultRandom) y no se conoce hasta que la fila existe, así que
-- `USING (id = app_current_org_id())` no puede casar. El switcher falla
-- porque su `innerJoin(org_members)` ocurre DESPUÉS de que RLS ya filtró la
-- tabla `orgs`.
--
-- La policy correcta es por pertenencia, que requiere leer `org_members` desde
-- la policy. Y eso es recursivo: `org_members` tiene su propia RLS, así que una
-- policy que la consulte se dispararía a sí misma. De ahí el helper
-- SECURITY DEFINER — se ejecuta con los privilegios del owner, así que dentro
-- no aplica la RLS de org_members, y no hay recursión porque no consulta orgs.
--
-- El slug es un caso aparte: es una restricción GLOBAL, no por tenant. El
-- probe tiene que ver todos los orgs por definición, y un usuario nuevo no
-- pertenece a ninguno. Por eso `dashbi_slug_is_taken` también es SECURITY
-- DEFINER, y es un leak de una sola fila (existe/no existe) en vez de una
-- tabla.
--
-- Las policies van separadas por comando porque INSERT tiene una regla
-- distinta de SELECT/UPDATE: al crear una org todavía no hay fila en
-- org_members, así que exigir pertenencia rechazaría el alta.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── ¿El usuario de la sesión pertenece a esta org? ───────────────────────────
-- Reads the GUC directly rather than through a helper function: there is no
-- `app_current_user_id()` in this schema (only `app_current_org_id()`), and
-- org_members_isolation reads it the same way.
--
-- The NULLIF/sentinel dance is NOT optional, and getting it wrong fails
-- closed as a 500 rather than as a denial. `set_config(name, NULL, true)` —
-- which is how the anonymous public-link path clears the GUCs — leaves the
-- setting as the empty string, not NULL. A bare `::uuid` cast on `''` raises
-- `invalid input syntax for type uuid: ""` from inside the policy, so the
-- caller gets a 500 instead of zero rows. Measured against a live database,
-- not assumed. Migration 0004 established this pattern for every other policy;
-- the sentinel UUID never matches a real user, so an anonymous caller still
-- matches nothing.
CREATE OR REPLACE FUNCTION dashbi_user_belongs_to_org(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.org_members m
    WHERE m.org_id = p_org_id
      AND m.user_id = COALESCE(
            NULLIF(current_setting('app.current_user_id', true), '')::uuid,
            '00000000-0000-0000-0000-000000000000'::uuid
          )
  );
$$;

-- ── ¿Este slug ya está tomado? (restricción global) ──────────────────────────
CREATE OR REPLACE FUNCTION dashbi_slug_is_taken(p_slug text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.orgs o WHERE o.slug = p_slug);
$$;

-- ── Policies, separadas por comando ───────────────────────────────────────────
ALTER TABLE orgs ENABLE ROW LEVEL SECURITY;
ALTER TABLE orgs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS orgs_isolation ON orgs;
DROP POLICY IF EXISTS orgs_read ON orgs;
DROP POLICY IF EXISTS orgs_update ON orgs;
DROP POLICY IF EXISTS orgs_insert ON orgs;

-- SELECT: lo que el usuario pertenece. El org switcher ya hace
-- `innerJoin(orgMembers).where(orgMembers.userId = ctx.userId)`; esta policy
-- lo hace redundante a nivel de DB, que es el punto: que la frontera no
-- dependa de que cada query se acuerde del join.
CREATE POLICY orgs_read ON orgs
  FOR SELECT
  USING (dashbi_user_belongs_to_org(id));

-- UPDATE: solo sobre orgs propias, y la fila resultante también tiene que
-- seguir siendo propia. Sin el WITH CHECK un admin podría cambiarse el id de
-- su org y dejarla inaccesible.
CREATE POLICY orgs_update ON orgs
  FOR UPDATE
  USING (dashbi_user_belongs_to_org(id))
  WITH CHECK (dashbi_user_belongs_to_org(id));

-- INSERT: al crear la org todavía no existe la fila en org_members, así que no
-- se puede exigir pertenencia. Lo que se exige es que haya un usuario de
-- sesión: crear una org no es escalada de privilegios (el signup ya otorga una
-- gratis) y la org queda invisible para todos hasta que exista su membresía.
--
-- NULLIF por el mismo motivo que arriba: sin él, una sesión sin usuario no
-- recibe una denegación sino `invalid input syntax for type uuid: ""`.
--
-- Nota sobre RETURNING: PostgreSQL evalúa también la policy de SELECT sobre la
-- fila que `INSERT ... RETURNING` va a devolver, y si esa policy la filtra la
-- sentencia falla con `new row violates row-level security policy` — mensaje
-- que blames WITH CHECK y manda a mirar la policy equivocada. Una org recién
-- creada no es visible para nadie todavía (no tiene membresía), así que pedir
-- el id con RETURNING es pedir leer una fila que la sesión no puede leer. Por
-- eso `provisionOrgForUser` genera el id en la app y no usa RETURNING, en vez
-- de ensanchar esta policy de SELECT con una rama `id = app_current_org_id()`
-- — que es justamente la policy por id que rompió el org switcher.
CREATE POLICY orgs_insert ON orgs
  FOR INSERT
  WITH CHECK (NULLIF(current_setting('app.current_user_id', true), '')::uuid IS NOT NULL);

-- ── Grants ───────────────────────────────────────────────────────────────────
-- PUBLIC nunca: las funciones tienen EXECUTE para todos por defecto, y estas
-- dos cruzan la frontera de RLS.
DO $$
DECLARE
  app_role text;
BEGIN
  FOREACH app_role IN ARRAY ARRAY['dashbi_app', 'dashbi'] LOOP
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = app_role) THEN
      CONTINUE;
    END IF;
    EXECUTE format('REVOKE ALL ON FUNCTION dashbi_user_belongs_to_org(uuid) FROM PUBLIC');
    EXECUTE format('REVOKE ALL ON FUNCTION dashbi_slug_is_taken(text) FROM PUBLIC');
    EXECUTE format('GRANT EXECUTE ON FUNCTION dashbi_user_belongs_to_org(uuid) TO %I', app_role);
    EXECUTE format('GRANT EXECUTE ON FUNCTION dashbi_slug_is_taken(text) TO %I', app_role);
  END LOOP;
END
$$;
