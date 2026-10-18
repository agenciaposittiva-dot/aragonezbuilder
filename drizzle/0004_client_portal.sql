CREATE TABLE "client_portal_settings" (
	"organization_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"draft" jsonb,
	"published" jsonb,
	"version" integer DEFAULT 0 NOT NULL,
	"published_at" timestamp with time zone,
	"published_by_user_id" text,
	"login_enabled" boolean DEFAULT true NOT NULL,
	"allow_guest_invites" boolean DEFAULT false NOT NULL,
	"updated_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_portal_settings_organization_id_client_id_pk" PRIMARY KEY("organization_id","client_id")
);
--> statement-breakpoint
CREATE TABLE "client_portal_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"settings" jsonb NOT NULL,
	"published_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_portal_versions_organizationId_clientId_version_unique" UNIQUE("organization_id","client_id","version")
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"organization_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"email" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"in_app" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_preferences_organization_id_user_id_pk" PRIMARY KEY("organization_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "slug" text;--> statement-breakpoint
-- Preenche o endereço dos clientes existentes a partir do nome (sem acentos,
-- minúsculo, hífens), com sufixo -2, -3… para nomes repetidos na organização.
-- O bypass de RLS vale só nesta sessão de migração (o dono também está sob FORCE RLS).
SELECT set_config('app.rls_bypass', 'on', false);--> statement-breakpoint
WITH base AS (
  SELECT id, organization_id, created_at,
    coalesce(nullif(left(trim(both '-' from regexp_replace(lower(translate(name,
      'áàâãäåéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÅÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
      'aaaaaaeeeeiiiiooooouuuucnaaaaaaeeeeiiiiooooouuuucn')), '[^a-z0-9]+', '-', 'g')), 48), ''), 'cliente') AS s
  FROM clients
), fixed AS (
  SELECT id, organization_id, created_at,
    CASE WHEN s IN ('entrar','ir','approvals','requests','files','projects','brand','account','equipe','team','notificacoes','notifications','settings','new','api','login','logout') THEN s || '-cliente' ELSE s END AS s
  FROM base
), numbered AS (
  SELECT id, s, row_number() OVER (PARTITION BY organization_id, s ORDER BY created_at, id) AS n FROM fixed
)
UPDATE clients c SET slug = CASE WHEN n.n = 1 THEN n.s ELSE n.s || '-' || n.n END
FROM numbered n WHERE n.id = c.id;--> statement-breakpoint
ALTER TABLE "clients" ALTER COLUMN "slug" SET NOT NULL;--> statement-breakpoint
-- Papéis de convidado para organizações já existentes (as novas recebem no cadastro).
INSERT INTO roles (organization_id, key, name, description, kind, permissions, is_system)
SELECT o.id, v.key, v.name, v.description, 'client', v.permissions, true
FROM organizations o
CROSS JOIN (VALUES
  ('client_admin', 'Administrador do cliente', 'Projetos, solicitações, aprovações e materiais; convida colegas quando a agência permite.',
    ARRAY['portal.access','clients.read','projects.read','requests.read','requests.write','files.read','approvals.decide_client','portal.comment','portal.invite']::text[]),
  ('client_requester', 'Solicitante', 'Abre demandas, envia arquivos e acompanha as próprias solicitações e os projetos.',
    ARRAY['portal.access','clients.read','projects.read','requests.write','files.read','portal.comment']::text[]),
  ('client_approver', 'Aprovador', 'Revisa os materiais enviados para aprovação, aprova versões ou pede ajustes.',
    ARRAY['portal.access','clients.read','files.read','approvals.decide_client','portal.comment']::text[]),
  ('client_viewer', 'Visualizador', 'Consulta projetos e baixa os materiais compartilhados, sem criar demandas nem aprovar.',
    ARRAY['portal.access','clients.read','projects.read','files.read']::text[])
) AS v(key, name, description, permissions)
WHERE NOT EXISTS (SELECT 1 FROM roles r WHERE r.organization_id = o.id AND r.key = v.key);--> statement-breakpoint
-- Comentar passa a ser uma permissão explícita: papéis de cliente existentes a mantêm.
UPDATE roles SET permissions = array_append(permissions, 'portal.comment')
WHERE kind = 'client' AND key NOT IN ('client_viewer') AND NOT ('portal.comment' = ANY(permissions));--> statement-breakpoint
UPDATE roles SET name = 'Cliente (acesso completo)' WHERE key = 'client' AND is_system AND name = 'Cliente';--> statement-breakpoint
SELECT set_config('app.rls_bypass', 'off', false);--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "portal_visible" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "client_portal_settings" ADD CONSTRAINT "client_portal_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_portal_settings" ADD CONSTRAINT "client_portal_settings_published_by_user_id_user_id_fk" FOREIGN KEY ("published_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_portal_settings" ADD CONSTRAINT "client_portal_settings_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_portal_settings" ADD CONSTRAINT "client_portal_settings_organization_id_client_id_clients_organization_id_id_fk" FOREIGN KEY ("organization_id","client_id") REFERENCES "public"."clients"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_portal_versions" ADD CONSTRAINT "client_portal_versions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_portal_versions" ADD CONSTRAINT "client_portal_versions_published_by_user_id_user_id_fk" FOREIGN KEY ("published_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_portal_versions" ADD CONSTRAINT "client_portal_versions_organization_id_client_id_clients_organization_id_id_fk" FOREIGN KEY ("organization_id","client_id") REFERENCES "public"."clients"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_preferences_user_id_index" ON "notification_preferences" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_org_slug_unique" UNIQUE("organization_id","slug");