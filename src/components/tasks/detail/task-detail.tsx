import { Plus, Sparkles } from "lucide-react";
import Link from "next/link";
import { FileAttachments } from "@/components/files/file-attachments";
import { LinkedDesigns } from "@/components/studio/linked-designs";
import { NewDesignDialog } from "@/components/studio/new-design-dialog";
import { Button } from "@/components/ui/button";
import { OpenChatButton } from "@/components/chat/open-chat-button";
import { Comments } from "@/components/app/comments";
import { HistoryList } from "@/components/app/history-list";
import { TaskDoneCheckbox } from "@/components/tasks/task-done-checkbox";
import { TaskActions } from "@/components/tasks/detail/task-actions";
import { TaskAiMenu } from "@/components/tasks/task-ai";
import { TaskChecklist } from "@/components/tasks/detail/task-checklist";
import { TaskDependencies } from "@/components/tasks/detail/task-dependencies";
import { TaskDescription } from "@/components/tasks/detail/task-description";
import { TaskProperties } from "@/components/tasks/detail/task-properties";
import { TaskSubtasks } from "@/components/tasks/detail/task-subtasks";
import { TaskTime } from "@/components/tasks/detail/task-time";
import { TaskTitle } from "@/components/tasks/detail/task-title";
import { Badge } from "@/components/ui/badge";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { can, inOrg } from "@/server/authz";
import type { Actor } from "@/server/authz/actor";
import { NotFoundError } from "@/server/errors";
import { listComments, taskMentionables } from "@/server/services/comments";
import { listDesigns } from "@/server/services/designs";
import { listLabels } from "@/server/services/task-labels";
import { listInternalMembers } from "@/server/services/members";
import { getTask, projectTaskOptions, taskHistory } from "@/server/services/tasks";
import { getRunningTimer, listTimeEntries } from "@/server/services/time-entries";
import { listStatuses, listTransitions } from "@/server/services/workflow";

/**
 * Conteúdo completo de uma tarefa. Usado na página dedicada e no painel
 * lateral que abre sobre a lista/quadro (sem perder o contexto).
 * Devolve null quando a tarefa não existe ou está fora do escopo do ator.
 */
export async function TaskDetail({ actor, id, variant }: { actor: Actor; id: string; variant: "page" | "panel" }) {
  const data = await inOrg(actor, async (s) => {
    try {
      const detail = await getTask(s, id);
      return {
        detail,
        statuses: await listStatuses(s, "task"),
        transitions: await listTransitions(s),
        members: await listInternalMembers(s),
        options: await projectTaskOptions(s, detail.task.projectId, id),
        comments: await listComments(s, { taskId: id }),
        mentionables: await taskMentionables(s, id),
        labels: await listLabels(s),
        history: await taskHistory(s, id),
        entries: await listTimeEntries(s, id),
        running: await getRunningTimer(s),
        // Artes do Estúdio ligadas a esta demanda (mesmos registros, sem cópia).
        designs: can(actor, "designs.read") ? await listDesigns(s, { taskId: id, limit: 12 }) : null,
      };
    } catch (e) {
      if (e instanceof NotFoundError) return null;
      throw e;
    }
  });
  if (!data) return null;
  const { detail } = data;
  const { task, status } = detail;
  const base = `/w/${actor.orgSlug}`;
  const canWrite = can(actor, "tasks.write");
  const allowed = data.transitions.filter((t) => t.fromStatusId === status.id).map((t) => t.toStatusId);
  const memberLite = data.members.map((m) => ({
    membershipId: m.membershipId,
    name: m.name,
    image: m.image,
    jobTitle: m.jobTitle,
    roleName: m.roleName,
  }));
  const runningHere = data.running?.taskId === id ? { startedAt: data.running.startedAt } : null;
  const runningElsewhere = data.running && data.running.taskId !== id ? { taskTitle: data.running.taskTitle } : null;
  const panel = variant === "panel";

  return (
    <div className="grid gap-6">
      <div>
        {panel ? null : (
          <Breadcrumbs
            items={[
              { label: "Tarefas", href: `${base}/tasks` },
              { label: detail.projectName, href: `${base}/projects/${task.projectId}/tasks` },
              ...(task.parentTaskId && detail.parentTitle
                ? [{ label: detail.parentTitle, href: `${base}/tasks/${task.parentTaskId}` }]
                : []),
              { label: task.title },
            ]}
          />
        )}
        <div className="flex items-start gap-3">
          <div className="pt-1.5">
            <TaskDoneCheckbox taskId={id} done={!!task.completedAt} disabled={!canWrite} label={task.title} />
          </div>
          <div className="min-w-0 flex-1">
            <TaskTitle taskId={id} title={task.title} canWrite={canWrite} done={!!task.completedAt} />
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-fg-muted">
              <span>
                {detail.clientName} · {detail.projectName}
              </span>
              {task.archivedAt ? <Badge tone="warning">Arquivada</Badge> : null}
              {detail.dependsOn.some((d) => !d.completedAt) ? (
                <Badge tone="warning">Bloqueada por dependências</Badge>
              ) : null}
            </div>
          </div>
          {can(actor, "ai.use") ? <TaskAiMenu taskId={id} isSubtask={!!task.parentTaskId} canWrite={canWrite} /> : null}
          <OpenChatButton kind="task" id={id} />
          <TaskActions
            taskId={id}
            title={task.title}
            archived={!!task.archivedAt}
            projectId={task.projectId}
            canWrite={canWrite}
            canDelete={can(actor, "tasks.delete")}
            isSubtask={!!task.parentTaskId}
            hasSubtasks={detail.subtasks.length > 0}
          />
        </div>
      </div>

      <div className={cn("grid gap-6", !panel && "lg:grid-cols-[minmax(0,1fr)_340px]")}>
        <div className={cn("order-2 grid content-start gap-6", !panel && "lg:order-1")}>
          <Card>
            <CardHeader>
              <CardTitle>Descrição</CardTitle>
            </CardHeader>
            <CardContent>
              <TaskDescription taskId={id} description={task.description} canWrite={canWrite} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Checklist</CardTitle>
            </CardHeader>
            <CardContent>
              <TaskChecklist
                taskId={id}
                items={detail.checklist.map((c) => ({ id: c.id, title: c.title, done: c.done }))}
                canWrite={canWrite}
              />
            </CardContent>
          </Card>

          {task.parentTaskId ? null : (
            <Card>
              <CardHeader>
                <CardTitle>Subtarefas</CardTitle>
              </CardHeader>
              <CardContent>
                <TaskSubtasks
                  taskId={id}
                  projectId={task.projectId}
                  subtasks={detail.subtasks}
                  canWrite={canWrite}
                  canAssign={can(actor, "tasks.assign")}
                  statuses={data.statuses.map((st) => ({ id: st.id, name: st.name, color: st.color }))}
                  transitions={data.transitions}
                  members={memberLite}
                />
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Dependências</CardTitle>
            </CardHeader>
            <CardContent>
              <TaskDependencies
                taskId={id}
                dependsOn={detail.dependsOn}
                blocking={detail.blocking}
                options={data.options.map((o) => ({ id: o.id, title: o.title }))}
                canWrite={canWrite}
              />
            </CardContent>
          </Card>

          {data.designs ? (
            <Card data-testid="task-designs">
              <CardHeader>
                <div>
                  <CardTitle>Artes da demanda</CardTitle>
                  <p className="mt-0.5 text-xs text-fg-muted">
                    Criadas no Estúdio para esta demanda. Ao exportar, a entrega vai para os arquivos dela.
                  </p>
                </div>
                {can(actor, "designs.write") ? (
                  <div className="flex flex-wrap gap-2">
                    {can(actor, "ai.use") ? (
                      <Button asChild variant="secondary" size="sm">
                        <Link href={`${base}/studio/gerar?taskId=${id}`}>
                          <Sparkles /> Gerar carrossel com IA
                        </Link>
                      </Button>
                    ) : null}
                    <NewDesignDialog
                      clients={[]}
                      projects={[]}
                      templates={[]}
                      canManageTemplates={false}
                      link={{
                        clientId: detail.clientId,
                        projectId: task.projectId,
                        taskId: id,
                        label: `${detail.clientName} · ${detail.projectName} · ${task.title}`,
                      }}
                      trigger={
                        <Button variant="primary" size="sm">
                          <Plus /> Nova arte
                        </Button>
                      }
                    />
                  </div>
                ) : null}
              </CardHeader>
              <CardContent>
                <LinkedDesigns
                  designs={data.designs}
                  base={base}
                  empty="Nenhuma arte ainda. Crie uma arte ou gere um carrossel já ligado a esta demanda."
                />
              </CardContent>
            </Card>
          ) : null}

          <FileAttachments target={{ taskId: id }} canUpload={can(actor, "files.write")} />

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Comentários internos</CardTitle>
                <p className="mt-0.5 text-xs text-fg-muted">
                  Só a equipe vê. Tarefas nunca aparecem para o cliente; mensagens ao cliente ficam na solicitação ou no
                  projeto.
                </p>
              </div>
            </CardHeader>
            <CardContent>
              <Comments
                target={{ taskId: id }}
                comments={data.comments}
                allowInternal
                lockInternal
                mentionables={data.mentionables.filter((m) => m.membershipId !== actor.membershipId)}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Histórico</CardTitle>
            </CardHeader>
            <CardContent>
              <HistoryList entries={data.history} />
            </CardContent>
          </Card>
        </div>

        <div className={cn("order-1 grid content-start gap-6", !panel && "lg:order-2")}>
          <Card>
            <CardContent className="pt-3 pb-3">
              <TaskProperties
                task={{
                  id,
                  projectId: task.projectId,
                  priority: task.priority,
                  assigneeMembershipId: task.assigneeMembershipId,
                  startDate: task.startDate,
                  dueDate: task.dueDate,
                  estimateMinutes: task.estimateMinutes,
                  stageId: task.stageId,
                }}
                status={{ id: status.id, name: status.name, color: status.color }}
                statuses={data.statuses.map((st) => ({ id: st.id, name: st.name, color: st.color }))}
                allowedStatusIds={allowed.length ? allowed : null}
                members={memberLite}
                collaborators={detail.collaborators}
                stages={detail.stages}
                project={{ name: detail.projectName, clientName: detail.clientName, clientId: detail.clientId }}
                parent={
                  task.parentTaskId && detail.parentTitle ? { id: task.parentTaskId, title: detail.parentTitle } : null
                }
                request={detail.request}
                trackedMinutes={detail.trackedMinutes}
                labels={{
                  available: data.labels.map((l) => ({ id: l.id, name: l.name, color: l.color })),
                  selected: detail.labels,
                }}
                canWrite={canWrite}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Tempo</CardTitle>
            </CardHeader>
            <CardContent>
              <TaskTime
                taskId={id}
                entries={data.entries}
                runningHere={runningHere}
                runningElsewhere={runningElsewhere}
                canTrack={can(actor, "time.track")}
                trackingEnabled={actor.settings.time.trackingEnabled}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
