"use client";

import { Copy, LinkIcon, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useOrgAction } from "@/hooks/use-action";
import { formatDateTime, relativeFromNow } from "@/lib/format";
import { APPROVAL_LINK_DAYS } from "@/lib/validators/approvals";
import {
  approvalLinkCandidatesAction,
  createApprovalLinkAction,
  revokeApprovalLinkAction,
} from "@/server/actions/approvals";
import type { ApprovalLinkRow } from "@/server/services/approval-links";

type Candidate = { fileId: string; name: string; versionNumber: number };

const MONTH = new Intl.DateTimeFormat("pt-BR", { month: "long", timeZone: "America/Sao_Paulo" });

/**
 * Cria um link de aprovação sem conta para arquivos de UM cliente que estão
 * aguardando a aprovação dele. O endereço aparece só agora (o token não fica guardado).
 */
export function CreateApprovalLinkDialog({ clients }: { clients: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [clientId, setClientId] = useState("");
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [label, setLabel] = useState("");
  const [days, setDays] = useState<number>(APPROVAL_LINK_DAYS.default);
  const [created, setCreated] = useState<{ url: string; expiresAt: Date } | null>(null);
  const load = useOrgAction(approvalLinkCandidatesAction);
  const create = useOrgAction(createApprovalLinkAction, {
    onSuccess: (r) => setCreated({ url: `${window.location.origin}${r.path}`, expiresAt: new Date(r.expiresAt) }),
  });

  const reset = () => {
    setClientId("");
    setCandidates(null);
    setSelected([]);
    setLabel("");
    setDays(APPROVAL_LINK_DAYS.default);
    setCreated(null);
  };

  const pickClient = async (id: string) => {
    setClientId(id);
    setCandidates(null);
    setSelected([]);
    if (!id) return;
    const res = await load.run({ clientId: id });
    if (res.ok) {
      setCandidates(res.data);
      setSelected(res.data.map((c) => c.fileId));
      if (!label) setLabel(`Aprovação de ${MONTH.format(new Date())}`);
    }
  };

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copiado.");
    } catch {
      toast.error("Não foi possível copiar; selecione o endereço e copie manualmente.");
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="primary">
          <Plus /> Criar link de aprovação
        </Button>
      </DialogTrigger>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{created ? "Link de aprovação criado" : "Criar link de aprovação"}</DialogTitle>
          <DialogDescription>
            {created
              ? "Envie este endereço ao cliente. Por segurança ele só aparece agora: se perder, crie outro e revogue este."
              : "O cliente abre o link, vê a versão atual de cada material e aprova ou pede ajustes, sem precisar de conta."}
          </DialogDescription>
        </DialogHeader>
        {created ? (
          <DialogBody className="grid gap-3">
            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={created.url}
                aria-label="Endereço do link de aprovação"
                data-testid="approval-link-url"
              />
              <Button variant="secondary" onClick={() => void copy(created.url)}>
                <Copy /> Copiar
              </Button>
            </div>
            <p className="text-xs text-fg-muted">Válido até {formatDateTime(created.expiresAt)}.</p>
          </DialogBody>
        ) : (
          <DialogBody className="grid gap-4">
            <Field label="Cliente" htmlFor="al-client" required>
              <NativeSelect id="al-client" value={clientId} onChange={(e) => void pickClient(e.target.value)}>
                <option value="">Selecione…</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            {clientId ? (
              load.pending ? (
                <p className="text-sm text-fg-muted">Carregando materiais…</p>
              ) : candidates && candidates.length === 0 ? (
                <p className="rounded-lg bg-warning-soft p-3 text-sm">
                  Nenhum material deste cliente está aguardando a aprovação dele. Envie as versões para “Aprovação do
                  cliente” na página de cada arquivo e volte aqui.
                </p>
              ) : candidates ? (
                <fieldset className="grid gap-2">
                  <legend className="mb-1 text-sm font-medium">
                    Materiais ({selected.length} de {candidates.length})
                  </legend>
                  <ul className="grid max-h-56 gap-1 overflow-y-auto rounded-lg border border-border p-2">
                    {candidates.map((c) => (
                      <li key={c.fileId}>
                        <label className="flex items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-surface-2">
                          <Checkbox
                            checked={selected.includes(c.fileId)}
                            onCheckedChange={(v) =>
                              setSelected((cur) =>
                                v === true ? [...cur, c.fileId] : cur.filter((id) => id !== c.fileId),
                              )
                            }
                            aria-label={c.name}
                          />
                          <span className="min-w-0 flex-1 truncate">{c.name}</span>
                          <span className="text-xs text-fg-subtle">v{c.versionNumber}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </fieldset>
              ) : null
            ) : null}
            <div className="grid gap-4 sm:grid-cols-[1fr_160px]">
              <Field label="Nome do link" htmlFor="al-label" required error={create.fieldErrors.label?.[0]}>
                <Input id="al-label" value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} />
              </Field>
              <Field label="Validade (dias)" htmlFor="al-days" error={create.fieldErrors.days?.[0]}>
                <Input
                  id="al-days"
                  type="number"
                  min={APPROVAL_LINK_DAYS.min}
                  max={APPROVAL_LINK_DAYS.max}
                  value={days}
                  onChange={(e) => setDays(Number(e.target.value))}
                />
              </Field>
            </div>
          </DialogBody>
        )}
        <DialogFooter>
          {created ? (
            <Button variant="primary" onClick={() => setOpen(false)}>
              Concluir
            </Button>
          ) : (
            <>
              <Button variant="secondary" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button
                variant="primary"
                loading={create.pending}
                disabled={!clientId || !selected.length || !label.trim()}
                onClick={() => void create.run({ clientId, fileIds: selected, label, days })}
              >
                <LinkIcon /> Criar link
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const STATE: Record<ApprovalLinkRow["state"], { label: string; tone: "success" | "neutral" | "danger" }> = {
  active: { label: "Ativo", tone: "success" },
  expired: { label: "Expirado", tone: "neutral" },
  revoked: { label: "Revogado", tone: "danger" },
};

export function ApprovalLinksTable({ rows, canManage }: { rows: ApprovalLinkRow[]; canManage: boolean }) {
  const revoke = useOrgAction(revokeApprovalLinkAction, { success: "Link revogado: o endereço deixou de funcionar." });
  if (!rows.length) {
    return (
      <EmptyState
        icon={LinkIcon}
        title="Nenhum link de aprovação"
        description="Crie um link para o cliente aprovar materiais sem precisar de conta."
      />
    );
  }
  return (
    <Table>
      <THead>
        <tr>
          <TH>Link</TH>
          <TH className="hidden md:table-cell">Cliente</TH>
          <TH>Situação</TH>
          <TH className="hidden sm:table-cell">Pendentes</TH>
          <TH className="hidden lg:table-cell">Validade</TH>
          <TH className="hidden lg:table-cell">Último acesso</TH>
          <TH className="w-24" aria-label="Ações" />
        </tr>
      </THead>
      <TBody>
        {rows.map((r) => (
          <TR key={r.id} data-link-id={r.id}>
            <TD>
              <span className="block truncate font-medium">{r.label}</span>
              <span className="block text-xs text-fg-muted">
                {r.createdByName ? `por ${r.createdByName} · ` : ""}
                {relativeFromNow(r.createdAt)}
              </span>
            </TD>
            <TD className="hidden md:table-cell">{r.clientName}</TD>
            <TD>
              <Badge tone={STATE[r.state].tone}>{STATE[r.state].label}</Badge>
            </TD>
            <TD className="hidden tabular-nums sm:table-cell">
              {r.pending} de {r.items}
            </TD>
            <TD className="hidden text-xs text-fg-muted lg:table-cell">{formatDateTime(r.expiresAt)}</TD>
            <TD className="hidden text-xs text-fg-muted lg:table-cell">
              {r.lastViewedAt ? relativeFromNow(r.lastViewedAt) : "Nunca aberto"}
            </TD>
            <TD className="text-right">
              {canManage && r.state === "active" ? (
                <ConfirmDialog
                  title={`Revogar “${r.label}”?`}
                  description="O endereço deixa de funcionar na hora. As decisões já registradas continuam no histórico."
                  confirmLabel="Revogar link"
                  onConfirm={() => revoke.run({ id: r.id })}
                  trigger={
                    <Button variant="ghost" size="sm">
                      Revogar
                    </Button>
                  }
                />
              ) : null}
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
