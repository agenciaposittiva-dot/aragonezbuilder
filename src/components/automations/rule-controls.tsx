"use client";

import { Copy, History, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/toaster";
import { useWorkspace } from "@/components/shell/workspace-context";
import { useOrgAction } from "@/hooks/use-action";
import { deleteRuleAction, setRuleEnabledAction } from "@/server/actions/automations";

export function RuleToggle({
  id,
  enabled,
  name,
  disabled,
}: {
  id: string;
  enabled: boolean;
  name: string;
  disabled?: boolean;
}) {
  const [on, setOn] = useState(enabled);
  const toggle = useOrgAction(setRuleEnabledAction, { onError: () => setOn((v) => !v) });
  return (
    <Switch
      checked={on}
      disabled={disabled || toggle.pending}
      aria-label={`${on ? "Pausar" : "Ativar"} ${name}`}
      onCheckedChange={(v) => {
        setOn(v);
        toggle.run({ id, enabled: v });
      }}
    />
  );
}

export function RuleMenu({ id, name, canManage }: { id: string; name: string; canManage: boolean }) {
  const { orgSlug } = useWorkspace();
  const remove = useOrgAction(deleteRuleAction, { success: "Automação excluída" });
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Ações de ${name}`}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {canManage ? (
          <DropdownMenuItem asChild>
            <Link href={`/w/${orgSlug}/automations/${id}`}>
              <Pencil /> Editar
            </Link>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem asChild>
          <Link href={`/w/${orgSlug}/automations/${id}/runs`}>
            <History /> Execuções
          </Link>
        </DropdownMenuItem>
        {canManage ? (
          <>
            <DropdownMenuSeparator />
            <ConfirmDialog
              title={`Excluir "${name}"?`}
              description="O histórico de execuções desta automação também será removido."
              confirmLabel="Excluir"
              onConfirm={() => remove.run({ id })}
              trigger={
                <DropdownMenuItem variant="danger" onSelect={(e) => e.preventDefault()}>
                  <Trash2 /> Excluir
                </DropdownMenuItem>
              }
            />
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function SecretField({ secret }: { secret: string }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <code className="max-w-full truncate rounded-md border border-border bg-surface-2 px-2 py-1 font-mono text-xs">
        {shown ? secret : "•".repeat(32)}
      </code>
      <Button type="button" variant="ghost" size="xs" onClick={() => setShown((v) => !v)}>
        {shown ? "Ocultar" : "Mostrar"}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        onClick={async () => {
          await navigator.clipboard.writeText(secret);
          toast.success("Segredo copiado");
        }}
      >
        <Copy /> Copiar
      </Button>
    </div>
  );
}
