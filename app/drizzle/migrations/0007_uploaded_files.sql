-- Sprint 1.5: uploaded_files table for the CSV/Excel connector
-- (specs/csv-excel-connector.md).
--
-- This table tracks the user-uploaded files. The actual data lives in
-- a per-org Postgres table created on upload; see
-- `lib/connectors/implementations/spreadsheet.ts` for the runtime.

CREATE TABLE IF NOT EXISTS "uploaded_files" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "public"."orgs"("id") ON DELETE cascade,
  "name" text NOT NULL,
  "original_filename" text NOT NULL,
  "format" text NOT NULL,
  "size_bytes" integer NOT NULL,
  "target_table" text NOT NULL,
  "row_count" integer NOT NULL,
  "columns" jsonb NOT NULL,
  "created_by" uuid NOT NULL REFERENCES "public"."users"("id") ON DELETE restrict,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone,
  CONSTRAINT "uploaded_files_format_check" CHECK ("format" IN ('csv', 'xlsx', 'xls'))
);

CREATE INDEX IF NOT EXISTS "uploaded_files_org_idx" ON "uploaded_files" USING btree ("org_id");
CREATE INDEX IF NOT EXISTS "uploaded_files_target_table_idx" ON "uploaded_files" USING btree ("org_id", "target_table");

ALTER TABLE "uploaded_files" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "uploaded_files_isolation" ON "uploaded_files";
CREATE POLICY "uploaded_files_isolation" ON "uploaded_files"
  USING (org_id = app_current_org_id());

DROP POLICY IF EXISTS "uploaded_files_insert" ON "uploaded_files";
CREATE POLICY "uploaded_files_insert" ON "uploaded_files"
  WITH CHECK (org_id = app_current_org_id());