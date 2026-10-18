ALTER TABLE "organizations" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "deleted_by_user_id" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "deleted_by_user_id" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "deleted_by_user_id" text;--> statement-breakpoint
ALTER TABLE "designs" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "designs" ADD COLUMN "deleted_by_user_id" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_deleted_by_user_id_user_id_fk" FOREIGN KEY ("deleted_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_deleted_by_user_id_user_id_fk" FOREIGN KEY ("deleted_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_deleted_by_user_id_user_id_fk" FOREIGN KEY ("deleted_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "designs" ADD CONSTRAINT "designs_deleted_by_user_id_user_id_fk" FOREIGN KEY ("deleted_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "clients_trash_idx" ON "clients" USING btree ("organization_id","deleted_at") WHERE "clients"."deleted_at" is not null;--> statement-breakpoint
CREATE INDEX "projects_trash_idx" ON "projects" USING btree ("organization_id","deleted_at") WHERE "projects"."deleted_at" is not null;--> statement-breakpoint
CREATE INDEX "designs_trash_idx" ON "designs" USING btree ("organization_id","deleted_at") WHERE "designs"."deleted_at" is not null;--> statement-breakpoint
-- Novas permissões de exclusão (lixeira) para os papéis que já existem.
SELECT set_config('app.rls_bypass', 'on', false);--> statement-breakpoint
UPDATE roles SET permissions = array_append(permissions, 'clients.delete')
WHERE kind = 'internal' AND key IN ('owner', 'admin', 'manager') AND NOT ('clients.delete' = ANY(permissions));--> statement-breakpoint
UPDATE roles SET permissions = array_append(permissions, 'projects.delete')
WHERE kind = 'internal' AND key IN ('owner', 'admin', 'manager') AND NOT ('projects.delete' = ANY(permissions));--> statement-breakpoint
UPDATE roles SET permissions = array_append(permissions, 'designs.delete')
WHERE kind = 'internal' AND key IN ('owner', 'admin', 'manager') AND NOT ('designs.delete' = ANY(permissions));--> statement-breakpoint
SELECT set_config('app.rls_bypass', 'off', false);
