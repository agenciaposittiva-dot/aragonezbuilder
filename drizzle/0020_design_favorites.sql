CREATE TABLE "design_favorites" (
	"organization_id" uuid NOT NULL,
	"design_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "design_favorites_design_id_user_id_pk" PRIMARY KEY("design_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "design_favorites" ADD CONSTRAINT "design_favorites_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_favorites" ADD CONSTRAINT "design_favorites_organization_id_design_id_designs_organization_id_id_fk" FOREIGN KEY ("organization_id","design_id") REFERENCES "public"."designs"("organization_id","id") ON DELETE cascade ON UPDATE no action;