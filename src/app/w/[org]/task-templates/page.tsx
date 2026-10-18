import { LayoutTemplate, Pencil, Plus } from "lucide-react";
import type { Metadata } from "next";
import { PriorityLabel } from "@/components/app/priority";
import {
  ApplyTemplateDialog,
  DeleteTemplateButton,
  TemplateEditorDialog,
  type TemplateDraft,
} from "@/components/tasks/task-templates";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { can, inOrg } from "@/server/authz";
import { requireActor } from "@/server/auth/session";
import { listInternalMembers } from "@/server/services/members";
import { projectOptions } from "@/server/services/projects";
import { getTemplate, listTemplates } from "@/server/services/task-templates";

export const metadata: Metadata = { title: "Modelos de tarefa" };

export default async function TaskTemplatesPage({ params, searchParams }: PageProps<"/w/[org]/task-templates">) {
  const { org } = await params;
  const sp = await searchParams;
  const actor = await requireActor(org, { kind: "internal", permission: "tasks.read" });
  const data = await inOrg(actor, async (s) => {
    const list = await listTemplates(s);
    const full = [];
    for (const t of list) full.push({ row: t, ...(await getTemplate(s, t.id)) });
    return { templates: full, projects: await projectOptions(s), members: await listInternalMembers(s) };
  });
  const canWrite = can(actor, "tasks.write");
  const canDelete = can(actor, "tasks.delete");
  const focus = typeof sp.modelo === "string" ? sp.modelo : null;
  const projects = data.projects.map((p) => ({ id: p.id, name: p.name, clientName: p.clientName }));
  const members = data.members.map((m) => ({ membershipId: m.membershipId, name: m.name, image: m.image }));
  const options = data.templates.map((t) => ({ id: t.row.id, name: t.row.name, steps: t.row.steps }));
  const draftOf = (t: (typeof data.templates)[number]): TemplateDraft => ({
    id: t.template.id,
    name: t.template.name,
    description: t.template.description,
    priority: t.template.priority,
    dueOffsetDays: t.template.dueOffsetDays,
    estimateMinutes: t.template.estimateMinutes,
    checklist: t.template.checklist,
    steps: t.steps.map((st) => ({
      title: st.title,
      dueOffsetDays: st.dueOffsetDays,
      estimateMinutes: st.estimateMinutes,
      checklist: st.checklist,
    })),
  });

  return (
    <>
      <Breadcrumbs items={[{ label: "Tarefas", href: `/w/${actor.orgSlug}/tasks` }, { label: "Modelos" }]} />
      <PageHeader
        title="Modelos de tarefa"
        description="Processos recorrentes prontos para usar: a tarefa principal, as etapas com prazos relativos e os checklists."
        actions={
          canWrite ? (
            <TemplateEditorDialog
              trigger={
                <Button variant="primary">
                  <Plus /> Novo modelo
                </Button>
              }
            />
          ) : null
        }
      />
      {data.templates.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface">
          <EmptyState
            icon={LayoutTemplate}
            title="Nenhum modelo ainda"
            description="Crie um modelo do zero ou abra uma tarefa e use “Salvar como modelo”."
          />
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.templates.map((t) => (
            <li key={t.row.id}>
              <Card className="flex h-full flex-col p-4">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="min-w-0 font-semibold">{t.row.name}</h2>
                  <PriorityLabel priority={t.row.priority} />
                </div>
                {t.row.description ? <p className="mt-1 text-sm text-fg-muted">{t.row.description}</p> : null}
                <ol className="mt-3 grid gap-1 text-sm">
                  {t.steps.slice(0, 6).map((st, i) => (
                    <li key={st.id} className="flex items-baseline gap-2">
                      <span className="tabular w-5 shrink-0 text-xs text-fg-subtle">{i + 1}.</span>
                      <span className="min-w-0 flex-1 truncate">{st.title}</span>
                      {st.dueOffsetDays !== null ? (
                        <span className="text-xs text-fg-subtle">dia {st.dueOffsetDays}</span>
                      ) : null}
                    </li>
                  ))}
                  {t.steps.length > 6 ? <li className="text-xs text-fg-subtle">+{t.steps.length - 6} etapas</li> : null}
                  {t.steps.length === 0 ? <li className="text-xs text-fg-subtle">Sem etapas.</li> : null}
                </ol>
                <div className="mt-auto flex flex-wrap gap-2 pt-4">
                  {canWrite ? (
                    <>
                      <ApplyTemplateDialog
                        templates={options}
                        projects={projects}
                        members={members}
                        defaultTemplateId={t.row.id}
                        trigger={
                          <Button size="sm" variant="primary">
                            <LayoutTemplate /> Usar modelo
                          </Button>
                        }
                      />
                      <TemplateEditorDialog
                        initial={draftOf(t)}
                        defaultOpen={focus === t.row.id}
                        trigger={
                          <Button size="sm" variant="secondary">
                            <Pencil /> Editar
                          </Button>
                        }
                      />
                    </>
                  ) : null}
                  {canDelete ? <DeleteTemplateButton id={t.row.id} name={t.row.name} /> : null}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
