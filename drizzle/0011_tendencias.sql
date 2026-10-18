CREATE TYPE "public"."trend_source_kind" AS ENUM('google_trends', 'wikimedia', 'youtube', 'rss', 'calendar');--> statement-breakpoint
CREATE TYPE "public"."content_format" AS ENUM('feed', 'stories', 'carousel', 'reels', 'other');--> statement-breakpoint
CREATE TYPE "public"."content_status" AS ENUM('idea', 'draft', 'production', 'review', 'approved', 'scheduled', 'published');--> statement-breakpoint
CREATE TABLE "trend_analyses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"trend_id" uuid NOT NULL,
	"client_id" uuid,
	"kind" text NOT NULL,
	"trend_type" text,
	"relevance" text,
	"velocity" text,
	"niche_fit" text,
	"brand_fit" text,
	"audience_interest" text,
	"saturation" text,
	"reputation_risk" text,
	"sensitivity" text,
	"lifespan" text,
	"confidence" text,
	"suggested_niche" text,
	"recommended" boolean,
	"angles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"avoid" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rationale" text,
	"guardrails" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"demo" boolean DEFAULT false NOT NULL,
	"generation_id" uuid,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trend_analyses_organizationId_id_unique" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "trend_collection_items" (
	"organization_id" uuid NOT NULL,
	"collection_id" uuid NOT NULL,
	"trend_id" uuid NOT NULL,
	"added_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trend_collection_items_collection_id_trend_id_pk" PRIMARY KEY("collection_id","trend_id")
);
--> statement-breakpoint
CREATE TABLE "trend_collections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trend_collections_organizationId_id_unique" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "trend_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"trend_id" uuid NOT NULL,
	"observed_on" date NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rank" integer,
	"metrics" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "trend_observations_day" UNIQUE("trend_id","observed_on")
);
--> statement-breakpoint
CREATE TABLE "trend_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" "trend_source_kind" NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"niche" text,
	"region" text,
	"language" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"running_since" timestamp with time zone,
	"last_run_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_error" text,
	"last_item_count" integer,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trend_sources_organizationId_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "trend_sources_org_key" UNIQUE("organization_id","key")
);
--> statement-breakpoint
CREATE TABLE "trend_user_states" (
	"organization_id" uuid NOT NULL,
	"trend_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"saved" boolean DEFAULT false NOT NULL,
	"favorite" boolean DEFAULT false NOT NULL,
	"following" boolean DEFAULT false NOT NULL,
	"dismissed" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trend_user_states_trend_id_user_id_pk" PRIMARY KEY("trend_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "trends" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"url" text,
	"platform" text NOT NULL,
	"niche" text,
	"region" text,
	"language" text,
	"published_at" timestamp with time zone,
	"event_date" date,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metrics" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"related" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trends_organizationId_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "trends_source_external" UNIQUE("organization_id","source_id","external_id")
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"name" text NOT NULL,
	"objective" text,
	"starts_on" date,
	"ends_on" date,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaigns_organizationId_id_unique" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "content_item_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"content_item_id" uuid NOT NULL,
	"design_id" uuid,
	"file_id" uuid,
	"role" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"campaign_id" uuid,
	"project_id" uuid,
	"trend_id" uuid,
	"trend_analysis_id" uuid,
	"task_id" uuid,
	"request_id" uuid,
	"format" "content_format" DEFAULT 'feed' NOT NULL,
	"status" "content_status" DEFAULT 'draft' NOT NULL,
	"title" text NOT NULL,
	"concept" text,
	"strategy" text,
	"copy" text,
	"caption" text,
	"cta" text,
	"script" text,
	"visual_direction" text,
	"image_prompt" text,
	"hashtags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"slides" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"planned_date" date,
	"created_by_user_id" text,
	"updated_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_items_organizationId_id_unique" UNIQUE("organization_id","id")
);
--> statement-breakpoint
ALTER TABLE "trend_analyses" ADD CONSTRAINT "trend_analyses_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trend_analyses" ADD CONSTRAINT "trend_analyses_organization_id_trend_id_trends_organization_id_id_fk" FOREIGN KEY ("organization_id","trend_id") REFERENCES "public"."trends"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trend_analyses" ADD CONSTRAINT "trend_analyses_organization_id_client_id_clients_organization_id_id_fk" FOREIGN KEY ("organization_id","client_id") REFERENCES "public"."clients"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trend_collection_items" ADD CONSTRAINT "trend_collection_items_added_by_user_id_user_id_fk" FOREIGN KEY ("added_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trend_collection_items" ADD CONSTRAINT "trend_collection_items_organization_id_collection_id_trend_collections_organization_id_id_fk" FOREIGN KEY ("organization_id","collection_id") REFERENCES "public"."trend_collections"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trend_collection_items" ADD CONSTRAINT "trend_collection_items_organization_id_trend_id_trends_organization_id_id_fk" FOREIGN KEY ("organization_id","trend_id") REFERENCES "public"."trends"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trend_collections" ADD CONSTRAINT "trend_collections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trend_collections" ADD CONSTRAINT "trend_collections_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trend_observations" ADD CONSTRAINT "trend_observations_organization_id_trend_id_trends_organization_id_id_fk" FOREIGN KEY ("organization_id","trend_id") REFERENCES "public"."trends"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trend_sources" ADD CONSTRAINT "trend_sources_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trend_sources" ADD CONSTRAINT "trend_sources_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trend_user_states" ADD CONSTRAINT "trend_user_states_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trend_user_states" ADD CONSTRAINT "trend_user_states_organization_id_trend_id_trends_organization_id_id_fk" FOREIGN KEY ("organization_id","trend_id") REFERENCES "public"."trends"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trends" ADD CONSTRAINT "trends_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trends" ADD CONSTRAINT "trends_organization_id_source_id_trend_sources_organization_id_id_fk" FOREIGN KEY ("organization_id","source_id") REFERENCES "public"."trend_sources"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_organization_id_client_id_clients_organization_id_id_fk" FOREIGN KEY ("organization_id","client_id") REFERENCES "public"."clients"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_item_assets" ADD CONSTRAINT "content_item_assets_design_id_designs_id_fk" FOREIGN KEY ("design_id") REFERENCES "public"."designs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_item_assets" ADD CONSTRAINT "content_item_assets_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_item_assets" ADD CONSTRAINT "content_item_assets_organization_id_content_item_id_content_items_organization_id_id_fk" FOREIGN KEY ("organization_id","content_item_id") REFERENCES "public"."content_items"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_trend_id_trends_id_fk" FOREIGN KEY ("trend_id") REFERENCES "public"."trends"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_trend_analysis_id_trend_analyses_id_fk" FOREIGN KEY ("trend_analysis_id") REFERENCES "public"."trend_analyses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_organization_id_client_id_clients_organization_id_id_fk" FOREIGN KEY ("organization_id","client_id") REFERENCES "public"."clients"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trend_analyses_organization_id_trend_id_created_at_index" ON "trend_analyses" USING btree ("organization_id","trend_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "trend_analyses_organization_id_client_id_created_at_index" ON "trend_analyses" USING btree ("organization_id","client_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "trend_observations_organization_id_trend_id_observed_on_index" ON "trend_observations" USING btree ("organization_id","trend_id","observed_on" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "trend_user_states_organization_id_user_id_index" ON "trend_user_states" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "trends_organization_id_last_seen_at_index" ON "trends" USING btree ("organization_id","last_seen_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "trends_organization_id_niche_index" ON "trends" USING btree ("organization_id","niche");--> statement-breakpoint
CREATE INDEX "trends_title_trgm" ON "trends" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "campaigns_organization_id_client_id_index" ON "campaigns" USING btree ("organization_id","client_id");--> statement-breakpoint
CREATE INDEX "content_item_assets_organization_id_content_item_id_index" ON "content_item_assets" USING btree ("organization_id","content_item_id");--> statement-breakpoint
CREATE INDEX "content_items_organization_id_planned_date_index" ON "content_items" USING btree ("organization_id","planned_date");--> statement-breakpoint
CREATE INDEX "content_items_organization_id_client_id_index" ON "content_items" USING btree ("organization_id","client_id");--> statement-breakpoint
CREATE INDEX "content_items_organization_id_campaign_id_index" ON "content_items" USING btree ("organization_id","campaign_id");--> statement-breakpoint
CREATE INDEX "content_items_organization_id_trend_id_index" ON "content_items" USING btree ("organization_id","trend_id");--> statement-breakpoint
-- Permissões do Radar de Tendências e dos conteúdos para os papéis internos já existentes.
SELECT set_config('app.rls_bypass', 'on', false);--> statement-breakpoint
UPDATE roles SET permissions = array_append(permissions, 'trends.read')
WHERE kind = 'internal' AND key IN ('owner', 'admin', 'manager', 'account', 'designer', 'copywriter', 'social_media', 'traffic') AND NOT ('trends.read' = ANY(permissions));--> statement-breakpoint
UPDATE roles SET permissions = array_append(permissions, 'trends.manage')
WHERE kind = 'internal' AND key IN ('owner', 'admin', 'manager') AND NOT ('trends.manage' = ANY(permissions));--> statement-breakpoint
UPDATE roles SET permissions = array_append(permissions, 'content.read')
WHERE kind = 'internal' AND key IN ('owner', 'admin', 'manager', 'account', 'designer', 'copywriter', 'social_media', 'traffic') AND NOT ('content.read' = ANY(permissions));--> statement-breakpoint
UPDATE roles SET permissions = array_append(permissions, 'content.write')
WHERE kind = 'internal' AND key IN ('owner', 'admin', 'manager', 'account', 'designer', 'copywriter', 'social_media', 'traffic') AND NOT ('content.write' = ANY(permissions));--> statement-breakpoint
SELECT set_config('app.rls_bypass', 'off', false);
