-- Migration 0009: Scheduled reports tables

CREATE TABLE IF NOT EXISTS "scheduled_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"dashboard_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"cron" text NOT NULL,
	"timezone" text DEFAULT 'America/Santiago' NOT NULL,
	"format" text DEFAULT 'pdf' NOT NULL,
	"include_branding" boolean DEFAULT true NOT NULL,
	"recipients" jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_run_status" text,
	"last_run_error_code" text,
	"last_run_correlation_id" text,
	"next_run_at" timestamp with time zone NOT NULL,
	"title" text,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "scheduled_report_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"scheduled_report_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"status" text NOT NULL,
	"file_url" text,
	"error_code" text,
	"error_message" text,
	"correlation_id" text
);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_sched_reports_org') THEN
    ALTER TABLE "scheduled_reports" ADD CONSTRAINT "fk_sched_reports_org" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_sched_reports_dashboard') THEN
    ALTER TABLE "scheduled_reports" ADD CONSTRAINT "fk_sched_reports_dashboard" FOREIGN KEY ("dashboard_id") REFERENCES "public"."dashboards"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_sched_reports_creator') THEN
    ALTER TABLE "scheduled_reports" ADD CONSTRAINT "fk_sched_reports_creator" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_sched_runs_org') THEN
    ALTER TABLE "scheduled_report_runs" ADD CONSTRAINT "fk_sched_runs_org" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_sched_runs_report') THEN
    ALTER TABLE "scheduled_report_runs" ADD CONSTRAINT "fk_sched_runs_report" FOREIGN KEY ("scheduled_report_id") REFERENCES "public"."scheduled_reports"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scheduled_reports_org_idx" ON "scheduled_reports" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scheduled_reports_next_run_idx" ON "scheduled_reports" USING btree ("next_run_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scheduled_report_runs_report_idx" ON "scheduled_report_runs" USING btree ("scheduled_report_id");