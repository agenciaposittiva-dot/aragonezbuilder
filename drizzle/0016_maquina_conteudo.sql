CREATE TYPE "public"."machine_project_status" AS ENUM('draft', 'generating', 'ready', 'archived');--> statement-breakpoint
CREATE TABLE "content_machine_projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"campaign_id" uuid,
	"project_id" uuid,
	"trend_id" uuid,
	"design_id" uuid,
	"content_item_id" uuid,
	"title" text NOT NULL,
	"status" "machine_project_status" DEFAULT 'draft' NOT NULL,
	"step" integer DEFAULT 1 NOT NULL,
	"state" jsonb NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"last_error" text,
	"archived_at" timestamp with time zone,
	"created_by_user_id" text,
	"updated_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_machine_projects_organizationId_id_unique" UNIQUE("organization_id","id")
);
--> statement-breakpoint
ALTER TABLE "content_machine_projects" ADD CONSTRAINT "content_machine_projects_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_machine_projects" ADD CONSTRAINT "content_machine_projects_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_machine_projects" ADD CONSTRAINT "content_machine_projects_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_machine_projects" ADD CONSTRAINT "content_machine_projects_trend_id_trends_id_fk" FOREIGN KEY ("trend_id") REFERENCES "public"."trends"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_machine_projects" ADD CONSTRAINT "content_machine_projects_design_id_designs_id_fk" FOREIGN KEY ("design_id") REFERENCES "public"."designs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_machine_projects" ADD CONSTRAINT "content_machine_projects_content_item_id_content_items_id_fk" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_machine_projects" ADD CONSTRAINT "content_machine_projects_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_machine_projects" ADD CONSTRAINT "content_machine_projects_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_machine_projects" ADD CONSTRAINT "content_machine_projects_organization_id_client_id_clients_organization_id_id_fk" FOREIGN KEY ("organization_id","client_id") REFERENCES "public"."clients"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "content_machine_projects_organization_id_updated_at_index" ON "content_machine_projects" USING btree ("organization_id","updated_at");--> statement-breakpoint
CREATE INDEX "content_machine_projects_organization_id_client_id_index" ON "content_machine_projects" USING btree ("organization_id","client_id");