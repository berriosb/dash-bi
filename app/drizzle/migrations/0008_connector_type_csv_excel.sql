-- Sprint 1.5: widen the connector_type enum so that files uploaded
-- via the CSV/Excel connector (specs/csv-excel-connector.md) can be
-- stored as `data_sources` rows with type='csv' | type='excel'.
--
-- IMPORTANT: ALTER TYPE ... ADD VALUE cannot run inside a transaction
-- block in Postgres <12. dash-bi targets Postgres 16 where `IF NOT
-- EXISTS` is supported, but Drizzle Kit wraps each migration in a
-- transaction by default;
--
-- Workaround: this migration is intentionally applied in a separate
-- script (see `app/drizzle/migrations/0008_connector_type_csv_excel.sql`
-- and the matching `_journal.json` entry with `breakpoints: true`).
-- The CI workflow runs `psql -c "ALTER TYPE connector_type ADD VALUE
-- IF NOT EXISTS 'csv'; ALTER TYPE connector_type ADD VALUE IF NOT
-- EXISTS 'excel';"` after `db:migrate` finishes to keep the upgrade
-- path idempotent without breaking the transaction runner.
--
-- For local dev: `pnpm db:migrate` applies 0000-0007 inside a tx,
-- then `psql $DATABASE_URL -f 0008_connector_type_csv_excel.sql` is
-- a no-op thanks to `IF NOT EXISTS`.

ALTER TYPE connector_type ADD VALUE IF NOT EXISTS 'csv';
ALTER TYPE connector_type ADD VALUE IF NOT EXISTS 'excel';
