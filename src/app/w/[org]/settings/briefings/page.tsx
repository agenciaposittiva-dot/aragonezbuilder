import type { Metadata } from "next";
import { TemplateBuilder } from "@/components/briefings/template-builder";
import { inOrg } from "@/server/authz";
import { requireActor } from "@/server/auth/session";
import { listTemplates } from "@/server/services/briefings";

export const metadata: Metadata = { title: "Modelos de briefing" };

export default async function BriefingsSettingsPage({ params }: PageProps<"/w/[org]/settings/briefings">) {
  const { org } = await params;
  const actor = await requireActor(org, { kind: "internal", permission: "briefings.manage" });
  const templates = await inOrg(actor, (s) => listTemplates(s));
  return (
    <TemplateBuilder
      templates={templates.map((t) => ({
        id: t.id,
        name: t.name,
        category: t.category,
        description: t.description,
        isActive: t.isActive,
        fields: t.fields,
      }))}
    />
  );
}
