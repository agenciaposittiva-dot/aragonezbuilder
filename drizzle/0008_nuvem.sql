CREATE TYPE "public"."design_version_kind" AS ENUM('auto', 'named', 'restore', 'conflict');--> statement-breakpoint
CREATE TABLE "design_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"design_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"kind" "design_version_kind" DEFAULT 'auto' NOT NULL,
	"label" text,
	"revision" integer NOT NULL,
	"document" jsonb NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"thumbnail" text,
	"size_bytes" integer DEFAULT 0 NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "design_versions_organizationId_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "design_versions_designId_versionNumber_unique" UNIQUE("design_id","version_number")
);
--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "deleted_by_user_id" text;--> statement-breakpoint
ALTER TABLE "design_versions" ADD CONSTRAINT "design_versions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_versions" ADD CONSTRAINT "design_versions_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_versions" ADD CONSTRAINT "design_versions_organization_id_design_id_designs_organization_id_id_fk" FOREIGN KEY ("organization_id","design_id") REFERENCES "public"."designs"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "design_versions_organization_id_design_id_created_at_index" ON "design_versions" USING btree ("organization_id","design_id","created_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_deleted_by_user_id_user_id_fk" FOREIGN KEY ("deleted_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Ponto de partida do histórico: cada arte existente ganha a versão inicial (estado atual).
SELECT set_config('app.rls_bypass', 'on', false);--> statement-breakpoint
INSERT INTO "design_versions" ("organization_id", "design_id", "version_number", "kind", "label", "revision", "document", "width", "height", "thumbnail", "size_bytes", "created_by_user_id", "created_at")
SELECT "organization_id", "id", 1, 'auto', 'Versão inicial', "revision", "document", "width", "height", "thumbnail", octet_length("document"::text), "updated_by_user_id", "updated_at"
FROM "designs";--> statement-breakpoint
SELECT set_config('app.rls_bypass', 'off', false);
