import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MachineWizard } from "@/components/machine/machine-wizard";
import { can, inOrg } from "@/server/authz";
import { requireActor } from "@/server/auth/session";
import { NotFoundError } from "@/server/errors";
import { getPickerData } from "@/server/services/ai-models";
import { clientOptions } from "@/server/services/clients";
import { getMachineProject, machineTrendOptions } from "@/server/services/content-machine";

export const metadata: Metadata = { title: "Máquina de Conteúdo" };

export default async function MachineProjectPage({ params }: PageProps<"/w/[org]/maquina/[id]">) {
  const { org, id } = await params;
  const actor = await requireActor(org, { kind: "internal", permission: "content.read" });
  const data = await inOrg(actor, async (s) => {
    try {
      return {
        view: await getMachineProject(s, id),
        clients: await clientOptions(s),
        trends: await machineTrendOptions(s),
        picker: can(actor, "ai.use") ? await getPickerData(s) : null,
      };
    } catch (err) {
      if (err instanceof NotFoundError) return null;
      throw err;
    }
  });
  if (!data) notFound();
  return (
    <MachineWizard
      // Recomeça a tela só quando a arte muda (gerada, nova direção); o salvamento automático não recarrega.
      key={`${data.view.project.id}:${data.view.design?.id ?? "-"}:${data.view.design?.revision ?? 0}`}
      view={data.view}
      clients={data.clients}
      trends={data.trends.map((t) => ({ ...t, lastSeenAt: t.lastSeenAt.toISOString() }))}
      picker={data.picker}
      can={{
        write: can(actor, "content.write"),
        ai: can(actor, "ai.use"),
        trends: can(actor, "trends.read"),
        files: can(actor, "files.write"),
        designs: can(actor, "designs.write"),
        tasks: can(actor, "tasks.write"),
        approvals: can(actor, "approvals.request"),
      }}
    />
  );
}
