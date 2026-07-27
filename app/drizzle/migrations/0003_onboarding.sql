-- ─────────────────────────────────────────────────────────────────
-- Migration 0003 — Onboarding state on users table
-- Per specs/onboarding.md §6
-- ─────────────────────────────────────────────────────────────────

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS current_onboarding_step TEXT,
  ADD COLUMN IF NOT EXISTS onboarding_data_source_id UUID;

-- Add an index on current_onboarding_step for drop-off queries
-- (find users stuck at a particular step)
CREATE INDEX IF NOT EXISTS users_current_onboarding_step_idx
  ON users (current_onboarding_step)
  WHERE current_onboarding_step IS NOT NULL;