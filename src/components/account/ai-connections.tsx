"use client";

import { ChevronDown, KeyRound, RefreshCw, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { ModelCapabilities } from "@/components/ai/ai-model-picker";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/checkbox";
import { Input, NativeSelect } from "@/components/ui/input";
import { useOrgAction } from "@/hooks/use-action";
import { PROVIDER_LABEL, type AiPreference } from "@/lib/ai-select";
import { AI_TASKS, compatibility, type AiModelInfo, type AiTask } from "@/lib/ai-tasks";
import { formatDateTime, formatNumber } from "@/lib/format";
import { deleteAiPreferenceAction, setAiPreferenceAction } from "@/server/actions/ai";
import {
  removeMyAiConnectionAction,
  saveMyAiConnectionAction,
  setMyAiConnectionEnabledAction,
  testMyAiConnectionAction,
} from "@/server/actions/ai-connections";
import type { ConnectionState, MyConnection, UsageSlice } from "@/server/services/ai-connections";
import type { AiPickerData } from "@/server/services/ai-models";

/*
 * "Minhas inteligências artificiais": conexões pessoais (BYOK), modelo padrão
 * por finalidade e consumo do mês. A chave nunca chega aqui inteira — só o
 * final mascarado; salvar/testar acontece no servidor com uma chamada real.
 */

const STATE: Record<
  ConnectionState,
  { label: string; tone: "success" | "danger" | "warning" | "neutral" | "outline" }
> = {
  not_configured: { label: "Não configurada", tone: "outline" },
  configured: { label: "Configurada (não verificada)", tone: "neutral" },
  working: { label: "Funcionando", tone: "success" },
  error: { label: "Erro", tone: "danger" },
};

/** Finalidades com padrão pessoal escolhível (as demais usam o padrão geral). */
const DEFAULT_TASKS: AiTask[] = [
  "text",
  "copy",
  "captions",
  "planning",
  "structured",
  "chat",
  "design_edit",
  "image_generation",
  "image_edit",
  "image_upscale",
];

const usd = (micros: number) => `US$ ${(micros / 1_000_000).toFixed(micros < 10_000_000 ? 4 : 2)}`;

export function AiConnectionsPanel({
  connections,
  picker,
  preferences,
  usage,
}: {
  connections: MyConnection[];
  picker: AiPickerData;
  preferences: AiPreference[];
  usage: { personal: UsageSlice; shared: UsageSlice; unknown: UsageSlice };
}) {
  return (
    <div className="grid max-w-4xl gap-6 [&>*]:min-w-0">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Minhas conexões</CardTitle>
            <CardDescription>
              Cada chave é validada numa chamada real ao provedor antes de ser salva, fica criptografada no servidor e
              vale só para você nesta organização. Uma chave sua válida e ativa tem prioridade sobre a chave da
              organização e a do servidor. Uma chave válida não garante créditos nem acesso a todos os modelos: isso
              depende da sua conta no provedor.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 [&>*]:min-w-0">
          {connections.map((c) => (
            <ConnectionRow key={c.provider} c={c} />
          ))}
        </CardContent>
      </Card>
      <DefaultsByTask picker={picker} preferences={preferences} connections={connections} />
      <UsageCard usage={usage} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Conexão por provedor                                                */
/* ------------------------------------------------------------------ */

function ConnectionRow({ c }: { c: MyConnection }) {
  const router = useRouter();
  const [apiKey, setApiKey] = useState("");
  const [endpoint, setEndpoint] = useState(c.endpointUrl ?? "");
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<{ tone: "danger" | "muted"; text: string } | null>(null);
  const refresh = () => router.refresh();
  const save = useOrgAction(saveMyAiConnectionAction);
  const test = useOrgAction(testMyAiConnectionAction);
  const toggle = useOrgAction(setMyAiConnectionEnabledAction, { success: "Conexão atualizada", onSuccess: refresh });
  const remove = useOrgAction(removeMyAiConnectionAction, { success: "Conexão removida", onSuccess: refresh });
  const st = STATE[c.state];
  const configured = c.state !== "not_configured";
  const endpointChanged = (c.endpointUrl ?? "") !== endpoint.trim();
  const canSave = c.allowed && (apiKey.trim().length >= 8 || (configured && endpointChanged));

  return (
    <div
      className="grid min-w-0 gap-3 rounded-lg border border-border p-4 [&>*]:min-w-0"
      data-testid={`ai-connection-${c.provider}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{c.label}</span>
        <Badge tone={st.tone} data-testid="ai-connection-state">
          {st.label}
        </Badge>
        {c.kinds.includes("image") && c.kinds.includes("text") ? (
          <Badge tone="info">texto e imagem</Badge>
        ) : c.kinds.includes("image") ? (
          <Badge tone="info">imagem</Badge>
        ) : (
          <Badge tone="outline">texto</Badge>
        )}
        <span className="flex-1" />
        {configured ? (
          <label className="flex items-center gap-2 text-sm">
            {c.enabled ? "Ativa" : "Desativada"}
            <Switch
              checked={c.enabled}
              disabled={toggle.pending || (!c.enabled && !c.allowed)}
              onCheckedChange={(v) => toggle.run({ provider: c.provider, enabled: v })}
              aria-label={`Ativar conexão ${c.label}`}
            />
          </label>
        ) : null}
      </div>

      <p className="text-xs text-fg-muted">
        {configured ? `Chave ${c.keyMask ?? "••••"}, guardada criptografada.` : "Nenhuma chave sua cadastrada."}
        {c.lastCheckedAt ? ` Última verificação: ${formatDateTime(c.lastCheckedAt)}.` : ""}
        {c.state === "working" ? ` ${c.models.length} modelo(s) disponível(is).` : ""}
        {c.keyHelp ? ` Onde obter: ${c.keyHelp}.` : ""}
      </p>
      {!c.allowed ? (
        <p className="text-xs text-warning" data-testid="ai-connection-policy">
          {c.policyReason}
        </p>
      ) : null}
      {c.lastError && c.state === "error" ? <p className="text-xs text-danger">{c.lastError}</p> : null}
      {message ? (
        <p className={message.tone === "danger" ? "text-xs text-danger" : "text-xs text-fg-muted"} role="status">
          {message.text}
        </p>
      ) : null}

      <form
        className="grid gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setMessage(null);
          const res = await save.run({
            provider: c.provider,
            apiKey: apiKey.trim() ? apiKey.trim() : undefined,
            ...(c.customEndpoint && endpointChanged ? { endpointUrl: endpoint.trim() || null } : {}),
          });
          if (!res.ok) return;
          if (res.data.ok) {
            setApiKey("");
            toast.success(`Conexão validada e salva: ${res.data.models} modelo(s) disponível(is).`);
            refresh();
          } else {
            setMessage({ tone: "danger", text: `Chave não salva: ${res.data.error}` });
          }
        }}
      >
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            type="password"
            autoComplete="off"
            aria-label={`Chave de API — ${c.label}`}
            placeholder={configured ? "Nova chave (substitui a atual)" : "Cole a sua chave de API"}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            disabled={!c.allowed || save.pending}
          />
          <Button type="submit" variant="primary" loading={save.pending} disabled={!canSave}>
            <KeyRound /> {configured ? "Validar e salvar" : "Conectar"}
          </Button>
        </div>
        {c.customEndpoint ? (
          <label className="grid gap-1 text-xs">
            <span className="text-fg-muted">
              Endereço da API (opcional, só gateways compatíveis; https obrigatório)
            </span>
            <Input
              type="url"
              inputMode="url"
              aria-label={`Endereço da API — ${c.label}`}
              placeholder="https://…"
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              disabled={!c.allowed || save.pending}
            />
            {save.fieldErrors.endpointUrl?.length ? (
              <span className="text-danger">{save.fieldErrors.endpointUrl.join(" ")}</span>
            ) : null}
          </label>
        ) : null}
      </form>

      <div className="flex flex-wrap gap-2">
        {configured ? (
          <>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              loading={test.pending}
              onClick={async () => {
                setMessage(null);
                const res = await test.run({ provider: c.provider });
                if (!res.ok) return;
                setMessage(
                  res.data.ok
                    ? { tone: "muted", text: `Conexão funcionando: ${res.data.models} modelo(s) disponível(is).` }
                    : { tone: "danger", text: res.data.error ?? "Falha na verificação." },
                );
                refresh();
              }}
              data-testid="ai-connection-test"
            >
              <RefreshCw /> Testar conexão
            </Button>
            <ConfirmDialog
              title={`Remover a conexão com ${c.label}?`}
              description="A chave é apagada do servidor. As gerações já feitas continuam no histórico. Se a organização tiver uma chave própria, ela volta a ser usada."
              confirmLabel="Remover"
              onConfirm={() => remove.run({ provider: c.provider })}
              trigger={
                <Button type="button" size="sm" variant="danger-ghost" loading={remove.pending}>
                  <Trash2 /> Remover
                </Button>
              }
            />
          </>
        ) : null}
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <ChevronDown className={open ? "rotate-180" : ""} /> Modelos e observações
        </Button>
      </div>

      {open ? (
        <div className="grid gap-2 text-sm">
          <ul className="grid gap-1 text-xs text-fg-muted">
            {c.notes.map((n) => (
              <li key={n}>• {n}</li>
            ))}
          </ul>
          {c.models.length ? (
            <ul className="grid gap-1">
              {c.models.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-medium">{m.label}</span>
                  <span className="font-mono text-fg-subtle">{m.id}</span>
                  <Badge tone="outline">{m.kind === "image" ? "imagem" : "texto"}</Badge>
                  <ModelCapabilities model={m} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-fg-muted">
              {configured ? "Nenhum modelo listado. Teste a conexão." : "Conecte a chave para listar os modelos."}
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Modelo padrão por finalidade (preferências pessoais)                */
/* ------------------------------------------------------------------ */

function DefaultsByTask({
  picker,
  preferences,
  connections,
}: {
  picker: AiPickerData;
  preferences: AiPreference[];
  connections: MyConnection[];
}) {
  const router = useRouter();
  const set = useOrgAction(setAiPreferenceAction, { success: "Padrão salvo", onSuccess: () => router.refresh() });
  const del = useOrgAction(deleteAiPreferenceAction, { success: "Padrão removido", onSuccess: () => router.refresh() });
  // Modelos disponíveis para mim: os da organização e os das minhas conexões funcionando.
  const byProvider = new Map<string, AiModelInfo[]>();
  for (const p of picker.providers) if (p.ready) byProvider.set(p.id, [...p.models]);
  for (const c of connections) {
    if (c.state !== "working" || !c.enabled || !c.allowed) continue;
    const list = byProvider.get(c.provider) ?? [];
    for (const m of c.models) if (!list.some((x) => x.id === m.id)) list.push(m);
    byProvider.set(c.provider, list);
  }
  const options = (task: AiTask) =>
    [...byProvider.entries()].flatMap(([provider, models]) =>
      models
        .filter((m) => !m.deprecated && compatibility(m, task).compatible)
        .map((m) => ({ value: `${provider}:${m.id}`, label: `${m.label} · ${PROVIDER_LABEL[provider] ?? provider}` })),
    );
  const current = (task: AiTask) => {
    const mine = preferences.find((p) => p.scope === "user" && p.task === task && !p.module);
    return mine?.provider ? `${mine.provider}:${mine.model ?? ""}` : "";
  };
  const orgDefault = (task: AiTask) => {
    const o = preferences.find((p) => p.scope === "org" && (p.task === task || !p.task) && !p.module);
    if (!o?.provider) return null;
    return `${o.model ?? "automático"} · ${PROVIDER_LABEL[o.provider] ?? o.provider}`;
  };
  const busy = set.pending || del.pending;

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Modelo padrão por finalidade</CardTitle>
          <CardDescription>
            Vale só para você e tem prioridade sobre o padrão da organização. Modelos de texto e de imagem não se
            misturam: cada finalidade só lista os compatíveis. &ldquo;Automático&rdquo; segue as regras da plataforma.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="grid gap-2">
        {DEFAULT_TASKS.map((task) => {
          const opts = options(task);
          const value = current(task);
          const org = orgDefault(task);
          return (
            <label
              key={task}
              className="grid gap-1 text-sm sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] sm:items-center"
            >
              <span>
                <span className="block">{AI_TASKS[task].label}</span>
                {org ? <span className="block text-xs text-fg-subtle">Padrão da organização: {org}</span> : null}
              </span>
              <NativeSelect
                value={opts.some((o) => o.value === value) ? value : ""}
                disabled={busy}
                aria-label={`Modelo padrão para ${AI_TASKS[task].label}`}
                onChange={(e) => {
                  const v = e.target.value;
                  if (!v) return void del.run({ scope: "user", task, module: "" });
                  const [provider, model] = v.split(":") as [string, string];
                  void set.run({ scope: "user", task, module: "", provider, model, priority: "balanced" });
                }}
              >
                <option value="">Automático</option>
                {opts.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </NativeSelect>
            </label>
          );
        })}
        {byProvider.size === 0 ? (
          <p className="text-xs text-fg-muted">
            Nenhum provedor pronto: conecte uma chave acima ou peça à organização.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Consumo                                                             */
/* ------------------------------------------------------------------ */

function UsageCard({ usage }: { usage: { personal: UsageSlice; shared: UsageSlice; unknown: UsageSlice } }) {
  const row = (label: string, u: UsageSlice) => (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border py-2 last:border-0">
      <span className="text-sm">{label}</span>
      <span className="tabular text-xs text-fg-muted">
        {formatNumber(u.requests)} pedido(s) · {formatNumber(u.tokens)} tokens ·{" "}
        {u.unknownCost > 0
          ? u.costMicros > 0
            ? `${usd(u.costMicros)} + ${u.unknownCost} sem custo informado`
            : "custo não informado pelo provedor"
          : usd(u.costMicros)}
      </span>
    </div>
  );
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Meu consumo este mês</CardTitle>
          <CardDescription>
            Pedidos feitos com as suas chaves são cobrados na sua conta do provedor; com as credenciais da organização
            ou do servidor, na conta da agência. Custos só aparecem quando o provedor informa tokens e há tabela de
            preço; créditos (ex.: Magnific) não se misturam com tokens.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="grid">
        {row("Com minhas chaves", usage.personal)}
        {row("Com credenciais da organização/servidor", usage.shared)}
        {usage.unknown.requests ? row("Origem da credencial não registrada", usage.unknown) : null}
      </CardContent>
    </Card>
  );
}
