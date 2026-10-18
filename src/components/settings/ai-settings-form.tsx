"use client";

import { KeyRound, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useOrgAction } from "@/hooks/use-action";
import { formatDateTime, formatNumber } from "@/lib/format";
import { updateAiSettingsAction } from "@/server/actions/ai";

type View = {
  enabled: boolean;
  provider: "anthropic" | "openai" | "gemini" | "demo";
  model: string;
  allowClientContext: boolean;
  monthlyTokenLimit: number;
  userDailyRequestLimit: number;
  orgKeyMask: string | null;
  envKeys: { anthropic: boolean; openai: boolean; gemini: boolean };
  anthropicModels: { id: string; label: string }[];
};

type Report = {
  byMonth: { month: string; requests: number; tokens: number; cost: number; errors: number; blocked: number }[];
  byUser: { userName: string | null; requests: number; tokens: number; cost: number }[];
  byOperation: { operation: string; requests: number; tokens: number }[];
  recentErrors: { createdAt: Date; operation: string; status: string; errorMessage: string | null }[];
};

const usd = (micros: number) => `US$ ${(micros / 1_000_000).toFixed(micros < 10_000_000 ? 4 : 2)}`;

export function AiSettingsForm({ view, report }: { view: View; report: Report }) {
  const [state, setState] = useState(view);
  const [apiKey, setApiKey] = useState("");
  const [removeKey, setRemoveKey] = useState(false);
  const save = useOrgAction(updateAiSettingsAction, {
    success: "Configurações de IA salvas",
    onSuccess: () => {
      setApiKey("");
      setRemoveKey(false);
    },
  });
  const envKey = state.provider === "demo" ? false : view.envKeys[state.provider];

  return (
    <div className="grid max-w-4xl gap-6">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Provedor e modelo</CardTitle>
            <CardDescription>
              A plataforma usa APIs oficiais. Trocar de provedor não muda nada nos módulos.
            </CardDescription>
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
              save.run({
                enabled: state.enabled,
                provider: state.provider,
                model: state.model,
                allowClientContext: state.allowClientContext,
                monthlyTokenLimit: state.monthlyTokenLimit,
                userDailyRequestLimit: state.userDailyRequestLimit,
                apiKey: removeKey ? "" : apiKey ? apiKey : undefined,
              });
            }}
          >
            <Field label="Provedor" htmlFor="ai-provider">
              <NativeSelect
                id="ai-provider"
                value={state.provider}
                onChange={(e) => setState({ ...state, provider: e.target.value as View["provider"], model: "" })}
              >
                <option value="anthropic">Anthropic (Claude)</option>
                <option value="openai">OpenAI (ChatGPT)</option>
                <option value="gemini">Google Gemini</option>
                <option value="demo">Demonstração (local, sem envio de dados)</option>
              </NativeSelect>
            </Field>
            {state.provider === "anthropic" ? (
              <Field label="Modelo" htmlFor="ai-model">
                <NativeSelect
                  id="ai-model"
                  value={state.model}
                  onChange={(e) => setState({ ...state, model: e.target.value })}
                >
                  <option value="">Padrão ({view.anthropicModels[0]?.label})</option>
                  {view.anthropicModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            ) : state.provider === "openai" ? (
              <Field
                label="Modelo"
                htmlFor="ai-model"
                error={save.fieldErrors.model}
                hint="Em branco: usa o GPT principal mais recente disponível para a chave."
              >
                <Input
                  id="ai-model"
                  value={state.model}
                  placeholder="Automático"
                  onChange={(e) => setState({ ...state, model: e.target.value })}
                />
              </Field>
            ) : state.provider === "gemini" ? (
              <Field
                label="Modelo"
                htmlFor="ai-model"
                hint="Em branco: usa o Gemini Flash estável mais recente disponível para a chave."
              >
                <Input
                  id="ai-model"
                  value={state.model}
                  placeholder="Automático"
                  onChange={(e) => setState({ ...state, model: e.target.value })}
                />
              </Field>
            ) : (
              <div />
            )}
            {state.provider !== "demo" ? (
              <Field
                label="Chave de API da organização"
                htmlFor="ai-key"
                className="sm:col-span-2"
                hint={
                  view.orgKeyMask && !removeKey
                    ? `Chave salva (${view.orgKeyMask}), guardada criptografada. Deixe em branco para manter.`
                    : envKey
                      ? "Sem chave própria: será usada a chave configurada no servidor."
                      : "Sem chave: o assistente funciona em modo demonstração."
                }
              >
                <div className="flex gap-2">
                  <Input
                    id="ai-key"
                    type="password"
                    autoComplete="off"
                    value={apiKey}
                    onChange={(e) => {
                      setApiKey(e.target.value);
                      setRemoveKey(false);
                    }}
                    placeholder={view.orgKeyMask ?? "Cole a chave aqui"}
                  />
                  {view.orgKeyMask ? (
                    <Button
                      type="button"
                      variant={removeKey ? "danger" : "secondary"}
                      onClick={() => setRemoveKey((r) => !r)}
                    >
                      <KeyRound /> {removeKey ? "Será removida" : "Remover"}
                    </Button>
                  ) : null}
                </div>
              </Field>
            ) : null}

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
                onChange={(e) => setState({ ...state, monthlyTokenLimit: Number(e.target.value) })}
              />
            </Field>
            <Field label="Gerações por pessoa por dia (0 = sem limite)" htmlFor="ai-daily">
              <Input
                id="ai-daily"
                type="number"
                min={0}
                value={state.userDailyRequestLimit}
                onChange={(e) => setState({ ...state, userDailyRequestLimit: Number(e.target.value) })}
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

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Uso e custo</CardTitle>
            <CardDescription>
              Tokens e custo informados pelo provedor (custo estimado pela tabela pública de preços).
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="grid gap-6">
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
                    <TD className="tabular text-right">{usd(m.cost)}</TD>
                    <TD className="tabular text-right">{m.errors}</TD>
                    <TD className="tabular text-right">{m.blocked}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
          {report.byUser.length ? (
            <div>
              <h3 className="mb-2 text-sm font-semibold">Neste mês, por pessoa</h3>
              <ul className="grid gap-1 text-sm">
                {report.byUser.map((u, i) => (
                  <li key={i} className="flex justify-between gap-3">
                    <span>{u.userName ?? "—"}</span>
                    <span className="tabular text-fg-muted">
                      {u.requests} gerações · {formatNumber(u.tokens)} tokens · {usd(u.cost)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {report.recentErrors.length ? (
            <div>
              <h3 className="mb-2 text-sm font-semibold">Falhas e bloqueios recentes</h3>
              <ul className="grid gap-1.5 text-sm">
                {report.recentErrors.map((e, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-2">
                    <Badge tone={e.status === "blocked" ? "warning" : "danger"}>
                      {e.status === "blocked" ? "Bloqueada" : "Erro"}
                    </Badge>
                    <span className="text-fg-muted">{formatDateTime(e.createdAt)}</span>
                    <span>{e.errorMessage}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
