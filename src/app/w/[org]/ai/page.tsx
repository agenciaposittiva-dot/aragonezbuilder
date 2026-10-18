import type { Metadata } from "next";
import { AiStudio } from "@/components/ai/ai-studio";
import { PageHeader } from "@/components/ui/page-header";
import { can, inOrg } from "@/server/authz";
import { requireActor } from "@/server/auth/session";
import { listGenerations, resolveProvider, usageCounters } from "@/server/services/ai";
import { clientOptions } from "@/server/services/clients";
import { getSettings } from "@/server/services/organizations";
import { projectOptions } from "@/server/services/projects";

export const metadata: Metadata = { title: "Assistente IA" };

export default async function AiPage({ params }: PageProps<"/w/[org]/ai">) {
  const { org } = await params;
  const actor = await requireActor(org, { kind: "internal", permission: "ai.use" });
  const data = await inOrg(actor, async (s) => {
    const settings = (await getSettings(s)).ai;
    const resolved = await resolveProvider(s);
    return {
      settings,
      resolved: { demo: resolved.demo, label: resolved.provider.label, model: resolved.model },
      counters: await usageCounters(s),
      clients: await clientOptions(s),
      projects: await projectOptions(s),
      history: await listGenerations(s, { limit: 30 }),
    };
  });
  return (
    <>
      <PageHeader
        title="Assistente IA"
        description="Ideias, textos, roteiros e planejamentos com o contexto de cada marca. Você revisa tudo antes de usar."
      />
      <AiStudio
        status={{
          enabled: data.settings.enabled,
          demo: data.resolved.demo,
          providerLabel: data.resolved.label,
          model: data.resolved.model,
          allowClientContext: data.settings.allowClientContext,
          monthTokens: data.counters.monthTokens,
          monthlyTokenLimit: data.settings.monthlyTokenLimit,
          myRequestsToday: data.counters.myRequestsToday,
          userDailyRequestLimit: data.settings.userDailyRequestLimit,
        }}
        clients={data.clients}
        projects={data.projects.map((p) => ({ id: p.id, name: p.name, clientName: p.clientName }))}
        history={data.history}
        canConfigure={can(actor, "ai.settings")}
        canCreateTasks={can(actor, "tasks.write")}
      />
    </>
  );
}
