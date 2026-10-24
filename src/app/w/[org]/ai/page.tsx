import { GalleryHorizontal } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { AiStudio } from "@/components/ai/ai-studio";
import { DesignAiSection } from "@/components/ai/design-ai-section";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { can, inOrg } from "@/server/authz";
import { requireActor } from "@/server/auth/session";
import { listGenerations, usageCounters } from "@/server/services/ai";
import { getPickerData } from "@/server/services/ai-models";
import { clientOptions } from "@/server/services/clients";
import { designAiTargets } from "@/server/services/design-ai";
import { listInternalMembers } from "@/server/services/members";
import { getSettings } from "@/server/services/organizations";
import { projectOptions } from "@/server/services/projects";

export const metadata: Metadata = { title: "Criação com IA" };

export default async function AiPage({ params, searchParams }: PageProps<"/w/[org]/ai">) {
  const sp = await searchParams;
  // Atalho do painel: ?ferramenta=imagem (ou a chave de uma operação de texto).
  const ferramenta =
    typeof sp.ferramenta === "string" ? (sp.ferramenta === "imagem" ? "image" : sp.ferramenta) : undefined;
  const { org } = await params;
  const actor = await requireActor(org, { kind: "internal", permission: "ai.use" });
  const data = await inOrg(actor, async (s) => {
    const settings = (await getSettings(s)).ai;
    // Valida credenciais pendentes antes de listar modelos: só aparecem modelos realmente disponíveis.
    const picker = await getPickerData(s, { refresh: settings.enabled });
    return {
      settings,
      picker,
      counters: await usageCounters(s),
      clients: await clientOptions(s),
      projects: await projectOptions(s),
      // "Criar demanda com este texto": responsáveis do formulário de demanda.
      members: can(actor, "tasks.write") ? await listInternalMembers(s) : [],
      history: await listGenerations(s, { limit: 30 }),
      // Chat de edição de artes existentes: só para quem pode editar artes.
      designs: can(actor, "designs.write") ? await designAiTargets(s) : null,
    };
  });
  const ready = data.picker.providers.filter((p) => p.ready);
  return (
    <>
      <PageHeader
        title="Criação com IA"
        description="Ideias, textos, roteiros, planejamentos e imagens com o contexto de cada marca. Você revisa tudo antes de usar."
        actions={
          can(actor, "designs.write") ? (
            <Button asChild variant="secondary">
              <Link href={`/w/${actor.orgSlug}/studio/gerar`}>
                <GalleryHorizontal /> Gerar carrossel com IA
              </Link>
            </Button>
          ) : null
        }
      />
      <AiStudio
        initialOp={ferramenta}
        status={{
          enabled: data.settings.enabled,
          configured: ready.length > 0,
          demo: ready.length > 0 && ready.every((p) => p.id === "demo"),
          allowClientContext: data.settings.allowClientContext,
          monthTokens: data.counters.monthTokens,
          monthlyTokenLimit: data.settings.monthlyTokenLimit,
          myRequestsToday: data.counters.myRequestsToday,
          userDailyRequestLimit: data.settings.userDailyRequestLimit,
        }}
        picker={data.picker}
        clients={data.clients}
        members={data.members.map((m) => ({
          membershipId: m.membershipId,
          name: m.name,
          image: m.image,
          jobTitle: m.jobTitle,
          roleName: m.roleName,
        }))}
        projects={data.projects.map((p) => ({ id: p.id, name: p.name, clientName: p.clientName }))}
        history={data.history}
        canConfigure={can(actor, "ai.settings")}
        canCreateTasks={can(actor, "tasks.write")}
        canSaveFiles={can(actor, "files.write")}
      />
      {data.designs ? <DesignAiSection targets={data.designs} /> : null}
    </>
  );
}
