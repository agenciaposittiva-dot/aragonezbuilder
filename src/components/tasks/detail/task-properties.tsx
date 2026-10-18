"use client";

import Link from "next/link";
import { useState } from "react";
import { MemberPicker, type MemberLite } from "@/components/app/member-picker";
import { PRIORITY_OPTIONS } from "@/components/app/priority";
import { StatusSelect } from "@/components/projects/status-select";
import { AvatarGroup } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { fieldBase } from "@/components/ui/input";
import { useWorkspace } from "@/components/shell/workspace-context";
import { useOrgAction } from "@/hooks/use-action";
import { formatMinutes } from "@/lib/format";
import { cn } from "@/lib/utils";
import { parseDuration } from "@/lib/validators/tasks";
import { changeTaskStatusAction, setTaskCollaboratorsAction, updateTaskAction } from "@/server/actions/tasks";
import { TaskLabelsPicker, type LabelLite } from "../task-labels";

type Props = {
  task: {
    id: string;
    projectId: string;
    priority: "low" | "medium" | "high" | "urgent";
    assigneeMembershipId: string | null;
    startDate: string | null;
    dueDate: string | null;
    estimateMinutes: number | null;
    stageId: string | null;
  };
  status: { id: string; name: string; color: string };
  statuses: { id: string; name: string; color: string }[];
  allowedStatusIds: string[] | null;
  members: MemberLite[];
  collaborators: { membershipId: string; name: string; image: string | null }[];
  stages: { id: string; name: string }[];
  project: { name: string; clientName: string; clientId: string };
  parent: { id: string; title: string } | null;
  request: { id: string; number: number | null; title: string | null } | null;
  trackedMinutes: number;
  canWrite: boolean;
  labels?: { available: LabelLite[]; selected: LabelLite[] };
};

const selectCls = cn(fieldBase, "h-8 appearance-none px-2 text-[13px]");

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_minmax(0,1fr)] items-center gap-3 py-1.5">
      <dt className="text-xs text-fg-subtle">{label}</dt>
      <dd className="min-w-0 text-sm">{children}</dd>
    </div>
  );
}

/** Propriedades da tarefa, salvas assim que alteradas. */
export function TaskProperties(p: Props) {
  const { orgSlug, membershipId, permissions } = useWorkspace();
  const canAssign = permissions.includes("tasks.assign");
  const update = useOrgAction(updateTaskAction);
  const status = useOrgAction(changeTaskStatusAction, { success: "Status atualizado" });
  const collab = useOrgAction(setTaskCollaboratorsAction);
  const [estimate, setEstimate] = useState(p.task.estimateMinutes ? formatMinutes(p.task.estimateMinutes) : "");
  const [estimateError, setEstimateError] = useState(false);
  const assignable = canAssign
    ? p.members
    : p.members.filter((m) => m.membershipId === membershipId || m.membershipId === p.task.assigneeMembershipId);
  const disabled = !p.canWrite;
  const base = `/w/${orgSlug}`;

  return (
    <dl className="divide-y divide-border">
      <Row label="Status">
        <StatusSelect
          current={p.status}
          statuses={p.statuses}
          allowedIds={p.allowedStatusIds}
          disabled={disabled || status.pending}
          onChange={(statusId) => status.run({ taskId: p.task.id, statusId })}
        />
      </Row>
      <Row label="Responsável">
        <select
          className={selectCls}
          value={p.task.assigneeMembershipId ?? ""}
          disabled={disabled}
          onChange={(e) => update.run({ id: p.task.id, assigneeMembershipId: e.target.value || null })}
          aria-label="Responsável"
        >
          <option value="">Sem responsável</option>
          {assignable.map((m) => (
            <option key={m.membershipId} value={m.membershipId}>
              {m.name}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Colaboradores">
        <div className="flex items-center gap-2">
          {p.collaborators.length ? (
            <AvatarGroup people={p.collaborators} max={4} />
          ) : (
            <span className="text-xs text-fg-subtle">Ninguém</span>
          )}
          {p.canWrite ? (
            <MemberPicker
              members={p.members}
              value={p.collaborators.map((c) => c.membershipId)}
              onChange={(ids) => collab.run({ taskId: p.task.id, membershipIds: ids })}
              trigger={
                <Button variant="ghost" size="xs">
                  Editar
                </Button>
              }
            />
          ) : null}
        </div>
      </Row>
      <Row label="Prioridade">
        <select
          className={selectCls}
          value={p.task.priority}
          disabled={disabled}
          onChange={(e) => update.run({ id: p.task.id, priority: e.target.value as Props["task"]["priority"] })}
          aria-label="Prioridade"
        >
          {PRIORITY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </Row>
      {p.labels ? (
        <Row label="Etiquetas">
          <TaskLabelsPicker
            taskId={p.task.id}
            labels={p.labels.available}
            value={p.labels.selected}
            canWrite={p.canWrite}
          />
        </Row>
      ) : null}
      <Row label="Início">
        <input
          type="date"
          className={cn(fieldBase, "h-8 px-2 text-[13px]")}
          defaultValue={p.task.startDate ?? ""}
          disabled={disabled}
          onChange={(e) => update.run({ id: p.task.id, startDate: e.target.value || null })}
          aria-label="Data de início"
        />
      </Row>
      <Row label="Prazo">
        <input
          type="date"
          className={cn(fieldBase, "h-8 px-2 text-[13px]")}
          defaultValue={p.task.dueDate ?? ""}
          disabled={disabled}
          onChange={(e) => update.run({ id: p.task.id, dueDate: e.target.value || null })}
          aria-label="Prazo"
        />
      </Row>
      <Row label="Estimativa">
        <div>
          <input
            className={cn(fieldBase, "h-8 px-2 text-[13px]", estimateError && "border-danger")}
            value={estimate}
            placeholder="Ex.: 2h, 1h30"
            disabled={disabled}
            onChange={(e) => setEstimate(e.target.value)}
            onBlur={() => {
              const raw = estimate.trim();
              const minutes = raw ? parseDuration(raw) : null;
              if (raw && minutes === null) {
                setEstimateError(true);
                return;
              }
              setEstimateError(false);
              if (minutes !== p.task.estimateMinutes) update.run({ id: p.task.id, estimateMinutes: minutes });
            }}
            aria-label="Estimativa"
            aria-invalid={estimateError}
          />
          <p className="mt-1 text-[11px] text-fg-subtle">
            Registrado: {formatMinutes(p.trackedMinutes)}
            {p.task.estimateMinutes ? ` de ${formatMinutes(p.task.estimateMinutes)}` : ""}
          </p>
        </div>
      </Row>
      {p.stages.length ? (
        <Row label="Etapa">
          <select
            className={selectCls}
            value={p.task.stageId ?? ""}
            disabled={disabled}
            onChange={(e) => update.run({ id: p.task.id, stageId: e.target.value || null })}
            aria-label="Etapa do projeto"
          >
            <option value="">Sem etapa</option>
            {p.stages.map((st) => (
              <option key={st.id} value={st.id}>
                {st.name}
              </option>
            ))}
          </select>
        </Row>
      ) : null}
      <Row label="Projeto">
        <Link href={`${base}/projects/${p.task.projectId}`} className="block truncate hover:underline">
          {p.project.name}
        </Link>
        <Link
          href={`${base}/clients/${p.project.clientId}`}
          className="block truncate text-xs text-fg-muted hover:underline"
        >
          {p.project.clientName}
        </Link>
      </Row>
      {p.parent ? (
        <Row label="Tarefa-mãe">
          <Link href={`${base}/tasks/${p.parent.id}`} className="block truncate hover:underline">
            {p.parent.title}
          </Link>
        </Row>
      ) : null}
      {p.request ? (
        <Row label="Solicitação">
          <Link href={`${base}/requests/${p.request.id}`} className="block truncate hover:underline">
            #{p.request.number} · {p.request.title}
          </Link>
        </Row>
      ) : null}
    </dl>
  );
}
