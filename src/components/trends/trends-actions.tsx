"use client";

import {
  AlertTriangle,
  CheckCircle2,
  FolderPlus,
  MessageSquareText,
  RefreshCw,
  Sparkles,
  Trash2,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { AiModelPicker } from "@/components/ai/ai-model-picker";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { Badge } from "@/components/ui/badge";
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
import { Input, NativeSelect } from "@/components/ui/input";
import { useOrgAction } from "@/hooks/use-action";
import type { AiSelection } from "@/lib/ai-select";
import { RISK_LEVELS } from "@/lib/trends";
import {
  classifyTrendsAction,
  clientFitAction,
  createCollectionAction,
  deleteCollectionAction,
  refreshTrendsAction,
} from "@/server/actions/trends";
import type { AiPickerData } from "@/server/services/ai-models";

export function RefreshTrendsButton({ sourceId, label = "Atualizar agora" }: { sourceId?: string; label?: string }) {
  const action = useOrgAction(refreshTrendsAction, {
    onSuccess: (results) => {
      const ok = results.filter((r) => r.ok);
      const skipped = results.filter((r) => r.skipped);
      const failed = results.filter((r) => !r.ok && !r.skipped);
      if (ok.length)
        toast.success(
          `${ok.length} fonte(s) atualizada(s): ${ok.reduce((n, r) => n + r.count, 0)} item(ns) recebidos.`,
        );
      for (const r of skipped) toast.info(`${r.name}: ${r.skipped}`);
      for (const r of failed) toast.error(`${r.name}: ${r.error}`);
      if (!results.length) toast.info("Nenhuma fonte ativa.");
    },
  });
  return (
    <Button variant="secondary" size="sm" loading={action.pending} onClick={() => action.run({ sourceId })}>
      <RefreshCw /> {label}
    </Button>
  );
}

export function ClassifyButton({ trendIds, picker }: { trendIds: string[]; picker: AiPickerData }) {
  const [open, setOpen] = useState(false);
  const [selection, setSelection] = useState<AiSelection>({ mode: "default" });
  const ids = trendIds.slice(0, 12);
  const action = useOrgAction(classifyTrendsAction, {
    success: (r) =>
      `${r.classified} tendência(s) classificada(s)${r.demo ? " (demonstração)" : ""}${r.missing ? ` · ${r.missing} sem resposta válida da IA` : ""}.`,
    onSuccess: () => setOpen(false),
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm" disabled={!ids.length}>
          <Sparkles /> Classificar com IA
        </Button>
      </DialogTrigger>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Classificar tendências com IA</DialogTitle>
          <DialogDescription>
            A IA avalia relevância, nicho, risco, sensibilidade e tempo de vida das {ids.length} primeiras tendências
            desta página. Ela recebe só os dados observados nas fontes — nunca inventa números, e o resultado aparece
            separado como inferência.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <AiModelPicker
            providers={picker.providers}
            preferences={picker.preferences}
            task="trend_analysis"
            module="trends"
            value={selection}
            onChange={setSelection}
            disabled={action.pending}
          />
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => setOpen(false)} disabled={action.pending}>
            Cancelar
          </Button>
          <Button variant="primary" loading={action.pending} onClick={() => action.run({ trendIds: ids, selection })}>
            Classificar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type FitResult = {
  analysisId: string;
  trendId: string;
  title: string;
  recommended: boolean;
  fit: string;
  angles: string[];
  avoid: string[];
  reputationRisk: string;
  confidence: string;
  guardrails: string[];
};

/** "Quais tendências desta semana fazem sentido para esta marca?" */
export function ClientFitPanel({
  base,
  clients,
  picker,
  defaultClientId,
}: {
  base: string;
  clients: { id: string; name: string }[];
  picker: AiPickerData;
  defaultClientId?: string;
}) {
  const [clientId, setClientId] = useState(defaultClientId ?? "");
  const [period, setPeriod] = useState<"7d" | "30d">("7d");
  const [selection, setSelection] = useState<AiSelection>({ mode: "default" });
  const [result, setResult] = useState<{
    clientName: string;
    recommended: FitResult[];
    notRecommended: FitResult[];
    notes: string;
    demo: boolean;
  } | null>(null);
  const action = useOrgAction(clientFitAction, { onSuccess: (r) => setResult(r) });
  return (
    <section
      aria-label="Tendências por cliente"
      className="grid gap-3 rounded-xl border border-border bg-surface p-4 shadow-xs"
    >
      <div>
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <MessageSquareText className="size-4 text-fg-subtle" /> Quais tendências fazem sentido para esta marca?
        </h2>
        <p className="mt-0.5 text-xs text-fg-muted">
          A IA cruza as tendências do período com o perfil de marca do cliente (público, tom, posicionamento e
          restrições), explica por que combinam e o que evitar. Temas arriscados ou incompatíveis não são recomendados.
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto] sm:items-end">
        <Field label="Cliente" htmlFor="fit-client">
          <NativeSelect id="fit-client" value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">Escolha um cliente</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Período" htmlFor="fit-period">
          <NativeSelect id="fit-period" value={period} onChange={(e) => setPeriod(e.target.value as "7d" | "30d")}>
            <option value="7d">Esta semana</option>
            <option value="30d">Últimos 30 dias</option>
          </NativeSelect>
        </Field>
        <Button
          variant="primary"
          disabled={!clientId}
          loading={action.pending}
          onClick={() => {
            setResult(null);
            void action.run({ clientId, period, selection });
          }}
        >
          <Sparkles /> Perguntar
        </Button>
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-xs text-fg-muted">Modelo de IA</summary>
        <AiModelPicker
          className="mt-2"
          providers={picker.providers}
          preferences={picker.preferences}
          task="trend_analysis"
          module="trends"
          value={selection}
          onChange={setSelection}
          disabled={action.pending}
        />
      </details>

      {result ? (
        <div className="grid gap-3" data-testid="client-fit-result">
          <p className="flex flex-wrap items-center gap-1.5 text-xs text-fg-muted">
            <Sparkles className="size-3.5 text-accent-text" />
            Inferência da IA para <strong className="text-fg">{result.clientName}</strong>
            {result.demo ? <Badge tone="warning">Demonstração</Badge> : null}
          </p>
          {result.recommended.length ? (
            <ul className="grid gap-2">
              {result.recommended.map((r) => (
                <li key={r.analysisId} className="rounded-lg border border-success/30 bg-success-soft/30 p-3 text-sm">
                  <p className="flex items-center gap-1.5 font-medium">
                    <CheckCircle2 className="size-4 text-success" />
                    <Link href={`${base}/${r.trendId}`} className="hover:underline">
                      {r.title}
                    </Link>
                  </p>
                  <p className="mt-1 text-fg-muted">{r.fit}</p>
                  {r.angles.length ? <p className="mt-1 text-xs">Ângulos: {r.angles.join(" · ")}</p> : null}
                  {r.avoid.length ? (
                    <p className="mt-0.5 text-xs text-fg-muted">Evitar: {r.avoid.join(" · ")}</p>
                  ) : null}
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Badge tone="outline">
                      Risco: {RISK_LEVELS[r.reputationRisk as keyof typeof RISK_LEVELS] ?? r.reputationRisk}
                    </Badge>
                    <Button asChild size="xs" variant="primary">
                      <Link href={`${base}/${r.trendId}?create=1&clientId=${clientId}`}>Criar conteúdo</Link>
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-fg-muted">Nenhuma tendência do período combina com esta marca com segurança.</p>
          )}
          {result.notRecommended.length ? (
            <div className="grid gap-1.5">
              <p className="text-xs font-medium text-fg-muted">Não recomendadas para esta marca</p>
              <ul className="grid gap-1.5">
                {result.notRecommended.map((r) => (
                  <li key={r.analysisId} className="flex items-start gap-1.5 text-xs text-fg-muted">
                    <XCircle className="mt-0.5 size-3.5 shrink-0 text-danger" />
                    <span>
                      <span className="font-medium text-fg">{r.title}</span> — {r.fit}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {result.notes ? (
            <p className="flex items-start gap-1.5 text-xs text-fg-muted">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {result.notes}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export function NewCollectionForm() {
  const [name, setName] = useState("");
  const action = useOrgAction(createCollectionAction, { success: "Coleção criada", onSuccess: () => setName("") });
  return (
    <form
      className="flex gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim().length >= 2) void action.run({ name });
      }}
    >
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Nova coleção"
        aria-label="Nome da nova coleção"
        className="h-8"
      />
      <Button type="submit" size="icon-sm" variant="secondary" aria-label="Criar coleção" loading={action.pending}>
        <FolderPlus />
      </Button>
    </form>
  );
}

export function DeleteCollectionButton({ id, name }: { id: string; name: string }) {
  const action = useOrgAction(deleteCollectionAction, { success: "Coleção excluída" });
  return (
    <ConfirmDialog
      trigger={
        <Button variant="ghost" size="icon-xs" aria-label={`Excluir coleção ${name}`}>
          <Trash2 />
        </Button>
      }
      title={`Excluir a coleção "${name}"?`}
      description="As tendências continuam no Radar; só o agrupamento é removido."
      confirmLabel="Excluir"
      onConfirm={() => action.run({ id })}
    />
  );
}
