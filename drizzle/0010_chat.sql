CREATE TYPE "public"."chat_conversation_kind" AS ENUM('direct', 'group', 'channel', 'project', 'task');--> statement-breakpoint
CREATE TABLE "chat_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"message_id" uuid,
	"uploaded_by_user_id" text,
	"name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"storage_key" text NOT NULL,
	"width" integer,
	"height" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" "chat_conversation_kind" NOT NULL,
	"name" text,
	"topic" text,
	"department" text,
	"project_id" uuid,
	"task_id" uuid,
	"is_private" boolean DEFAULT false NOT NULL,
	"posting_policy" text DEFAULT 'all' NOT NULL,
	"direct_key" text,
	"last_seq" bigint DEFAULT 0 NOT NULL,
	"last_rev" bigint DEFAULT 0 NOT NULL,
	"last_message_at" timestamp with time zone,
	"created_by_user_id" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_conversations_organizationId_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "chat_conversations_direct_unique" UNIQUE("organization_id","direct_key")
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"seq" bigint NOT NULL,
	"rev" bigint NOT NULL,
	"author_user_id" text,
	"client_id" text NOT NULL,
	"kind" text DEFAULT 'text' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"reply_to_id" uuid,
	"mentions" text[] DEFAULT '{}'::text[] NOT NULL,
	"refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"task_id" uuid,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"deleted_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_messages_organizationId_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "chat_messages_seq_unique" UNIQUE("conversation_id","seq"),
	CONSTRAINT "chat_messages_client_unique" UNIQUE("conversation_id","client_id")
);
--> statement-breakpoint
CREATE TABLE "chat_participants" (
	"organization_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"last_read_seq" bigint DEFAULT 0 NOT NULL,
	"last_read_at" timestamp with time zone,
	"notify" text DEFAULT 'all' NOT NULL,
	"muted_until" timestamp with time zone,
	"pinned_at" timestamp with time zone,
	"favorite_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"typing_until" timestamp with time zone,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_participants_conversation_id_user_id_pk" PRIMARY KEY("conversation_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "chat_reactions" (
	"organization_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"emoji" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_reactions_message_id_user_id_emoji_pk" PRIMARY KEY("message_id","user_id","emoji")
);
--> statement-breakpoint
CREATE TABLE "chat_user_status" (
	"organization_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"availability" text DEFAULT 'available' NOT NULL,
	"show_last_seen" boolean DEFAULT true NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_user_status_organization_id_user_id_pk" PRIMARY KEY("organization_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "chat_attachments" ADD CONSTRAINT "chat_attachments_uploaded_by_user_id_user_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_attachments" ADD CONSTRAINT "chat_attachments_organization_id_conversation_id_chat_conversations_organization_id_id_fk" FOREIGN KEY ("organization_id","conversation_id") REFERENCES "public"."chat_conversations"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_attachments" ADD CONSTRAINT "chat_attachments_organization_id_message_id_chat_messages_organization_id_id_fk" FOREIGN KEY ("organization_id","message_id") REFERENCES "public"."chat_messages"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_conversations" ADD CONSTRAINT "chat_conversations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_conversations" ADD CONSTRAINT "chat_conversations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_conversations" ADD CONSTRAINT "chat_conversations_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_conversations" ADD CONSTRAINT "chat_conversations_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_author_user_id_user_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_deleted_by_user_id_user_id_fk" FOREIGN KEY ("deleted_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_organization_id_conversation_id_chat_conversations_organization_id_id_fk" FOREIGN KEY ("organization_id","conversation_id") REFERENCES "public"."chat_conversations"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_participants" ADD CONSTRAINT "chat_participants_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_participants" ADD CONSTRAINT "chat_participants_organization_id_conversation_id_chat_conversations_organization_id_id_fk" FOREIGN KEY ("organization_id","conversation_id") REFERENCES "public"."chat_conversations"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_reactions" ADD CONSTRAINT "chat_reactions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_reactions" ADD CONSTRAINT "chat_reactions_organization_id_message_id_chat_messages_organization_id_id_fk" FOREIGN KEY ("organization_id","message_id") REFERENCES "public"."chat_messages"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_user_status" ADD CONSTRAINT "chat_user_status_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_user_status" ADD CONSTRAINT "chat_user_status_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_attachments_conversation_id_created_at_index" ON "chat_attachments" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "chat_attachments_message_id_index" ON "chat_attachments" USING btree ("message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_conversations_project_unique" ON "chat_conversations" USING btree ("organization_id","project_id") WHERE "chat_conversations"."kind" = 'project';--> statement-breakpoint
CREATE UNIQUE INDEX "chat_conversations_task_unique" ON "chat_conversations" USING btree ("organization_id","task_id") WHERE "chat_conversations"."kind" = 'task';--> statement-breakpoint
CREATE INDEX "chat_conversations_organization_id_last_message_at_index" ON "chat_conversations" USING btree ("organization_id","last_message_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "chat_messages_conversation_id_rev_index" ON "chat_messages" USING btree ("conversation_id","rev");--> statement-breakpoint
CREATE INDEX "chat_messages_organization_id_author_user_id_created_at_index" ON "chat_messages" USING btree ("organization_id","author_user_id","created_at");--> statement-breakpoint
CREATE INDEX "chat_messages_body_trgm" ON "chat_messages" USING gin ("body" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "chat_participants_organization_id_user_id_index" ON "chat_participants" USING btree ("organization_id","user_id");--> statement-breakpoint
-- Permissões do chat para os papéis internos já existentes.
SELECT set_config('app.rls_bypass', 'on', false);--> statement-breakpoint
UPDATE roles SET permissions = array_append(permissions, 'chat.use')
WHERE kind = 'internal' AND is_system AND NOT ('chat.use' = ANY(permissions));--> statement-breakpoint
UPDATE roles SET permissions = array_append(permissions, 'chat.manage_channels')
WHERE kind = 'internal' AND key IN ('owner', 'admin', 'manager') AND NOT ('chat.manage_channels' = ANY(permissions));--> statement-breakpoint
SELECT set_config('app.rls_bypass', 'off', false);
