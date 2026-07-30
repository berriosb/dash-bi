-- Sprint 1.5: persist dashboard archetype + variant metadata.
--
-- The auto-save path used to construct the Dashboard payload in the
-- detail page with `archetype: 'custom'` hardcoded. The schema didn't
-- have columns to store the real value either, so even if we sent it,
-- it would have been discarded. This migration adds the columns and
-- the runtime code persists them on create / update.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'archetype'
  ) THEN
    CREATE TYPE archetype AS ENUM (
      'kpi-grid',
      'hero-focus',
      'cohort-matrix',
      'sales-pipeline',
      'executive-summary',
      'operations-live',
      'finance-report',
      'growth-metrics',
      'custom'
    );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'density'
  ) THEN
    CREATE TYPE density AS ENUM ('spacious', 'balanced', 'dense');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'theme_accent'
  ) THEN
    CREATE TYPE theme_accent AS ENUM ('default', 'accent', 'muted');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'time_window'
  ) THEN
    CREATE TYPE time_window AS ENUM (
      'last_24h',
      'last_7d',
      'last_30d',
      'last_quarter',
      'last_90d',
      'last_6mo',
      'last_year',
      'all_time'
    );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'comparativo'
  ) THEN
    CREATE TYPE comparativo AS ENUM (
      'none',
      'previous_period',
      'previous_month',
      'previous_quarter',
      'previous_year',
      'last_year_same_week'
    );
  END IF;
END
$$;

ALTER TABLE dashboards
  ADD COLUMN IF NOT EXISTS archetype archetype NOT NULL DEFAULT 'custom',
  ADD COLUMN IF NOT EXISTS archetype_variant_density density NOT NULL DEFAULT 'balanced',
  ADD COLUMN IF NOT EXISTS archetype_variant_accent theme_accent NOT NULL DEFAULT 'default',
  ADD COLUMN IF NOT EXISTS archetype_variant_time_window time_window NOT NULL DEFAULT 'last_30d',
  ADD COLUMN IF NOT EXISTS archetype_variant_comparativo comparativo NOT NULL DEFAULT 'previous_period';