CREATE TABLE "client_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT 'slate' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_categories_organizationId_id_unique" UNIQUE("organization_id","id")
);
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "category_id" uuid;--> statement-breakpoint
ALTER TABLE "client_categories" ADD CONSTRAINT "client_categories_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "client_categories_org_name_unique" ON "client_categories" USING btree ("organization_id",lower("name"));--> statement-breakpoint
CREATE INDEX "client_categories_organization_id_position_index" ON "client_categories" USING btree ("organization_id","position");--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_organization_id_category_id_client_categories_organization_id_id_fk" FOREIGN KEY ("organization_id","category_id") REFERENCES "public"."client_categories"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "clients_organization_id_category_id_index" ON "clients" USING btree ("organization_id","category_id");--> statement-breakpoint
-- Categorias iniciais para as agências que já existem. Só insere: nenhum cliente muda
-- de categoria (todos ficam em "Sem categoria" até a equipe organizar). A tabela
-- organizations tem RLS forçado, então a leitura usa o bypass de sistema apenas
-- durante esta inserção; o RLS de client_categories é aplicado ao fim das migrações
-- (app_apply_tenant_rls, em scripts/migrate.ts).
SELECT set_config('app.rls_bypass', 'on', true);--> statement-breakpoint
INSERT INTO "client_categories" ("organization_id", "name", "color", "position")
SELECT o."id", c."name", c."color", c."position"
FROM "organizations" o
CROSS JOIN (VALUES ('Clientes ativos', 'green', 0), ('Projetos avulsos', 'amber', 1), ('Ex-clientes', 'slate', 2))
  AS c("name", "color", "position")
ON CONFLICT DO NOTHING;--> statement-breakpoint
SELECT set_config('app.rls_bypass', '', true);
