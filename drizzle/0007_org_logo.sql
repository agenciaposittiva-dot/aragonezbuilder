ALTER TABLE "organizations" ADD COLUMN "logo_key" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "logo_hash" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "logo_updated_at" timestamp with time zone;