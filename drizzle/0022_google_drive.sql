CREATE TYPE "public"."google_drive_status" AS ENUM('connected', 'reauth_required', 'error');--> statement-breakpoint
ALTER TYPE "public"."file_source" ADD VALUE 'drive';--> statement-breakpoint
CREATE TABLE "google_drive_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"google_account_id" text NOT NULL,
	"email" text,
	"access_token_enc" text NOT NULL,
	"refresh_token_enc" text,
	"access_token_expires_at" timestamp with time zone,
	"scopes" text[] DEFAULT '{}' NOT NULL,
	"status" "google_drive_status" DEFAULT 'connected' NOT NULL,
	"last_error" text,
	"last_checked_at" timestamp with time zone,
	"root_folder_id" text,
	"default_folder_id" text,
	"default_folder_name" text,
	"organize_by" text DEFAULT 'client_project' NOT NULL,
	"preferred_destination" text DEFAULT 'platform' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "google_drive_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"direction" text NOT NULL,
	"drive_file_id" text NOT NULL,
	"drive_folder_id" text,
	"name" text NOT NULL,
	"mime_type" text,
	"size_bytes" bigint,
	"web_view_link" text,
	"file_id" uuid,
	"file_version_id" uuid,
	"status" text DEFAULT 'ok' NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "google_drive_connections" ADD CONSTRAINT "google_drive_connections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "google_drive_connections" ADD CONSTRAINT "google_drive_connections_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "google_drive_files" ADD CONSTRAINT "google_drive_files_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "google_drive_files" ADD CONSTRAINT "google_drive_files_connection_id_google_drive_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."google_drive_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "google_drive_files" ADD CONSTRAINT "google_drive_files_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "google_drive_connections_scope" ON "google_drive_connections" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "google_drive_files_organization_id_user_id_index" ON "google_drive_files" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "google_drive_files_organization_id_file_id_index" ON "google_drive_files" USING btree ("organization_id","file_id");--> statement-breakpoint
CREATE UNIQUE INDEX "google_drive_files_version" ON "google_drive_files" USING btree ("organization_id","direction","file_version_id","drive_file_id");