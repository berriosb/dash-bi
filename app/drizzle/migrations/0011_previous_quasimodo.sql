-- Tier 2 (post-MVP): widen the connector_type enum so the Hubspot,
-- GA4, and Snowflake connectors (slices 1-3) can store their
-- data_sources rows. `ALTER TYPE ... ADD VALUE` cannot run inside a
-- transaction block in older Postgres, so we use IF NOT EXISTS for
-- idempotency — see the precedent in 0008_connector_type_csv_excel.sql.
ALTER TYPE "public"."connector_type" ADD VALUE IF NOT EXISTS 'hubspot';--> statement-breakpoint
ALTER TYPE "public"."connector_type" ADD VALUE IF NOT EXISTS 'ga4';--> statement-breakpoint
ALTER TYPE "public"."connector_type" ADD VALUE IF NOT EXISTS 'snowflake';