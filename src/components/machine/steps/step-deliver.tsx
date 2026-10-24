"use client";

import { CalendarDays, CheckCircle2, Download, ListTodo, Send } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { useWorkspace } from "@/components/shell/workspace-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect } from "@/components/ui/input";
import { CONTENT_STATUS } from "@/lib/content";
import { machinePlanAction, machineTaskAction } from "@/server/actions/content-machine";
import type { StepProps } from "../machine-wizard";

/**
 * Etapa 9: aprovação, exportação e calendário — pelos fluxos que já existem.
 * Exportar não publica: a peça só fica "Publicada" quando alguém marcar.
 */
export function StepDeliver({ view, can, readOnly }: StepProps) {
  const { orgSlug } = useWorkspace();
  const content = view.content;
  const [date, setDate] = useState(content?.plannedDate ?? "");
  const [projectId, setProjectId] = useState(view.clientProjects[0]?.id ?? "");
  const [due, setDue] = useState("");
  const [taskId, setTaskId] = useState(content?.taskId ?? null);
  const [busy, setBusy] = useState<"date" | "task" | null>(null);
  if (!content || !view.design)
    return <p className="text-sm text-fg-muted">Gere o conteúdo para aprovar e planejar.</p>;

  const saveDate = async () => {
    setBusy("date");
    const res = await machinePlanAction(orgSlug, { id: view.project.id, plannedDate: date || null }).catch(() => null);
    setBusy(null);
    if (!res?.ok) return toast.error(res?.error ?? "Falha de conexão.");
    toast.success(date ? "Data planejada no calendário editorial." : "Data removida do calendário.");
  };
  const createTask = async () => {
    setBusy("task");
    const res = await machineTaskAction(orgSlug, {
      id: view.project.id,
      projectId,
      dueDate: due || null,
    }).catch(() => null);
    setBusy(null);
    if (!res?.ok) return toast.error(res?.error ?? "Falha de conexão.");
    setTaskId(res.data.taskId);
    toast.success("Tarefa criada e ligada à peça.");
  };
  const writable = can.write && !readOnly;

  return (
    <div className="grid grid-cols-1 gap-6">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span>Situação da peça:</span>
        <Badge tone="neutral">{CONTENT_STATUS[content.status as keyof typeof CONTENT_STATUS] ?? content.status}</Badge>
        <span className="text-xs text-fg-muted">
          Exportar não publica. A peça só fica &quot;Publicada&quot; quando alguém marcar.
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="grid content-start gap-3 rounded-lg border border-border p-4">
          <p className="flex items-center gap-2 font-medium">
            <CalendarDays className="size-4 text-accent-text" /> Calendário editorial
          </p>
          <Field label="Data planejada" htmlFor="machine-date">
            <Input
              id="machine-date"
              type="date"
              value={date}
              readOnly={!writable}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>
          <Button variant="secondary" loading={busy === "date"} disabled={!writable} onClick={() => void saveDate()}>
            Salvar data
          </Button>
        </section>

        <section className="grid content-start gap-3 rounded-lg border border-border p-4">
          <p className="flex items-center gap-2 font-medium">
            <ListTodo className="size-4 text-accent-text" /> Tarefa de produção
          </p>
          {taskId ? (
            <p className="flex items-center gap-2 text-sm text-success">
              <CheckCircle2 className="size-4" /> Tarefa criada.{" "}
              <Link href={`/w/${orgSlug}/tasks/${taskId}`} className="text-accent-text hover:underline">
                Abrir tarefa
              </Link>
            </p>
          ) : view.clientProjects.length ? (
            <>
              <Field label="Projeto" htmlFor="machine-task-project">
                <NativeSelect
                  id="machine-task-project"
                  value={projectId}
                  disabled={!writable || !can.tasks}
                  onChange={(e) => setProjectId(e.target.value)}
                >
                  {view.clientProjects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Prazo (opcional)" htmlFor="machine-task-due">
                <Input
                  id="machine-task-due"
                  type="date"
                  value={due}
                  readOnly={!writable || !can.tasks}
                  onChange={(e) => setDue(e.target.value)}
                />
              </Field>
              <Button
                variant="secondary"
                loading={busy === "task"}
                disabled={!writable || !can.tasks || !projectId}
                onClick={() => void createTask()}
              >
                Criar tarefa
              </Button>
            </>
          ) : (
            <p className="text-sm text-fg-muted">
              Este cliente ainda não tem projetos. Crie um em Projetos para ligar a tarefa.
            </p>
          )}
        </section>

        <section className="grid content-start gap-3 rounded-lg border border-border p-4">
          <p className="flex items-center gap-2 font-medium">
            <Send className="size-4 text-accent-text" /> Aprovação e exportação
          </p>
          <ol className="list-decimal pl-5 text-sm text-fg-muted">
            <li>
              No editor, use <strong>Enviar para Arquivos</strong> (um arquivo por slide) ou <strong>Exportar</strong>{" "}
              (PNG/JPG por slide, pacote ZIP com todos ou PDF).
            </li>
            <li>
              Na pré-visualização, abra <strong>Aprovação</strong> para pedir aprovação interna ou do cliente (portal).
            </li>
          </ol>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="secondary" size="sm">
              <Link href={`/w/${orgSlug}/studio/${view.design.id}`}>
                <Download /> Exportar no editor
              </Link>
            </Button>
            {can.approvals ? (
              <Button asChild variant="secondary" size="sm">
                <Link href={`/w/${orgSlug}/content/${content.id}/preview`}>
                  <Send /> Enviar para aprovação
                </Link>
              </Button>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}
