CREATE TABLE "approval_link_items" (
	"organization_id" uuid NOT NULL,
	"link_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "approval_link_items_link_id_file_id_pk" PRIMARY KEY("link_id","file_id")
);
--> statement-breakpoint
CREATE TABLE "approval_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"label" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_viewed_at" timestamp with time zone,
	CONSTRAINT "approval_links_tokenHash_unique" UNIQUE("token_hash"),
	CONSTRAINT "approval_links_organizationId_id_unique" UNIQUE("organization_id","id")
);
--> statement-breakpoint
ALTER TABLE "approvals" ADD COLUMN "decided_by_name" text;--> statement-breakpoint
ALTER TABLE "approval_link_items" ADD CONSTRAINT "approval_link_items_organization_id_link_id_approval_links_organization_id_id_fk" FOREIGN KEY ("organization_id","link_id") REFERENCES "public"."approval_links"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_link_items" ADD CONSTRAINT "approval_link_items_organization_id_file_id_files_organization_id_id_fk" FOREIGN KEY ("organization_id","file_id") REFERENCES "public"."files"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_links" ADD CONSTRAINT "approval_links_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_links" ADD CONSTRAINT "approval_links_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_links" ADD CONSTRAINT "approval_links_organization_id_client_id_clients_organization_id_id_fk" FOREIGN KEY ("organization_id","client_id") REFERENCES "public"."clients"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approval_link_items_file_id_index" ON "approval_link_items" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "approval_links_organization_id_client_id_created_at_index" ON "approval_links" USING btree ("organization_id","client_id","created_at" DESC NULLS LAST);