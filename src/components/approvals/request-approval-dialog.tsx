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
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { useOrgAction } from "@/hooks/use-action";
import { requestApprovalAction } from "@/server/actions/approvals";

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
  const request = useOrgAction(requestApprovalAction, {
    success: stage === "client" ? "Enviado para aprovação do cliente" : "Enviado para revisão interna",
    onSuccess: () => setOpen(false),
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
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
