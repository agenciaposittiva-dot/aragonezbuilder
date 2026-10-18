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

export const metadata: Metadata = { title: "Gerar carrossel com IA" };

export default async function GenerateCarouselPage({ params, searchParams }: PageProps<"/w/[org]/studio/gerar">) {
  const { org } = await params;
  const sp = await searchParams;
  const actor = await requireActor(org, { kind: "internal", permission: "designs.write" });
  const data = await inOrg(actor, async (s) => ({
    clients: await clientOptions(s),
    projects: await projectOptions(s),
    picker: can(actor, "ai.use") ? await getPickerData(s) : { providers: [], preferences: [] },
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
        />
      ) : (
        <p className="rounded-xl border border-border bg-surface p-6 text-sm text-fg-muted">
          Seu papel não permite usar a IA. Peça acesso a um administrador.
        </p>
      )}
    </>
  );
}
