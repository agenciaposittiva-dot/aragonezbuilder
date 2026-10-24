CREATE TYPE "public"."recurrence_frequency" AS ENUM('daily', 'weekly', 'monthly');--> statement-breakpoint
CREATE TABLE "task_recurrences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"assignee_membership_id" uuid,
	"priority" "priority" DEFAULT 'medium' NOT NULL,
	"frequency" "recurrence_frequency" NOT NULL,
	"interval" integer DEFAULT 1 NOT NULL,
	"weekday" integer,
	"monthday" integer,
	"due_in_days" integer DEFAULT 0 NOT NULL,
	"next_run_on" date NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_run_on" date,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_recurrences_organizationId_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "task_recurrences_interval" CHECK ("task_recurrences"."interval" between 1 and 12),
	CONSTRAINT "task_recurrences_weekday" CHECK ("task_recurrences"."weekday" is null or "task_recurrences"."weekday" between 0 and 6),
	CONSTRAINT "task_recurrences_monthday" CHECK ("task_recurrences"."monthday" is null or "task_recurrences"."monthday" between 1 and 28),
	CONSTRAINT "task_recurrences_due" CHECK ("task_recurrences"."due_in_days" between 0 and 60)
);
--> statement-breakpoint
CREATE TABLE "reference_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_id" uuid,
	"project_id" uuid,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"kind" text DEFAULT 'link' NOT NULL,
	"note" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reference_links_organizationId_id_unique" UNIQUE("organization_id","id")
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "recurrence_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "recurrence_on" date;--> statement-breakpoint
ALTER TABLE "task_recurrences" ADD CONSTRAINT "task_recurrences_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_recurrences" ADD CONSTRAINT "task_recurrences_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_recurrences" ADD CONSTRAINT "task_recurrences_organization_id_project_id_projects_organization_id_id_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."projects"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_recurrences" ADD CONSTRAINT "task_recurrences_organization_id_assignee_membership_id_memberships_organization_id_id_fk" FOREIGN KEY ("organization_id","assignee_membership_id") REFERENCES "public"."memberships"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reference_links" ADD CONSTRAINT "reference_links_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reference_links" ADD CONSTRAINT "reference_links_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reference_links" ADD CONSTRAINT "reference_links_organization_id_client_id_clients_organization_id_id_fk" FOREIGN KEY ("organization_id","client_id") REFERENCES "public"."clients"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reference_links" ADD CONSTRAINT "reference_links_organization_id_project_id_projects_organization_id_id_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."projects"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_recurrences_active_next_run_on_index" ON "task_recurrences" USING btree ("active","next_run_on");--> statement-breakpoint
CREATE INDEX "reference_links_organization_id_created_at_index" ON "reference_links" USING btree ("organization_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "reference_links_title_trgm" ON "reference_links" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_recurrence_id_task_recurrences_id_fk" FOREIGN KEY ("recurrence_id") REFERENCES "public"."task_recurrences"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_recurrence_occurrence_unique" ON "tasks" USING btree ("recurrence_id","recurrence_on") WHERE "tasks"."recurrence_id" is not null;