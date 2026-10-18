import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FileAttachments } from "@/components/files/file-attachments";
import { Comments } from "@/components/app/comments";
import { HistoryList } from "@/components/app/history-list";
import { TaskDoneCheckbox } from "@/components/tasks/task-done-checkbox";
import { TaskActions } from "@/components/tasks/detail/task-actions";
import { TaskChecklist } from "@/components/tasks/detail/task-checklist";
import { TaskDependencies } from "@/components/tasks/detail/task-dependencies";
import { TaskDescription } from "@/components/tasks/detail/task-description";
import { TaskProperties } from "@/components/tasks/detail/task-properties";
import { TaskSubtasks } from "@/components/tasks/detail/task-subtasks";
import { TaskTime } from "@/components/tasks/detail/task-time";
import { TaskTitle } from "@/components/tasks/detail/task-title";
import { Badge } from "@/components/ui/badge";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { can, inOrg } from "@/server/authz";
import { requireActor } from "@/server/auth/session";
import { NotFoundError } from "@/server/errors";
import { listComments } from "@/server/services/comments";
import { listInternalMembers } from "@/server/services/members";
import { getTask, projectTaskOptions, taskHistory } from "@/server/services/tasks";
import { getRunningTimer, listTimeEntries } from "@/server/services/time-entries";
import { listStatuses, listTransitions } from "@/server/services/workflow";

export const metadata: Metadata = { title: "Tarefa" };

export default async function TaskDetailPage({ params }: PageProps<"/w/[org]/tasks/[id]">) {
  const { org, id } = await params;
  const actor = await requireActor(org, { kind: "internal", permission: "tasks.read" });
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
        history: await taskHistory(s, id),
        entries: await listTimeEntries(s, id),
        running: await getRunningTimer(s),
      };
    } catch (e) {
      if (e instanceof NotFoundError) return null;
      throw e;
    }
  });
  if (!data) notFound();
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

  return (
    <div className="grid gap-6">
      <div>
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
          <TaskActions
            taskId={id}
            title={task.title}
            archived={!!task.archivedAt}
            projectId={task.projectId}
            canWrite={canWrite}
            canDelete={can(actor, "tasks.delete")}
          />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="order-2 grid content-start gap-6 lg:order-1">
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
                <TaskSubtasks taskId={id} projectId={task.projectId} subtasks={detail.subtasks} canWrite={canWrite} />
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

          <FileAttachments target={{ taskId: id }} canUpload={can(actor, "files.write")} />

          <Card>
            <CardHeader>
              <CardTitle>Comentários</CardTitle>
            </CardHeader>
            <CardContent>
              <Comments target={{ taskId: id }} comments={data.comments} allowInternal lockInternal />
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

        <div className="order-1 grid content-start gap-6 lg:order-2">
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
