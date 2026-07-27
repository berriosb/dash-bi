-- Sprint 3 — NLQA conversations & messages
-- Tables for the chat-with-your-data feature. Tenant-scoped via org_id
-- (RLS policies added in this same migration).

CREATE TYPE "public"."nlqa_role" AS ENUM('user', 'assistant', 'system');--> statement-breakpoint

CREATE TABLE "nlqa_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"data_source_id" uuid NOT NULL,
	"title" text DEFAULT 'Nueva conversación' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE "nlqa_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" "nlqa_role" NOT NULL,
	"content" text NOT NULL,
	"generated_sql" text,
	"generated_chart_type" text,
	"generated_chart_config" jsonb,
	"row_count" integer,
	"execution_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE INDEX "nlqa_conversations_org_idx" ON "nlqa_conversations" USING btree ("org_id");
--> statement-breakpoint
CREATE INDEX "nlqa_conversations_user_idx" ON "nlqa_conversations" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "nlqa_conversations_data_source_idx" ON "nlqa_conversations" USING btree ("data_source_id");
--> statement-breakpoint
CREATE INDEX "nlqa_messages_conversation_idx" ON "nlqa_messages" USING btree ("conversation_id");
--> statement-breakpoint
CREATE INDEX "nlqa_messages_created_at_idx" ON "nlqa_messages" USING btree ("created_at");
--> statement-breakpoint

-- Foreign keys (drizzle separates these from CREATE TABLE)
ALTER TABLE "nlqa_conversations" ADD CONSTRAINT "nlqa_conversations_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "nlqa_conversations" ADD CONSTRAINT "nlqa_conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "nlqa_conversations" ADD CONSTRAINT "nlqa_conversations_data_source_id_data_sources_id_fk" FOREIGN KEY ("data_source_id") REFERENCES "public"."data_sources"("id") ON DELETE cascade;--> statement-breakpoint

ALTER TABLE "nlqa_messages" ADD CONSTRAINT "nlqa_messages_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "nlqa_messages" ADD CONSTRAINT "nlqa_messages_conversation_id_nlqa_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."nlqa_conversations"("id") ON DELETE cascade;--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────
-- RLS policies for NLQA tables (T1 multi-tenant isolation)
-- ─────────────────────────────────────────────────────────────────

ALTER TABLE "nlqa_conversations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "nlqa_conversations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "nlqa_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "nlqa_messages" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

DROP POLICY IF EXISTS "nlqa_conversations_isolation" ON "nlqa_conversations";--> statement-breakpoint
CREATE POLICY "nlqa_conversations_isolation" ON "nlqa_conversations"
  USING (
    org_id = current_setting('app.current_org_id', true)::uuid
    AND user_id = current_setting('app.current_user_id', true)::uuid
  );--> statement-breakpoint

DROP POLICY IF EXISTS "nlqa_messages_isolation" ON "nlqa_messages";--> statement-breakpoint
CREATE POLICY "nlqa_messages_isolation" ON "nlqa_messages"
  USING (
    org_id = current_setting('app.current_org_id', true)::uuid
  );--> statement-breakpoint

-- Read-only access for the dashbi_readonly role (T7)
GRANT SELECT ON "nlqa_conversations" TO dashbi_readonly;--> statement-breakpoint
GRANT SELECT ON "nlqa_messages" TO dashbi_readonly;--> statement-breakpoint