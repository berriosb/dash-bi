ALTER TYPE "public"."connector_type" ADD VALUE 'mysql';--> statement-breakpoint
ALTER TYPE "public"."connector_type" ADD VALUE 'shopify';--> statement-breakpoint
CREATE TABLE "alert_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"alert_rule_id" uuid NOT NULL,
	"fired_at" timestamp with time zone DEFAULT now() NOT NULL,
	"breached_value" jsonb NOT NULL,
	"delivery_status" jsonb NOT NULL,
	"correlation_id" text NOT NULL,
	"title" text NOT NULL,
	"dashboard_title" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alert_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"dashboard_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"query_sql" text NOT NULL,
	"query_columns" jsonb NOT NULL,
	"condition" jsonb NOT NULL,
	"evaluation_interval_minutes" integer DEFAULT 5 NOT NULL,
	"evaluation_window_minutes" integer DEFAULT 5 NOT NULL,
	"consecutive_breaches_to_fire" integer DEFAULT 1 NOT NULL,
	"channels" jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"cooldown_minutes" integer DEFAULT 60 NOT NULL,
	"last_evaluated_at" timestamp with time zone,
	"last_evaluation_status" text,
	"last_evaluation_error" text,
	"consecutive_breaches" integer DEFAULT 0 NOT NULL,
	"last_fired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_alert_rule_id_alert_rules_id_fk" FOREIGN KEY ("alert_rule_id") REFERENCES "public"."alert_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_dashboard_id_dashboards_id_fk" FOREIGN KEY ("dashboard_id") REFERENCES "public"."dashboards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alert_events_rule_idx" ON "alert_events" USING btree ("alert_rule_id","fired_at");--> statement-breakpoint
CREATE INDEX "alert_events_org_idx" ON "alert_events" USING btree ("org_id","fired_at");--> statement-breakpoint
CREATE INDEX "alert_rules_org_idx" ON "alert_rules" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "alert_rules_dashboard_idx" ON "alert_rules" USING btree ("dashboard_id");--> statement-breakpoint
CREATE INDEX "alert_rules_due_idx" ON "alert_rules" USING btree ("enabled","last_evaluated_at");