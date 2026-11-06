-- ─────────────────────────────────────────────────────────────────────────────
-- 0020 — org_members: la escritura queda dentro de la org activa.
--
-- Por qué
-- -------
-- La policy que dejó la migración 0017 era:
--
--   USING      (user_id = current_user_id OR org_id = app_current_org_id())
--   WITH CHECK (user_id = current_user_id OR org_id = app_current_org_id())
--
-- Las dos ramas son correctas para LEER, y por eso se quedan:
--
--   - `user_id = current_user_id`: el switcher de orgs tiene que ver TODAS
--     las membresías del usuario, no solo la de la org activa. El GUC que
--     acompaña a esa lectura es `app.current_user_id` a secas (sin org), así
--     que la rama de la org no matchea.
--   - `org_id = app_current_org_id()`: el listado de miembros de una org.
--
-- Para ESCRIBIR no. La primera rama del WITH CHECK la cumple cualquier fila
-- QUE SEA DEL LLAMADOR, y una fila del llamador puede nombrar OTRA org. Con
-- eso, un usuario podía insertar
--
--   (user_id = yo, org_id = <otra org>, role = 'admin')
--
-- y el INSERT pasaba el control. Como `orgs_isolation` deriva "qué orgs ve
-- este usuario" de `org_members`, esa fila le daba visibilidad de la otra
-- org: admin de un tenant, admin de todos.
--
-- El test que cubría esto (migración 0017) insertaba con el userId de OTRO
-- usuario —el invitado—, que la primera rama no cumple, así que pasaba
-- mientras la escalada real estaba a una rama de distancia.
--
-- El fix
-- ------
-- La escritura se acota a la org activa:
--
--   WITH CHECK (org_id = app_current_org_id())
--
-- Toda escritura legítima de la app cumple esto:
--
--   - el alta de la org (`provisionOrgForUser`) fija el GUC a la org que está
--     creando y escribe la primera membresía de esa org;
--   - la invitación escribe (ctx.orgId, targetUser.id) dentro de
--     `withOrgContext(ctx.orgId)`;
--   - el cambio de rol y el borrado de un miembro operan sobre filas de
--     ctx.orgId, y el `USING` sigue exigiendo pertenencia.
--
-- La LECTURA no cambia: las dos ramas se quedan.
-- ─────────────────────────────────────────────────────────────────────────────

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
    org_id = app_current_org_id()
  );
