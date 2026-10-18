"use client";

import { Check, Copy, Pin, PinOff, ShieldAlert, Sparkles, Square, Trash2, Wand2 } from "lucide-react";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Markdown } from "@/components/app/markdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { useWorkspace } from "@/components/shell/workspace-context";
import { useOrgAction } from "@/hooks/use-action";
import { AI_OPERATIONS, getOperation } from "@/lib/ai-operations";
import { formatDateTime, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { createSuggestedTasksAction, deleteGenerationAction, togglePinGenerationAction } from "@/server/actions/ai";

type Generation = {
  id: string;
  kind: string;
  title: string;
  output: string;
  model: string;
  pinnedAt: Date | null;
  createdAt: Date;
  clientName: string | null;
  userName: string | null;
  userId: string | null;
};

type SuggestedTask = { title: string; description: string; estimateMinutes: number; selected: boolean };

export function AiStudio({
  status,
  clients,
  projects,
  history,
  canConfigure,
  canCreateTasks,
}: {
  status: {
    enabled: boolean;
    demo: boolean;
    providerLabel: string;
    model: string;
    allowClientContext: boolean;
    monthTokens: number;
    monthlyTokenLimit: number;
    myRequestsToday: number;
    userDailyRequestLimit: number;
  };
  clients: { id: string; name: string }[];
  projects: { id: string; name: string; clientName: string }[];
  history: Generation[];
  canConfigure: boolean;
  canCreateTasks: boolean;
}) {
  const ws = useWorkspace();
  const [opKey, setOpKey] = useState(AI_OPERATIONS[0]!.key);
  const op = getOperation(opKey)!;
  const [values, setValues] = useState<Record<string, string>>({});
  const [clientId, setClientId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [output, setOutput] = useState("");
  const [tasks, setTasks] = useState<SuggestedTask[] | null>(null);
  const [running, setRunning] = useState(false);
  const [meta, setMeta] = useState<{ demo: boolean; model: string; contextUsed: boolean } | null>(null);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const pin = useOrgAction(togglePinGenerationAction);
  const remove = useOrgAction(deleteGenerationAction, { success: "Geração excluída" });
  const createTasks = useOrgAction(createSuggestedTasksAction, {
    success: (d) => `${d.created} tarefa(s) criada(s) no projeto`,
    onSuccess: () => setTasks(null),
  });

  const groups = useMemo(() => {
    const map = new Map<string, typeof AI_OPERATIONS>();
    for (const o of AI_OPERATIONS) map.set(o.group, [...(map.get(o.group) ?? []), o]);
    return [...map.entries()];
  }, []);

  async function generate() {
    setErrors({});
    setOutput("");
    setTasks(null);
    setMeta(null);
    setRunning(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          orgSlug: ws.orgSlug,
          operation: op.key,
          input: values,
          clientId: op.needsProject ? null : clientId || null,
          projectId: op.needsProject ? projectId || null : null,
        }),
      });
      if (!res.ok || !res.body) {
        const err = (await res.json().catch(() => ({}))) as { error?: string; fieldErrors?: Record<string, string[]> };
        setErrors(err.fieldErrors ?? {});
        toast.error(err.error ?? "Não foi possível gerar.");
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 1);
          if (!line.trim()) continue;
          const msg = JSON.parse(line) as
            | { t: "meta"; demo: boolean; model: string; contextUsed: boolean }
            | { t: "chunk"; v: string }
            | { t: "done"; data?: { tasks?: Omit<SuggestedTask, "selected">[] } | null }
            | { t: "error"; message: string };
          if (msg.t === "meta") setMeta(msg);
          else if (msg.t === "chunk") setOutput((o) => o + msg.v);
          else if (msg.t === "error") toast.error(msg.message);
          else if (msg.t === "done") {
            if (op.structured) {
              const list = msg.data?.tasks;
              if (list?.length) setTasks(list.map((t) => ({ ...t, selected: true })));
              else toast.error("A resposta não veio no formato esperado. Tente novamente.");
            }
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") toast.error("Falha de conexão durante a geração.");
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }

  const missing = op.fields.some((f) => f.required && !values[f.key]?.trim()) || (op.needsProject && !projectId);
  const usagePct = status.monthlyTokenLimit ? Math.min(1, status.monthTokens / status.monthlyTokenLimit) : 0;

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-sm shadow-xs">
        {status.demo ? (
          <Badge tone="warning">
            <ShieldAlert /> Modo demonstração (sem provedor configurado)
          </Badge>
        ) : (
          <Badge tone="accent">
            <Sparkles /> {status.providerLabel} · {status.model}
          </Badge>
        )}
        <span className="text-fg-muted">
          {status.allowClientContext
            ? "Contexto de clientes autorizado"
            : "Dados de clientes não são enviados ao provedor"}
        </span>
        <span className="flex-1" />
        <div className="flex min-w-48 items-center gap-2 text-xs text-fg-muted">
          <span className="tabular">
            {formatNumber(status.monthTokens)}
            {status.monthlyTokenLimit ? ` / ${formatNumber(status.monthlyTokenLimit)}` : ""} tokens no mês
          </span>
          {status.monthlyTokenLimit ? (
            <span className="h-1.5 w-20 overflow-hidden rounded-full bg-surface-3">
              <span
                className={cn("block h-full rounded-full", usagePct > 0.9 ? "bg-danger" : "bg-accent")}
                style={{ width: `${usagePct * 100}%` }}
              />
            </span>
          ) : null}
        </div>
        <span className="tabular text-xs text-fg-muted">
          Hoje: {status.myRequestsToday}
          {status.userDailyRequestLimit ? `/${status.userDailyRequestLimit}` : ""}
        </span>
        {canConfigure ? (
          <Link href={`/w/${ws.orgSlug}/settings/ai`} className="text-xs font-medium text-accent-text hover:underline">
            Configurar
          </Link>
        ) : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
        <nav className="grid content-start gap-4" aria-label="Operações">
          {groups.map(([group, ops]) => (
            <div key={group}>
              <p className="mb-1 px-2 text-[11px] font-semibold tracking-wide text-fg-subtle uppercase">{group}</p>
              <ul className="grid gap-0.5">
                {ops.map((o) => (
                  <li key={o.key}>
                    <button
                      type="button"
                      onClick={() => {
                        setOpKey(o.key);
                        setErrors({});
                      }}
                      className={cn(
                        "w-full rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                        o.key === opKey
                          ? "bg-accent-soft font-medium text-fg"
                          : "text-fg-muted hover:bg-surface-2 hover:text-fg",
                      )}
                    >
                      {o.label}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="grid min-w-0 content-start gap-6">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>{op.label}</CardTitle>
                <p className="mt-0.5 text-xs text-fg-muted">{op.description}</p>
              </div>
            </CardHeader>
            <CardContent>
              <form
                className="grid gap-4 sm:grid-cols-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!running && !missing) generate();
                }}
              >
                {op.needsProject ? (
                  <Field
                    label="Projeto"
                    htmlFor="ai-project"
                    required
                    error={errors.projectId}
                    className="sm:col-span-2"
                  >
                    <NativeSelect id="ai-project" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                      <option value="">Selecione…</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.clientName} · {p.name}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                ) : (
                  <Field
                    label="Cliente (opcional)"
                    htmlFor="ai-client"
                    hint={
                      clientId && !status.allowClientContext && !status.demo
                        ? "A organização não autorizou enviar dados do cliente: só o seu texto será usado."
                        : "Usa tom de voz, público e identidade cadastrados na marca."
                    }
                    className="sm:col-span-2"
                  >
                    <NativeSelect id="ai-client" value={clientId} onChange={(e) => setClientId(e.target.value)}>
                      <option value="">Nenhum (texto genérico)</option>
                      {clients.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                )}
                {op.fields.map((f) => {
                  const id = `ai-${f.key}`;
                  const common = {
                    id,
                    value: values[f.key] ?? "",
                    placeholder: f.placeholder,
                    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
                      setValues((v) => ({ ...v, [f.key]: e.target.value })),
                  };
                  return (
                    <Field
                      key={f.key}
                      label={f.label}
                      htmlFor={id}
                      required={f.required}
                      error={errors[f.key]}
                      className={f.type === "textarea" ? "sm:col-span-2" : ""}
                    >
                      {f.type === "textarea" ? (
                        <Textarea rows={4} {...common} />
                      ) : f.type === "select" ? (
                        <NativeSelect {...common}>
                          <option value="">Indiferente</option>
                          {f.options?.map((o) => (
                            <option key={o} value={o}>
                              {o}
                            </option>
                          ))}
                        </NativeSelect>
                      ) : (
                        <Input
                          type={f.type === "number" ? "number" : "text"}
                          min={f.type === "number" ? 1 : undefined}
                          max={f.type === "number" ? 30 : undefined}
                          {...common}
                        />
                      )}
                    </Field>
                  );
                })}
                <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
                  <Button
                    type="submit"
                    variant="accent"
                    disabled={missing || running || !status.enabled}
                    loading={running}
                  >
                    <Wand2 /> {running ? "Gerando…" : "Gerar"}
                  </Button>
                  {running ? (
                    <Button type="button" variant="secondary" onClick={() => abortRef.current?.abort()}>
                      <Square /> Parar
                    </Button>
                  ) : null}
                  {!status.enabled ? (
                    <span className="text-xs text-danger">O assistente está desativado nesta organização.</span>
                  ) : null}
                </div>
              </form>
            </CardContent>
          </Card>

          {output || tasks || running ? (
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Resultado</CardTitle>
                  {meta ? (
                    <p className="mt-0.5 text-xs text-fg-muted">
                      {meta.demo ? "Exemplo local" : meta.model}
                      {meta.contextUsed ? " · com contexto da marca" : ""}
                    </p>
                  ) : null}
                </div>
                {output ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={async () => {
                      await navigator.clipboard.writeText(output);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    }}
                  >
                    {copied ? <Check /> : <Copy />} {copied ? "Copiado" : "Copiar"}
                  </Button>
                ) : null}
              </CardHeader>
              <CardContent>
                {tasks ? (
                  <div className="grid gap-3">
                    <p className="text-sm text-fg-muted">Revise as sugestões. Nada é criado sem a sua confirmação.</p>
                    <ul className="grid gap-2">
                      {tasks.map((t, i) => (
                        <li key={i} className="flex items-start gap-3 rounded-lg border border-border p-3">
                          <Checkbox
                            className="mt-1"
                            checked={t.selected}
                            onCheckedChange={(v) =>
                              setTasks((list) => list!.map((x, j) => (j === i ? { ...x, selected: v === true } : x)))
                            }
                            aria-label={`Selecionar ${t.title}`}
                          />
                          <div className="grid min-w-0 flex-1 gap-1">
                            <Input
                              value={t.title}
                              onChange={(e) =>
                                setTasks((list) => list!.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))
                              }
                              className="h-8 font-medium"
                              aria-label="Título da tarefa"
                            />
                            <p className="text-xs text-fg-muted">
                              {t.description} · {Math.round(t.estimateMinutes / 60) || 1}h estimadas
                            </p>
                          </div>
                        </li>
                      ))}
                    </ul>
                    {canCreateTasks && projectId ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          variant="primary"
                          loading={createTasks.pending}
                          disabled={!tasks.some((t) => t.selected && t.title.trim())}
                          onClick={() =>
                            createTasks.run({
                              projectId,
                              tasks: tasks
                                .filter((t) => t.selected && t.title.trim())
                                .map(({ title, description, estimateMinutes }) => ({
                                  title,
                                  description,
                                  estimateMinutes,
                                })),
                            })
                          }
                        >
                          Criar {tasks.filter((t) => t.selected && t.title.trim()).length} tarefa(s) no projeto
                        </Button>
                        <Link
                          href={`/w/${ws.orgSlug}/projects/${projectId}`}
                          className="text-sm text-fg-muted hover:text-fg"
                        >
                          Abrir projeto
                        </Link>
                      </div>
                    ) : null}
                  </div>
                ) : output ? (
                  <Markdown text={output} />
                ) : (
                  <p className="animate-pulse text-sm text-fg-muted">Gerando…</p>
                )}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Histórico</CardTitle>
            </CardHeader>
            <CardContent>
              {history.length === 0 ? (
                <EmptyState
                  compact
                  icon={Sparkles}
                  title="Nenhuma geração ainda"
                  description="O que você gerar fica salvo aqui para reutilizar."
                />
              ) : (
                <ul className="grid divide-y divide-border">
                  {history.map((g) => (
                    <li key={g.id} className="group flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left"
                        onClick={() => {
                          setTasks(null);
                          setMeta(null);
                          setOutput(g.output);
                          window.scrollTo({ top: 0, behavior: "smooth" });
                        }}
                      >
                        <span className="flex items-center gap-2">
                          {g.pinnedAt ? <Pin className="size-3 text-accent-text" /> : null}
                          <span className="truncate text-sm font-medium">{g.title}</span>
                        </span>
                        <span className="block truncate text-xs text-fg-muted">
                          {getOperation(g.kind)?.label ?? g.kind}
                          {g.clientName ? ` · ${g.clientName}` : ""} · {g.userName ?? "—"} ·{" "}
                          {formatDateTime(g.createdAt)}
                        </span>
                      </button>
                      {g.userId === ws.userId || canConfigure ? (
                        <div className="flex gap-0.5 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100">
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-label={g.pinnedAt ? "Desafixar" : "Fixar"}
                            onClick={() => pin.run({ id: g.id })}
                          >
                            {g.pinnedAt ? <PinOff /> : <Pin />}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-label="Excluir"
                            onClick={() => remove.run({ id: g.id })}
                          >
                            <Trash2 />
                          </Button>
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
