import { notFound } from "next/navigation";
import { TaskDetail } from "@/components/tasks/detail/task-detail";
import { TaskPanel } from "@/components/tasks/task-panel";
import { requireActor } from "@/server/auth/session";

/**
 * Detalhes da tarefa abertos a partir da lista, do quadro ou do calendário:
 * painel lateral sobre a visão atual. Acesso direto pelo link abre a página.
 */
export default async function TaskPanelPage({ params }: PageProps<"/w/[org]/tasks/[id]">) {
  const { org, id } = await params;
  const actor = await requireActor(org, { kind: "internal", permission: "tasks.read" });
  const detail = await TaskDetail({ actor, id, variant: "panel" });
  if (!detail) notFound();
  return <TaskPanel pageHref={`/w/${actor.orgSlug}/tasks/${id}`}>{detail}</TaskPanel>;
}
