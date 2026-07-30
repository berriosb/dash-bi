-- Sprint 1.5: add `updated_at` to `users` (better-auth requires it).
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;