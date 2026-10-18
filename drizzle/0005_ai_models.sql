CREATE TYPE "public"."ai_provider_status" AS ENUM('unverified', 'valid', 'invalid', 'error');--> statement-breakpoint
CREATE TABLE "ai_model_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" text,
	"module" text DEFAULT '' NOT NULL,
	"task" text DEFAULT '' NOT NULL,
	"provider" text,
	"model" text,
	"priority" text DEFAULT 'balanced' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_provider_configs" (
	"organization_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"key_encrypted" text,
	"status" "ai_provider_status" DEFAULT 'unverified' NOT NULL,
	"last_error" text,
	"last_checked_at" timestamp with time zone,
	"models" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"models_fetched_at" timestamp with time zone,
	"updated_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_provider_configs_organization_id_provider_pk" PRIMARY KEY("organization_id","provider")
);
--> statement-breakpoint
ALTER TABLE "ai_usage" ALTER COLUMN "cost_micros" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "ai_usage" ALTER COLUMN "cost_micros" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD COLUMN "module" text;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD COLUMN "task" text;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD COLUMN "selection_source" text;--> statement-breakpoint
ALTER TABLE "ai_model_preferences" ADD CONSTRAINT "ai_model_preferences_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_model_preferences" ADD CONSTRAINT "ai_model_preferences_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_provider_configs" ADD CONSTRAINT "ai_provider_configs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_provider_configs" ADD CONSTRAINT "ai_provider_configs_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_model_preferences_scope" ON "ai_model_preferences" USING btree ("organization_id",coalesce("user_id", ''),"module","task");--> statement-breakpoint
-- Leva as chaves já salvas nas configurações da organização (criptografadas)
-- para a nova tabela de integrações. Os valores continuam criptografados; a
-- validação acontece no primeiro uso ou em Configurações → IA.
SELECT set_config('app.rls_bypass', 'on', false);--> statement-breakpoint
INSERT INTO ai_provider_configs (organization_id, provider, enabled, key_encrypted, status)
SELECT o.id, p.provider, true, o.settings -> 'ai' -> 'keys' ->> p.provider, 'unverified'
FROM organizations o
CROSS JOIN (VALUES ('anthropic'), ('openai'), ('gemini')) AS p(provider)
WHERE coalesce(o.settings -> 'ai' -> 'keys' ->> p.provider, '') <> ''
ON CONFLICT DO NOTHING;--> statement-breakpoint
-- Quem usava o modo demonstração de propósito continua com ele (claramente identificado).
INSERT INTO ai_provider_configs (organization_id, provider, enabled, status)
SELECT o.id, 'demo', true, 'valid' FROM organizations o
WHERE o.settings -> 'ai' ->> 'provider' = 'demo'
ON CONFLICT DO NOTHING;--> statement-breakpoint
-- Padrão da organização: só quando havia uma escolha concreta (modelo definido,
-- chave própria do provedor ou demonstração). Sem isso, vale a escolha automática.
INSERT INTO ai_model_preferences (organization_id, user_id, module, task, provider, model, priority)
SELECT o.id, NULL, '', '', o.settings -> 'ai' ->> 'provider', nullif(o.settings -> 'ai' ->> 'model', ''), 'balanced'
FROM organizations o
WHERE o.settings -> 'ai' ->> 'provider' IN ('anthropic', 'openai', 'gemini', 'demo')
  AND (
    coalesce(o.settings -> 'ai' ->> 'model', '') <> ''
    OR coalesce(o.settings -> 'ai' -> 'keys' ->> (o.settings -> 'ai' ->> 'provider'), '') <> ''
    OR o.settings -> 'ai' ->> 'provider' = 'demo'
  )
ON CONFLICT DO NOTHING;--> statement-breakpoint
SELECT set_config('app.rls_bypass', 'off', false);