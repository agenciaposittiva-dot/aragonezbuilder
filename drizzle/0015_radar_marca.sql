CREATE TABLE "brand_radar_bio_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"diagnosis_id" uuid,
	"style" text NOT NULL,
	"text" text NOT NULL,
	"objective" text DEFAULT '' NOT NULL,
	"strengths" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cta" text DEFAULT '' NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"file_id" uuid,
	"task_id" uuid,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brand_radar_bio_versions_organizationId_id_unique" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "brand_radar_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"ig_user_id" text NOT NULL,
	"username" text NOT NULL,
	"account_type" text,
	"access_token_enc" text,
	"token_expires_at" timestamp with time zone,
	"scopes" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" text DEFAULT 'connected' NOT NULL,
	"last_sync_at" timestamp with time zone,
	"last_sync" jsonb,
	"last_error" text,
	"connected_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brand_radar_connections_organizationId_id_unique" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "brand_radar_diagnoses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"kind" text DEFAULT 'full' NOT NULL,
	"methodology_version" text NOT NULL,
	"weights" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"inputs" jsonb NOT NULL,
	"result" jsonb NOT NULL,
	"overall_score" integer,
	"evaluated_weight" integer,
	"provider" text,
	"model" text,
	"demo" boolean DEFAULT false NOT NULL,
	"generation_id" uuid,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brand_radar_diagnoses_organizationId_id_unique" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "brand_radar_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"kind" text DEFAULT 'own' NOT NULL,
	"network" text DEFAULT 'instagram' NOT NULL,
	"handle" text NOT NULL,
	"profile_url" text NOT NULL,
	"niche" text,
	"market" text,
	"region" text,
	"notes" text,
	"manual" jsonb,
	"planned_bio" text,
	"planned_bio_at" timestamp with time zone,
	"planned_bio_by_user_id" text,
	"archived_at" timestamp with time zone,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brand_radar_profiles_organizationId_id_unique" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "brand_radar_recommendations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"diagnosis_id" uuid NOT NULL,
	"area" text NOT NULL,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"problem" text NOT NULL,
	"evidence" text DEFAULT '' NOT NULL,
	"evidence_source" text DEFAULT '' NOT NULL,
	"basis" text DEFAULT 'hypothesis' NOT NULL,
	"impact" text DEFAULT 'medio' NOT NULL,
	"effort" text DEFAULT 'medio' NOT NULL,
	"priority" integer DEFAULT 3 NOT NULL,
	"confidence" text DEFAULT 'medio' NOT NULL,
	"next_action" text DEFAULT '' NOT NULL,
	"how_to_test" text,
	"assignee_membership_id" uuid,
	"due_date" date,
	"status" text DEFAULT 'open' NOT NULL,
	"task_id" uuid,
	"design_id" uuid,
	"content_item_id" uuid,
	"campaign_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brand_radar_recommendations_organizationId_id_unique" UNIQUE("organization_id","id")
);
--> statement-breakpoint
ALTER TABLE "brand_radar_bio_versions" ADD CONSTRAINT "brand_radar_bio_versions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_radar_bio_versions" ADD CONSTRAINT "brand_radar_bio_versions_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_radar_bio_versions" ADD CONSTRAINT "brand_radar_bio_versions_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_radar_bio_versions" ADD CONSTRAINT "brand_radar_bio_versions_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_radar_bio_versions" ADD CONSTRAINT "brand_radar_bio_versions_organization_id_profile_id_brand_radar_profiles_organization_id_id_fk" FOREIGN KEY ("organization_id","profile_id") REFERENCES "public"."brand_radar_profiles"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_radar_connections" ADD CONSTRAINT "brand_radar_connections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_radar_connections" ADD CONSTRAINT "brand_radar_connections_connected_by_user_id_user_id_fk" FOREIGN KEY ("connected_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_radar_connections" ADD CONSTRAINT "brand_radar_connections_organization_id_profile_id_brand_radar_profiles_organization_id_id_fk" FOREIGN KEY ("organization_id","profile_id") REFERENCES "public"."brand_radar_profiles"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_radar_diagnoses" ADD CONSTRAINT "brand_radar_diagnoses_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_radar_diagnoses" ADD CONSTRAINT "brand_radar_diagnoses_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_radar_diagnoses" ADD CONSTRAINT "brand_radar_diagnoses_organization_id_profile_id_brand_radar_profiles_organization_id_id_fk" FOREIGN KEY ("organization_id","profile_id") REFERENCES "public"."brand_radar_profiles"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_radar_diagnoses" ADD CONSTRAINT "brand_radar_diagnoses_organization_id_client_id_clients_organization_id_id_fk" FOREIGN KEY ("organization_id","client_id") REFERENCES "public"."clients"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_radar_profiles" ADD CONSTRAINT "brand_radar_profiles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_radar_profiles" ADD CONSTRAINT "brand_radar_profiles_planned_bio_by_user_id_user_id_fk" FOREIGN KEY ("planned_bio_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_radar_profiles" ADD CONSTRAINT "brand_radar_profiles_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_radar_profiles" ADD CONSTRAINT "brand_radar_profiles_organization_id_client_id_clients_organization_id_id_fk" FOREIGN KEY ("organization_id","client_id") REFERENCES "public"."clients"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_radar_recommendations" ADD CONSTRAINT "brand_radar_recommendations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_radar_recommendations" ADD CONSTRAINT "brand_radar_recommendations_assignee_membership_id_memberships_id_fk" FOREIGN KEY ("assignee_membership_id") REFERENCES "public"."memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_radar_recommendations" ADD CONSTRAINT "brand_radar_recommendations_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_radar_recommendations" ADD CONSTRAINT "brand_radar_recommendations_design_id_designs_id_fk" FOREIGN KEY ("design_id") REFERENCES "public"."designs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_radar_recommendations" ADD CONSTRAINT "brand_radar_recommendations_content_item_id_content_items_id_fk" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_radar_recommendations" ADD CONSTRAINT "brand_radar_recommendations_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_radar_recommendations" ADD CONSTRAINT "brand_radar_recommendations_organization_id_diagnosis_id_brand_radar_diagnoses_organization_id_id_fk" FOREIGN KEY ("organization_id","diagnosis_id") REFERENCES "public"."brand_radar_diagnoses"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "brand_radar_bio_versions_organization_id_profile_id_index" ON "brand_radar_bio_versions" USING btree ("organization_id","profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX "brand_radar_connections_profile_unique" ON "brand_radar_connections" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "brand_radar_diagnoses_organization_id_profile_id_created_at_index" ON "brand_radar_diagnoses" USING btree ("organization_id","profile_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "brand_radar_profiles_handle_unique" ON "brand_radar_profiles" USING btree ("organization_id","client_id","network","handle");--> statement-breakpoint
CREATE INDEX "brand_radar_profiles_organization_id_client_id_index" ON "brand_radar_profiles" USING btree ("organization_id","client_id");--> statement-breakpoint
CREATE INDEX "brand_radar_recommendations_organization_id_profile_id_status_index" ON "brand_radar_recommendations" USING btree ("organization_id","profile_id","status");--> statement-breakpoint
-- Permissões do Radar de Marca para os papéis internos já existentes.
SELECT set_config('app.rls_bypass', 'on', false);--> statement-breakpoint
UPDATE roles SET permissions = array_append(permissions, 'brand.read')
WHERE kind = 'internal' AND key IN ('owner', 'admin', 'manager', 'account', 'designer', 'copywriter', 'social_media', 'traffic') AND NOT ('brand.read' = ANY(permissions));--> statement-breakpoint
UPDATE roles SET permissions = array_append(permissions, 'brand.manage')
WHERE kind = 'internal' AND key IN ('owner', 'admin', 'manager', 'account', 'social_media') AND NOT ('brand.manage' = ANY(permissions));--> statement-breakpoint
SELECT set_config('app.rls_bypass', 'off', false);
