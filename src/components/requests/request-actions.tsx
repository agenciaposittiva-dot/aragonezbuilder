"use client";

import { ArrowRightLeft, Ban, FolderPlus, Send, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
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
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { useWorkspace } from "@/components/shell/workspace-context";
import { useOrgAction } from "@/hooks/use-action";
import { REQUEST_STATUS_LABEL, REQUEST_TRANSITIONS, type RequestStatus } from "@/lib/validators/requests";
import {
  assignRequestAction,
  changeRequestStatusAction,
  convertRequestAction,
  submitRequestAction,
} from "@/server/actions/requests";

type Req = {
  id: string;
  number: number;
  title: string;
  status: RequestStatus;
  assigneeMembershipId: string | null;
  projectId: string | null;
  desiredDueDate: string | null;
  createdByUserId: string | null;
};

/** Ações de triagem (equipe) ou do autor (cliente). */
export function RequestActions({
  request,
  members,
  projects,
  canTriage,
}: {
  request: Req;
  members: { membershipId: string; name: string }[];
  projects: { id: string; name: string }[];
  canTriage: boolean;
}) {
  const router = useRouter();
  const ws = useWorkspace();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const [mode, setMode] = useState<"new" | "existing">("new");
  const status = useOrgAction(changeRequestStatusAction, {
    success: "Status atualizado",
    onSuccess: () => setRejectOpen(false),
  });
  const assign = useOrgAction(assignRequestAction, { success: "Responsável atualizado" });
  const submit = useOrgAction(submitRequestAction, { success: "Solicitação enviada" });
  const convert = useOrgAction(convertRequestAction, {
    success: "Solicitação em produção",
    onSuccess: (d) => {
      setConvertOpen(false);
      router.push(`/w/${ws.orgSlug}/projects/${d.projectId}`);
    },
  });
  const isAuthor = request.createdByUserId === ws.userId;
  const next = REQUEST_TRANSITIONS[request.status].filter((s) => s !== "rejected");

  if (!canTriage) {
    return (
      <div className="flex flex-wrap gap-2">
        {isAuthor && request.status === "draft" ? (
          <Button variant="primary" loading={submit.pending} onClick={() => submit.run({ id: request.id })}>
            <Send /> Enviar à agência
          </Button>
        ) : null}
        {isAuthor && ["draft", "submitted"].includes(request.status) ? (
          <Button
            variant="secondary"
            loading={status.pending}
            onClick={() => status.run({ id: request.id, status: "cancelled" })}
          >
            <XCircle /> Cancelar solicitação
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      <Field label="Responsável" htmlFor="rq-assignee">
        <NativeSelect
          id="rq-assignee"
          value={request.assigneeMembershipId ?? ""}
          disabled={assign.pending}
          onChange={(e) => assign.run({ id: request.id, membershipId: e.target.value || null })}
        >
          <option value="">Sem responsável</option>
          {members.map((m) => (
            <option key={m.membershipId} value={m.membershipId}>
              {m.name}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <div className="flex flex-wrap gap-2">
        {!request.projectId && ["submitted", "triage", "in_progress"].includes(request.status) ? (
          <Button variant="primary" onClick={() => setConvertOpen(true)}>
            <FolderPlus /> Converter em projeto
          </Button>
        ) : null}
        {request.status === "draft" ? (
          <Button variant="primary" loading={submit.pending} onClick={() => submit.run({ id: request.id })}>
            <Send /> Enviar
          </Button>
        ) : null}
        {next.length ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary">
                <ArrowRightLeft /> Mudar status
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuLabel>Mover para</DropdownMenuLabel>
              {next.map((s) => (
                <DropdownMenuItem key={s} onSelect={() => status.run({ id: request.id, status: s })}>
                  {REQUEST_STATUS_LABEL[s]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        {REQUEST_TRANSITIONS[request.status].includes("rejected") ? (
          <Button variant="danger-ghost" onClick={() => setRejectOpen(true)}>
            <Ban /> Recusar
          </Button>
        ) : null}
      </div>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent size="md">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const reason = String(new FormData(e.currentTarget).get("reason") ?? "");
              status.run({ id: request.id, status: "rejected", reason });
            }}
          >
            <DialogHeader>
              <DialogTitle>Recusar solicitação #{request.number}</DialogTitle>
              <DialogDescription>O cliente verá o motivo no histórico da solicitação.</DialogDescription>
            </DialogHeader>
            <DialogBody>
              <Field label="Motivo" htmlFor="rq-reason" error={status.fieldErrors.reason}>
                <Textarea id="rq-reason" name="reason" rows={4} required autoFocus />
              </Field>
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setRejectOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" variant="danger" loading={status.pending}>
                Recusar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={convertOpen} onOpenChange={setConvertOpen}>
        <DialogContent size="md">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              convert.run({
                requestId: request.id,
                mode,
                projectId: String(f.get("projectId") ?? ""),
                projectName: String(f.get("projectName") ?? ""),
                ownerMembershipId: String(f.get("ownerMembershipId") ?? ""),
                dueDate: String(f.get("dueDate") ?? ""),
              });
            }}
          >
            <DialogHeader>
              <DialogTitle>Converter em projeto</DialogTitle>
              <DialogDescription>
                Cria a tarefa de produção, vincula os anexos e coloca a solicitação em produção.
              </DialogDescription>
            </DialogHeader>
            <DialogBody className="grid gap-4">
              <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Destino">
                {(["new", "existing"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={mode === m}
                    disabled={m === "existing" && !projects.length}
                    onClick={() => setMode(m)}
                    className={`rounded-lg border px-3 py-2 text-sm disabled:opacity-50 ${mode === m ? "border-accent bg-accent-soft/40 font-medium" : "border-border"}`}
                  >
                    {m === "new" ? "Novo projeto" : "Projeto existente"}
                  </button>
                ))}
              </div>
              {mode === "new" ? (
                <>
                  <Field label="Nome do projeto" htmlFor="cv-name">
                    <Input id="cv-name" name="projectName" defaultValue={request.title} />
                  </Field>
                  <Field label="Responsável" htmlFor="cv-owner">
                    <NativeSelect
                      id="cv-owner"
                      name="ownerMembershipId"
                      defaultValue={request.assigneeMembershipId ?? ws.membershipId}
                    >
                      {members.map((m) => (
                        <option key={m.membershipId} value={m.membershipId}>
                          {m.name}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                </>
              ) : (
                <Field label="Projeto" htmlFor="cv-project" error={convert.fieldErrors.projectId}>
                  <NativeSelect id="cv-project" name="projectId" defaultValue="">
                    <option value="">Selecione…</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
              )}
              <Field label="Prazo" htmlFor="cv-due">
                <Input id="cv-due" name="dueDate" type="date" defaultValue={request.desiredDueDate ?? ""} />
              </Field>
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setConvertOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" variant="primary" loading={convert.pending}>
                Converter
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
