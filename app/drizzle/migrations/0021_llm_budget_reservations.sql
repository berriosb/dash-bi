-- ─────────────────────────────────────────────────────────────────────────────
-- 0021 — Ledger de reservas del presupuesto de LLM.
--
-- Por qué
-- ------
-- El gate de presupuesto era una COMPROBACIÓN, y una comprobación no es
-- una puerta: leía el gasto del mes, lo comparaba con el tope y se
-- volvía. El gasto se registraba DESPUÉS de la llamada al modelo, así
-- que N llamadas que empezaban al mismo tiempo leían el MISMO gasto,
-- las N pasaban y las N gastaban. Entre la comprobación y el registro
-- estaba todo el burst.
--
-- Una reserva es lo que una llamada COMPROMETE antes de empezar. El
-- siguiente que llega la ve, así que el burst tiene contra qué chocar.
--
-- La reserva vive en su propia tabla y no como una columna de
-- `llm_usage` a propósito:
--
--   - `llm_usage` es telemetría de lo que PASÓ (lo consume el panel de
--     uso). Una reserva no es un gasto: meterla ahí haría que el panel
--     mostrara una estimación como si fuera dinero gastado.
--   - La reserva es TRANSITORIA: se liquida con el costo real y ese
--     costo real es el que queda en `llm_usage`. Nunca se cuentan las
--     dos cosas a la vez, porque el liquidación escribe la fila de
--     `llm_usage` y liquida la reserva en la MISMA transacción.
--
-- `settled_usd` es NULL mientras la llamada está en vuelo; `reserved_usd`
-- es lo que se supone que cuesta.
--
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "llm_budget_reservations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id" uuid NOT NULL REFERENCES "orgs"("id") ON DELETE CASCADE,
  "user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "provider" llm_provider NOT NULL,
  "model" text NOT NULL,
  "reserved_usd" text NOT NULL,
  "settled_usd" text,
  "status" text NOT NULL DEFAULT 'pending',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "settled_at" timestamptz
);

CREATE INDEX IF NOT EXISTS "llm_budget_reservations_org_idx"
  ON "llm_budget_reservations" ("org_id");

CREATE INDEX IF NOT EXISTS "llm_budget_reservations_pending_idx"
  ON "llm_budget_reservations" ("org_id", "status");

CREATE INDEX IF NOT EXISTS "llm_budget_reservations_created_at_idx"
  ON "llm_budget_reservations" ("created_at");

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────────────────────────────────────
--
-- La tabla es de un tenant: la reserva de una org es el presupuesto
-- compromise de esa org. `ENABLE` y luego `FORCE` (sin `FORCE`, el
-- dueño de la tabla queda exento de sus propias policies, y así es como
-- conecta la app), siguiendo el precedente de 0007 y 0012.
--
-- La policy usa el helper null-safe `app_current_org_id()` de la
-- migración 0004, no `current_setting(...)::uuid` pelado: un llamador
-- anónimo (un link público) resuelve al UUID centinela y no encuentra
-- filas en vez de reventar con `invalid input syntax for type uuid`.
ALTER TABLE "llm_budget_reservations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "llm_budget_reservations" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "llm_budget_reservations_isolation" ON "llm_budget_reservations";
CREATE POLICY "llm_budget_reservations_isolation" ON "llm_budget_reservations"
  USING (org_id = app_current_org_id());

DROP POLICY IF EXISTS "llm_budget_reservations_insert" ON "llm_budget_reservations";
CREATE POLICY "llm_budget_reservations_insert" ON "llm_budget_reservations"
  WITH CHECK (org_id = app_current_org_id());

-- ─────────────────────────────────────────────────────────────────────────────
-- El rol de solo lectura no lee esta tabla
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Es una tabla interna: `dashbi_readonly` existe para leer lo que el
-- usuario tiene en sus esquemas `org_<uuid>`, no el estado interno de
-- dash-bi. La migración 0019 revocó `ALL` sobre nueve tablas internas
-- (y `llm_usage` estaba entre ellas); esta es la décima.
DO $$
DECLARE
  tbl text;
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'dashbi_readonly') THEN
    FOREACH tbl IN ARRAY ARRAY['llm_budget_reservations'] LOOP
      IF EXISTS (
        SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = tbl
      ) THEN
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM dashbi_readonly', tbl);
      END IF;
    END LOOP;
  END IF;
END
$$;
