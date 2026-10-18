import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RuleBuilder } from "@/components/automations/rule-builder";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { inOrg } from "@/server/authz";
import { requireActor } from "@/server/auth/session";
import { NotFoundError } from "@/server/errors";
import { getRule, ruleBuilderOptions } from "@/server/services/automations";

export const metadata: Metadata = { title: "Editar automação" };

export default async function EditAutomationPage({ params }: PageProps<"/w/[org]/automations/[id]">) {
  const { org, id } = await params;
  const actor = await requireActor(org, { kind: "internal", permission: "automations.manage" });
  const data = await inOrg(actor, async (s) => {
    try {
      return { rule: await getRule(s, id), options: await ruleBuilderOptions(s) };
    } catch (e) {
      if (e instanceof NotFoundError) return null;
      throw e;
    }
  });
  if (!data) notFound();
  const { rule, options } = data;
  return (
    <div className="mx-auto max-w-3xl">
      <Breadcrumbs items={[{ label: "Automações", href: `/w/${actor.orgSlug}/automations` }, { label: rule.name }]} />
      <PageHeader
        title="Editar automação"
        actions={
          <Button variant="secondary" asChild>
            <Link href={`/w/${actor.orgSlug}/automations/${id}/runs`}>Ver execuções</Link>
          </Button>
        }
      />
      <RuleBuilder
        ruleId={rule.id}
        options={options}
        initial={{
          name: rule.name,
          description: rule.description,
          trigger: rule.trigger,
          conditions: rule.conditions as never,
          actions: rule.actions as never,
          enabled: rule.enabled,
        }}
      />
    </div>
  );
}
