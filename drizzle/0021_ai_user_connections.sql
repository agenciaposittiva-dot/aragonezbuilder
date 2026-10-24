CREATE TABLE "ai_user_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"key_encrypted" text NOT NULL,
	"endpoint_url" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"status" "ai_provider_status" DEFAULT 'unverified' NOT NULL,
	"last_error" text,
	"last_checked_at" timestamp with time zone,
	"models" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"models_fetched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_provider_configs" ADD COLUMN "allow_user_keys" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD COLUMN "key_source" text;--> statement-breakpoint
ALTER TABLE "ai_user_connections" ADD CONSTRAINT "ai_user_connections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_user_connections" ADD CONSTRAINT "ai_user_connections_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_user_connections_scope" ON "ai_user_connections" USING btree ("organization_id","user_id","provider");--> statement-breakpoint
CREATE INDEX "ai_user_connections_organization_id_user_id_index" ON "ai_user_connections" USING btree ("organization_id","user_id");