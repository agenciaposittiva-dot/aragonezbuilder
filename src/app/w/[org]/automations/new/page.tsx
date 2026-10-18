import type { Metadata } from "next";
import { RuleBuilder } from "@/components/automations/rule-builder";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { PageHeader } from "@/components/ui/page-header";
import { AUTOMATION_PRESETS } from "@/lib/automation-presets";
import { inOrg } from "@/server/authz";
import { requireActor } from "@/server/auth/session";
import { ruleBuilderOptions } from "@/server/services/automations";

export const metadata: Metadata = { title: "Nova automação" };

export default async function NewAutomationPage({ params, searchParams }: PageProps<"/w/[org]/automations/new">) {
  const { org } = await params;
  const sp = await searchParams;
  const actor = await requireActor(org, { kind: "internal", permission: "automations.manage" });
  const options = await inOrg(actor, (s) => ruleBuilderOptions(s));
  const preset = AUTOMATION_PRESETS.find((p) => p.key === sp.preset);
  return (
    <div className="mx-auto max-w-3xl">
      <Breadcrumbs items={[{ label: "Automações", href: `/w/${actor.orgSlug}/automations` }, { label: "Nova" }]} />
      <PageHeader
        title="Nova automação"
        description={preset ? `Modelo: ${preset.title}. Revise e salve.` : undefined}
      />
      <RuleBuilder
        options={options}
        initial={
          preset?.rule ?? {
            name: "",
            trigger: "task.created",
            conditions: [],
            actions: [{ type: "notify_members", title: "", toAssignee: true }],
            enabled: true,
          }
        }
      />
    </div>
  );
}
