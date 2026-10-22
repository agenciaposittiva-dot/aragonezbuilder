import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { CarouselGenerator } from "@/components/studio/carousel-generator";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { can, inOrg } from "@/server/authz";
import { requireActor } from "@/server/auth/session";
import { getPickerData } from "@/server/services/ai-models";
import { clientOptions } from "@/server/services/clients";
import { projectOptions } from "@/server/services/projects";
import { getTask } from "@/server/services/tasks";

export const metadata: Metadata = { title: "Gerar carrossel com IA" };

export default async function GenerateCarouselPage({ params, searchParams }: PageProps<"/w/[org]/studio/gerar">) {
  const { org } = await params;
  const sp = await searchParams;
  const actor = await requireActor(org, { kind: "internal", permission: "designs.write" });
  const taskId = typeof sp.taskId === "string" && /^[0-9a-f-]{36}$/i.test(sp.taskId) ? sp.taskId : null;
  const data = await inOrg(actor, async (s) => ({
    clients: await clientOptions(s),
    projects: await projectOptions(s),
    picker: can(actor, "ai.use") ? await getPickerData(s) : { providers: [], preferences: [] },
    // Vindo de uma demanda: confere o acesso e usa o cliente/projeto dela.
    task: taskId
      ? await getTask(s, taskId)
          .then((d) => ({ id: d.task.id, title: d.task.title, projectId: d.task.projectId, clientId: d.clientId }))
          .catch(() => null)
      : null,
  }));
  const clientId =
    typeof sp.clientId === "string" && data.clients.some((c) => c.id === sp.clientId) ? sp.clientId : undefined;
  return (
    <>
      <PageHeader
        title="Gerar carrossel com IA"
        description="Conte o assunto e, se quiser, os detalhes. A IA planeja, escreve e monta um carrossel editável no Estúdio, com a identidade do cliente."
        actions={
          <Button asChild variant="ghost">
            <Link href={`/w/${actor.orgSlug}/studio`}>
              <ArrowLeft /> Estúdio
            </Link>
          </Button>
        }
      />
      {can(actor, "ai.use") ? (
        <CarouselGenerator
          clients={data.clients}
          projects={data.projects.map((p) => ({ id: p.id, name: p.name, clientId: p.clientId }))}
          picker={data.picker}
          defaultClientId={clientId}
          canSaveFiles={can(actor, "files.write")}
          task={data.task ?? undefined}
        />
      ) : (
        <p className="rounded-xl border border-border bg-surface p-6 text-sm text-fg-muted">
          Seu papel não permite usar a IA. Peça acesso a um administrador.
        </p>
      )}
    </>
  );
}
