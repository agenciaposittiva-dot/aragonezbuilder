"use client";

import { ChevronDown, KeyRound, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ModelCapabilities } from "@/components/ai/ai-model-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useOrgAction } from "@/hooks/use-action";
import { PREFERENCE_LEVEL_LABEL, PROVIDER_LABEL, type AiPreference, type PickerProvider } from "@/lib/ai-select";
import {
  AI_MODULES,
  AI_PRIORITIES,
  AI_TASKS,
  compatibility,
  type AiModelInfo,
  type AiPriority,
  type AiTask,
} from "@/lib/ai-tasks";
import { formatDateTime, formatNumber } from "@/lib/format";
import {
  deleteAiPreferenceAction,
  removeProviderKeyAction,
  saveProviderKeyAction,
  setAiPreferenceAction,
  setProviderEnabledAction,
  updateAiSettingsAction,
  validateProviderAction,
} from "@/server/actions/ai";

type ProviderId = "anthropic" | "openai" | "gemini" | "demo";

type Provider = {
  id: ProviderId;
  label: string;
  kinds: string[];
  needsKey: boolean;
  keySource: "org" | "env" | "none";
  keyMask: string | null;
  enabled: boolean;
  status: "unverified" | "valid" | "invalid" | "error";
  lastError: string | null;
  lastCheckedAt: Date | null;
  models: AiModelInfo[];
  ready: boolean;
  params: string[];
  notes: string[];
};

type View = {
  enabled: boolean;
  allowClientContext: boolean;
  monthlyTokenLimit: number;
  userDailyRequestLimit: number;
  monthlyCostLimitUsd: number;
  confirmAboveUsd: number;
};

type Report = {
  byMonth: {
    month: string;
    requests: number;
    tokens: number;
    cost: number;
    unknownCost: number;
    errors: number;
    blocked: number;
  }[];
  byUser: { userName: string | null; requests: number; tokens: number; cost: number; unknownCost: number }[];
  byModel: {
    provider: string;
    model: string;
    requests: number;
    errors: number;
    tokens: number;
    cost: number;
    unknownCost: number;
    avgLatencyMs: number | null;
  }[];
  recentErrors: { createdAt: Date; operation: string; status: string; errorMessage: string | null }[];
  recent: {
    id: string;
    createdAt: Date;
    provider: string;
    model: string;
    operation: string;
    module: string | null;
    task: string | null;
    selectionSource: string | null;
    status: string;
    inputTokens: number;
    outputTokens: number;
    costMicros: number | null;
    latencyMs: number | null;
    errorMessage: string | null;
    userName: string | null;
    clientName: string | null;
    projectName: string | null;
  }[];
};

const usd = (micros: number) => `US$ ${(micros / 1_000_000).toFixed(micros < 10_000_000 ? 4 : 2)}`;
const costText = (cost: number, unknown: number) =>
  unknown > 0 ? (cost > 0 ? `${usd(cost)} + ${unknown} sem custo informado` : "não informado") : usd(cost);

const STATUS: Record<Provider["status"], { label: string; tone: "success" | "danger" | "warning" | "neutral" }> = {
  valid: { label: "Credencial válida", tone: "success" },
  invalid: { label: "Credencial inválida", tone: "danger" },
  error: { label: "Erro na validação", tone: "warning" },
  unverified: { label: "Não verificada", tone: "neutral" },
};

export function AiSettingsForm({
  view,
  report,
  providers,
  picker,
}: {
  view: View;
  report: Report;
  providers: Provider[];
  picker: { providers: PickerProvider[]; preferences: AiPreference[] };
}) {
  return (
    <div className="grid max-w-5xl gap-6 [&>*]:min-w-0">
      <ProvidersCard providers={providers} />
      <DefaultsCard picker={picker} />
      <PolicyCard view={view} />
      <UsageCard report={report} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Provedores e credenciais                                            */
/* ------------------------------------------------------------------ */

function ProvidersCard({ providers }: { providers: Provider[] }) {
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Provedores e modelos</CardTitle>
          <CardDescription>
            As chaves ficam só no servidor (criptografadas) e são validadas com uma chamada real ao provedor antes de
            habilitar. Os modelos listados vêm da API de cada provedor.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3 [&>*]:min-w-0">
        {providers.map((p) => (
          <ProviderRow key={p.id} provider={p} />
        ))}
      </CardContent>
    </Card>
  );
}

function ProviderRow({ provider: p }: { provider: Provider }) {
  const [apiKey, setApiKey] = useState("");
  const [open, setOpen] = useState(false);
  const save = useOrgAction(saveProviderKeyAction);
  const validate = useOrgAction(validateProviderAction);
  const toggle = useOrgAction(setProviderEnabledAction, { success: "Provedor atualizado" });
  const removeKey = useOrgAction(removeProviderKeyAction, { success: "Chave própria removida" });
  const st = p.needsKey && p.keySource === "none" ? null : STATUS[p.status];
  const [saveError, setSaveError] = useState<string | null>(null);
  const [checkResult, setCheckResult] = useState<string | null>(null);

  return (
    <div className="grid min-w-0 gap-3 rounded-lg border border-border p-4 [&>*]:min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{p.label}</span>
        {st ? <Badge tone={st.tone}>{st.label}</Badge> : <Badge tone="outline">Não configurado</Badge>}
        {p.kinds.includes("image") ? <Badge tone="info">texto e imagem</Badge> : <Badge tone="outline">texto</Badge>}
        <span className="flex-1" />
        <label className="flex items-center gap-2 text-sm">
          {p.enabled ? "Habilitado" : "Desabilitado"}
          <Switch
            checked={p.enabled}
            disabled={toggle.pending || (p.needsKey && p.keySource === "none")}
            onCheckedChange={(v) => toggle.run({ provider: p.id, enabled: v })}
            aria-label={`Habilitar ${p.label}`}
          />
        </label>
      </div>
      <p className="text-xs text-fg-muted">
        {p.needsKey
          ? p.keySource === "org"
            ? `Chave da organização (${p.keyMask ?? "••••"}), guardada criptografada.`
            : p.keySource === "env"
              ? "Chave do servidor (variável de ambiente). Uma chave própria da organização tem prioridade."
              : "Sem chave: o provedor fica indisponível."
          : "Não usa chave. Respostas são exemplos locais, sempre identificados como demonstração."}
        {p.lastCheckedAt ? ` Última verificação: ${formatDateTime(p.lastCheckedAt)}.` : ""}
        {p.status === "valid" ? ` ${p.models.length} modelo(s) disponível(is).` : ""}
      </p>
      {p.lastError && p.status !== "valid" ? <p className="text-xs text-danger">{p.lastError}</p> : null}
      {saveError ? <p className="text-xs text-danger">{saveError}</p> : null}
      {checkResult ? <p className="text-xs text-fg-muted">{checkResult}</p> : null}

      {p.needsKey ? (
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={async (e) => {
            e.preventDefault();
            setSaveError(null);
            const res = await save.run({ provider: p.id, apiKey });
            if (!res.ok) return;
            if (res.data.ok) {
              setApiKey("");
              toast.success(`Chave validada e salva: ${res.data.models} modelo(s) disponível(is).`);
            } else {
              setSaveError(`Chave não salva: ${res.data.error}`);
            }
          }}
        >
          <Input
            type="password"
            autoComplete="off"
            aria-label={`Chave de API — ${p.label}`}
            placeholder={
              p.keySource === "org" ? "Nova chave (substitui a atual)" : "Cole a chave de API da organização"
            }
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" loading={save.pending} disabled={apiKey.trim().length < 8}>
              <KeyRound /> Validar e salvar
            </Button>
            {p.keySource === "org" ? (
              <Button
                type="button"
                variant="danger-ghost"
                loading={removeKey.pending}
                onClick={() => removeKey.run({ provider: p.id })}
              >
                <Trash2 /> Remover
              </Button>
            ) : null}
          </div>
        </form>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {p.keySource !== "none" || !p.needsKey ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            loading={validate.pending}
            onClick={async () => {
              setCheckResult(null);
              const res = await validate.run({ provider: p.id });
              if (res.ok)
                setCheckResult(
                  res.data.ok ? "Credencial válida. Lista de modelos atualizada." : (res.data.error ?? ""),
                );
            }}
          >
            <RefreshCw /> Validar agora
          </Button>
        ) : null}
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <ChevronDown className={open ? "rotate-180" : ""} /> Modelos, parâmetros e limites
        </Button>
      </div>

      {open ? (
        <div className="grid gap-3 text-sm [&>*]:min-w-0">
          <ul className="grid gap-1 text-xs text-fg-muted">
            {p.notes.map((n) => (
              <li key={n}>• {n}</li>
            ))}
            {p.params.length ? <li>• Parâmetros enviados: {p.params.join(", ")}.</li> : null}
          </ul>
          {p.models.length ? (
            <Table>
              <THead>
                <tr>
                  <TH>Modelo</TH>
                  <TH>Tipo</TH>
                  <TH>Capacidades</TH>
                  <TH className="text-right">Contexto / saída</TH>
                  <TH>Classificação</TH>
                </tr>
              </THead>
              <TBody>
                {p.models.map((m) => (
                  <TR key={m.id}>
                    <TD>
                      <span className="block font-medium">{m.label}</span>
                      <span className="block font-mono text-xs text-fg-subtle">{m.id}</span>
                    </TD>
                    <TD>{m.kind === "image" ? "imagem" : "texto"}</TD>
                    <TD>
                      <ModelCapabilities model={m} />
                    </TD>
                    <TD className="tabular text-right text-xs">
                      {m.maxInputTokens ? formatNumber(m.maxInputTokens) : "—"} /{" "}
                      {m.maxOutputTokens ? formatNumber(m.maxOutputTokens) : "—"}
                    </TD>
                    <TD className="text-xs text-fg-muted">
                      {
                        { fast: "rápido", balanced: "equilibrado", quality: "qualidade", unknown: "não informada" }[
                          m.tier
                        ]
                      }
                      {m.tierSource === "nome" ? " (pelo nome)" : ""}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          ) : (
            <p className="text-xs text-fg-muted">Nenhum modelo listado. Valide a credencial para buscar os modelos.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Padrões da organização                                              */
/* ------------------------------------------------------------------ */

type Level = { kind: "org" } | { kind: "module"; module: string } | { kind: "task"; task: AiTask };

function levelOf(p: AiPreference): Level {
  if (p.task) return { kind: "task", task: p.task as AiTask };
  if (p.module) return { kind: "module", module: p.module };
  return { kind: "org" };
}

function levelLabel(p: AiPreference) {
  const l = levelOf(p);
  if (l.kind === "task") return `Tarefa: ${AI_TASKS[l.task]?.label ?? l.task}`;
  if (l.kind === "module") return `Módulo: ${AI_MODULES[l.module as keyof typeof AI_MODULES] ?? l.module}`;
  return "Geral da organização";
}

function DefaultsCard({ picker }: { picker: { providers: PickerProvider[]; preferences: AiPreference[] } }) {
  const orgPrefs = picker.preferences.filter((p) => p.scope === "org");
  const ready = picker.providers.filter((p) => p.ready);
  const [level, setLevel] = useState("org");
  const [choice, setChoice] = useState("");
  const [priority, setPriority] = useState<AiPriority>("balanced");
  const save = useOrgAction(setAiPreferenceAction, { success: "Padrão salvo", onSuccess: () => setChoice("") });
  const remove = useOrgAction(deleteAiPreferenceAction, { success: "Padrão removido" });
  const task = level.startsWith("task:") ? (level.slice(5) as AiTask) : null;
  const moduleKey = level.startsWith("module:") ? level.slice(7) : "";
  const fits = (m: AiModelInfo) => (task ? compatibility(m, task).compatible : true);

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Padrões de modelo</CardTitle>
          <CardDescription>
            Ordem de prioridade: escolha feita na operação → padrão da pessoa (tarefa, módulo, geral) → padrão da
            organização (tarefa, módulo, geral) → escolha automática. Um padrão indisponível nunca é trocado em
            silêncio: a pessoa vê o motivo e as alternativas.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 [&>*]:min-w-0">
        {orgPrefs.length ? (
          <ul className="grid gap-1.5 text-sm">
            {orgPrefs.map((p) => (
              <li
                key={`${p.module}:${p.task}`}
                className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2"
              >
                <span className="font-medium">{levelLabel(p)}</span>
                <span className="text-fg-muted">
                  {p.provider
                    ? `${PROVIDER_LABEL[p.provider] ?? p.provider} · ${p.model ?? "melhor modelo compatível"}`
                    : `Automático (${AI_PRIORITIES[p.priority]})`}
                </span>
                <span className="flex-1" />
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  aria-label={`Remover padrão — ${levelLabel(p)}`}
                  onClick={() => remove.run({ scope: "org", module: p.module, task: p.task })}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-fg-muted">
            Sem padrões: cada operação usa a {PREFERENCE_LEVEL_LABEL.auto} entre os modelos habilitados.
          </p>
        )}

        <form
          className="grid gap-3 sm:grid-cols-[1fr_1.4fr_auto_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            const [provider, model] = choice ? choice.split("|") : [null, null];
            save.run({
              scope: "org",
              module: moduleKey,
              task: task ?? "",
              provider: provider || null,
              model: model || null,
              priority,
            });
          }}
        >
          <Field label="Aplicar a" htmlFor="ai-def-level">
            <NativeSelect id="ai-def-level" value={level} onChange={(e) => setLevel(e.target.value)}>
              <option value="org">Geral da organização</option>
              <optgroup label="Tarefa">
                {Object.entries(AI_TASKS).map(([k, t]) => (
                  <option key={k} value={`task:${k}`}>
                    {t.label}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Módulo">
                {Object.entries(AI_MODULES).map(([k, label]) => (
                  <option key={k} value={`module:${k}`}>
                    {label}
                  </option>
                ))}
              </optgroup>
            </NativeSelect>
          </Field>
          <Field label="Modelo" htmlFor="ai-def-model">
            <NativeSelect id="ai-def-model" value={choice} onChange={(e) => setChoice(e.target.value)}>
              <option value="">Escolher automaticamente</option>
              {ready.map((p) => (
                <optgroup key={p.id} label={p.label}>
                  <option value={`${p.id}|`}>Melhor modelo compatível de {p.label}</option>
                  {p.models.filter(fits).map((m) => (
                    <option key={m.id} value={`${p.id}|${m.id}`}>
                      {m.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Prioridade" htmlFor="ai-def-priority">
            <NativeSelect
              id="ai-def-priority"
              value={priority}
              onChange={(e) => setPriority(e.target.value as AiPriority)}
            >
              {Object.entries(AI_PRIORITIES).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Button type="submit" variant="primary" loading={save.pending}>
            Salvar padrão
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Política de uso                                                     */
/* ------------------------------------------------------------------ */

function PolicyCard({ view }: { view: View }) {
  const [state, setState] = useState(view);
  const save = useOrgAction(updateAiSettingsAction, { success: "Configurações de IA salvas" });
  const num = (k: keyof View) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setState({ ...state, [k]: Number(e.target.value) });

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Política de uso</CardTitle>
          <CardDescription>Limites e avisos valem para todos os provedores e modelos.</CardDescription>
        </div>
        <label className="flex items-center gap-2 text-sm">
          Ativo
          <Switch
            checked={state.enabled}
            onCheckedChange={(v) => setState({ ...state, enabled: v })}
            aria-label="Assistente ativo"
          />
        </label>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            save.run(state);
          }}
        >
          <div className="rounded-lg border border-border bg-surface-2/50 p-4 sm:col-span-2">
            <label className="flex items-start justify-between gap-4">
              <span>
                <span className="flex items-center gap-2 text-sm font-medium">
                  <ShieldCheck className="size-4 text-accent-text" /> Enviar contexto dos clientes ao provedor
                </span>
                <span className="mt-1 block text-xs text-fg-muted">
                  Tom de voz, público, objetivos, identidade visual, serviços e detalhes de projetos. Avalie seus
                  contratos e a LGPD antes de ativar. Desativado, só o texto digitado pelo usuário é enviado. Os dados
                  de um cliente nunca são misturados com os de outro.
                </span>
              </span>
              <Switch
                checked={state.allowClientContext}
                onCheckedChange={(v) => setState({ ...state, allowClientContext: v })}
                aria-label="Enviar contexto dos clientes"
              />
            </label>
          </div>
          <Field label="Limite mensal de tokens (0 = sem limite)" htmlFor="ai-month">
            <Input
              id="ai-month"
              type="number"
              min={0}
              value={state.monthlyTokenLimit}
              onChange={num("monthlyTokenLimit")}
            />
          </Field>
          <Field label="Gerações por pessoa por dia (0 = sem limite)" htmlFor="ai-daily">
            <Input
              id="ai-daily"
              type="number"
              min={0}
              value={state.userDailyRequestLimit}
              onChange={num("userDailyRequestLimit")}
            />
          </Field>
          <Field
            label="Limite mensal de custo em US$ (0 = sem limite)"
            htmlFor="ai-cost-month"
            hint="Conta só o custo estimado quando o provedor tem preço conhecido."
          >
            <Input
              id="ai-cost-month"
              type="number"
              min={0}
              step="0.01"
              value={state.monthlyCostLimitUsd}
              onChange={num("monthlyCostLimitUsd")}
            />
          </Field>
          <Field
            label="Pedir confirmação acima de US$ (0 = nunca)"
            htmlFor="ai-cost-confirm"
            hint="Quando o custo estimado passar deste valor, ou não for informado (imagens), a pessoa confirma antes."
          >
            <Input
              id="ai-cost-confirm"
              type="number"
              min={0}
              step="0.01"
              value={state.confirmAboveUsd}
              onChange={num("confirmAboveUsd")}
            />
          </Field>
          <div className="sm:col-span-2">
            <Button type="submit" variant="primary" loading={save.pending}>
              Salvar
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Uso, custo e histórico                                              */
/* ------------------------------------------------------------------ */

function UsageCard({ report }: { report: Report }) {
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Uso e custo</CardTitle>
          <CardDescription>
            Tokens informados pelo provedor. Custo estimado pela tabela de preços quando ela existe; quando não há dados
            suficientes, aparece como “não informado”.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="grid gap-6 [&>*]:min-w-0">
        {report.byMonth.length === 0 ? (
          <p className="text-sm text-fg-muted">Nenhum uso registrado ainda.</p>
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Mês</TH>
                <TH className="text-right">Gerações</TH>
                <TH className="text-right">Tokens</TH>
                <TH className="text-right">Custo</TH>
                <TH className="text-right">Erros</TH>
                <TH className="text-right">Bloqueadas</TH>
              </tr>
            </THead>
            <TBody>
              {report.byMonth.map((m) => (
                <TR key={m.month}>
                  <TD>{m.month}</TD>
                  <TD className="tabular text-right">{m.requests}</TD>
                  <TD className="tabular text-right">{formatNumber(m.tokens)}</TD>
                  <TD className="tabular text-right">{costText(m.cost, m.unknownCost)}</TD>
                  <TD className="tabular text-right">{m.errors}</TD>
                  <TD className="tabular text-right">{m.blocked}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
        {report.byModel.length ? (
          <div>
            <h3 className="mb-2 text-sm font-semibold">Neste mês, por modelo</h3>
            <Table>
              <THead>
                <tr>
                  <TH>Provedor / modelo</TH>
                  <TH className="text-right">Gerações</TH>
                  <TH className="text-right">Erros</TH>
                  <TH className="text-right">Tokens</TH>
                  <TH className="text-right">Duração média</TH>
                  <TH className="text-right">Custo</TH>
                </tr>
              </THead>
              <TBody>
                {report.byModel.map((m) => (
                  <TR key={`${m.provider}:${m.model}`}>
                    <TD>
                      <span className="block">{PROVIDER_LABEL[m.provider] ?? m.provider}</span>
                      <span className="block font-mono text-xs text-fg-subtle">{m.model}</span>
                    </TD>
                    <TD className="tabular text-right">{m.requests}</TD>
                    <TD className="tabular text-right">{m.errors}</TD>
                    <TD className="tabular text-right">{formatNumber(m.tokens)}</TD>
                    <TD className="tabular text-right">
                      {m.avgLatencyMs !== null ? `${(m.avgLatencyMs / 1000).toFixed(1)} s` : "—"}
                    </TD>
                    <TD className="tabular text-right">{costText(m.cost, m.unknownCost)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        ) : null}
        {report.byUser.length ? (
          <div>
            <h3 className="mb-2 text-sm font-semibold">Neste mês, por pessoa</h3>
            <ul className="grid gap-1 text-sm">
              {report.byUser.map((u, i) => (
                <li key={i} className="flex flex-wrap justify-between gap-x-3">
                  <span>{u.userName ?? "—"}</span>
                  <span className="tabular text-fg-muted">
                    {u.requests} gerações · {formatNumber(u.tokens)} tokens · {costText(u.cost, u.unknownCost)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {report.recent.length ? (
          <div>
            <h3 className="mb-2 text-sm font-semibold">Histórico recente</h3>
            <Table>
              <THead>
                <tr>
                  <TH>Quando</TH>
                  <TH>Pessoa</TH>
                  <TH>Operação</TH>
                  <TH>Modelo</TH>
                  <TH>Situação</TH>
                  <TH className="text-right">Tokens</TH>
                  <TH className="text-right">Duração</TH>
                  <TH className="text-right">Custo</TH>
                </tr>
              </THead>
              <TBody>
                {report.recent.map((r) => (
                  <TR key={r.id}>
                    <TD className="text-xs whitespace-nowrap">{formatDateTime(r.createdAt)}</TD>
                    <TD className="text-xs">{r.userName ?? "—"}</TD>
                    <TD className="text-xs">
                      <span className="block">
                        {r.task && r.task in AI_TASKS ? AI_TASKS[r.task as AiTask].label : r.operation}
                      </span>
                      <span className="block text-fg-subtle">
                        {[
                          r.module ? (AI_MODULES[r.module as keyof typeof AI_MODULES] ?? r.module) : null,
                          r.clientName,
                          r.projectName,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </TD>
                    <TD className="text-xs">
                      <span className="block font-mono">{r.model}</span>
                      <span className="block text-fg-subtle">
                        {PROVIDER_LABEL[r.provider] ?? r.provider}
                        {r.selectionSource
                          ? ` · ${PREFERENCE_LEVEL_LABEL[r.selectionSource as keyof typeof PREFERENCE_LEVEL_LABEL] ?? r.selectionSource}`
                          : ""}
                      </span>
                    </TD>
                    <TD>
                      <Badge tone={r.status === "success" ? "success" : r.status === "blocked" ? "warning" : "danger"}>
                        {r.status === "success" ? "Concluída" : r.status === "blocked" ? "Bloqueada" : "Falhou"}
                      </Badge>
                      {r.errorMessage ? (
                        <span className="mt-0.5 block text-xs text-fg-muted">{r.errorMessage}</span>
                      ) : null}
                    </TD>
                    <TD className="tabular text-right text-xs">{formatNumber(r.inputTokens + r.outputTokens)}</TD>
                    <TD className="tabular text-right text-xs">
                      {r.latencyMs !== null ? `${(r.latencyMs / 1000).toFixed(1)} s` : "—"}
                    </TD>
                    <TD className="tabular text-right text-xs">
                      {r.costMicros !== null ? usd(r.costMicros) : "não informado"}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
