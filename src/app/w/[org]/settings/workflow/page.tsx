import type { Metadata } from "next";
import { WorkflowEditor } from "@/components/settings/workflow-editor";
import { inOrg } from "@/server/authz";
import { requireActor } from "@/server/auth/session";
import { listStatuses, listTransitions } from "@/server/services/workflow";

export const metadata: Metadata = { title: "Fluxos de status" };

export default async function WorkflowPage({ params }: PageProps<"/w/[org]/settings/workflow">) {
  const { org } = await params;
  const actor = await requireActor(org, { kind: "internal", permission: "org.manage" });
  const { projectStatuses, taskStatuses, transitions } = await inOrg(actor, async (s) => ({
    projectStatuses: await listStatuses(s, "project"),
    taskStatuses: await listStatuses(s, "task"),
    transitions: await listTransitions(s),
  }));
  const pick = (list: typeof projectStatuses) =>
    list.map((s) => ({ id: s.id, name: s.name, category: s.category, color: s.color, isDefault: s.isDefault }));
  const ids = (list: typeof projectStatuses) => new Set(list.map((s) => s.id));
  const projectIds = ids(projectStatuses);
  const taskIds = ids(taskStatuses);
  return (
    <div className="grid gap-6">
      <WorkflowEditor
        entity="project"
        title="Projetos"
        description="Status disponíveis para projetos e as mudanças permitidas entre eles."
        statuses={pick(projectStatuses)}
        transitions={transitions.filter((t) => projectIds.has(t.fromStatusId))}
      />
      <WorkflowEditor
        entity="task"
        title="Tarefas"
        description="Colunas do Kanban de tarefas, na ordem exibida."
        statuses={pick(taskStatuses)}
        transitions={transitions.filter((t) => taskIds.has(t.fromStatusId))}
      />
    </div>
  );
}
