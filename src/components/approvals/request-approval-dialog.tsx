"use client";

import { Send } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { useOrgAction } from "@/hooks/use-action";
import { approvalTaskOptionsAction, requestApprovalAction } from "@/server/actions/approvals";

type TaskOptions = { tasks: { id: string; title: string; statusName: string }[]; defaultTaskId: string | null };

export function RequestApprovalDialog({
  fileId,
  versionNumber,
  stage,
  trigger,
}: {
  fileId: string;
  versionNumber: number;
  stage: "internal" | "client";
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<TaskOptions | null>(null);
  const [taskId, setTaskId] = useState("");
  const [moveTask, setMoveTask] = useState(true);
  // Tarefas do projeto carregadas ao abrir (para vincular o pedido a uma tarefa).
  const loadTasks = useOrgAction(approvalTaskOptionsAction, {
    onSuccess: (d) => {
      setOptions(d);
      setTaskId(d.defaultTaskId ?? "");
    },
  });
  const request = useOrgAction(requestApprovalAction, {
    success: stage === "client" ? "Enviado para aprovação do cliente" : "Enviado para revisão interna",
    onSuccess: () => setOpen(false),
  });
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v && !options) loadTasks.run({ fileId });
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant={stage === "client" ? "primary" : "secondary"} size="sm">
            <Send /> {stage === "client" ? "Enviar ao cliente" : "Pedir revisão interna"}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent size="md">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            request.run({
              fileId,
              stage,
              message: String(f.get("message") ?? ""),
              dueDate: String(f.get("dueDate") ?? ""),
              taskId: taskId || undefined,
              moveTaskToReview: !!taskId && moveTask,
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {stage === "client"
                ? `Enviar v${versionNumber} para aprovação do cliente`
                : `Pedir revisão interna da v${versionNumber}`}
            </DialogTitle>
            <DialogDescription>
              {stage === "client"
                ? "O arquivo passa a ser visível para o cliente, que poderá aprovar ou pedir ajustes desta versão."
                : "Quem tem permissão de revisão interna poderá aprovar ou pedir ajustes."}
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="grid gap-4">
            <Field label="Mensagem" htmlFor={`ap-msg-${stage}`}>
              <Textarea
                id={`ap-msg-${stage}`}
                name="message"
                rows={3}
                placeholder="Contexto para quem vai avaliar (opcional)"
              />
            </Field>
            <Field label="Prazo para resposta" htmlFor={`ap-due-${stage}`}>
              <Input id={`ap-due-${stage}`} name="dueDate" type="date" />
            </Field>
            {options?.tasks.length ? (
              <div className="grid gap-2">
                <Field label="Tarefa vinculada" htmlFor={`ap-task-${stage}`}>
                  <NativeSelect id={`ap-task-${stage}`} value={taskId} onChange={(e) => setTaskId(e.target.value)}>
                    <option value="">Nenhuma</option>
                    {options.tasks.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.title} · {t.statusName}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                {taskId ? (
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={moveTask} onCheckedChange={(v) => setMoveTask(v === true)} />
                    Mover a tarefa para “{stage === "client" ? "Aprovação do cliente" : "Revisão interna"}”
                  </label>
                ) : null}
              </div>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" loading={request.pending}>
              Enviar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
