"use client";

import {
  AlertTriangle,
  Check,
  Copy,
  ImageIcon,
  Pin,
  PinOff,
  RotateCcw,
  ShieldAlert,
  Sparkles,
  Square,
  Trash2,
  Wand2,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AiModelPicker } from "@/components/ai/ai-model-picker";
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
import type { AiPreference, AiSelection, PickerProvider } from "@/lib/ai-select";
import { operationTask } from "@/lib/ai-tasks";
import { formatDateTime, formatNumber } from "@/lib/format";
import { taskAiOperationLabel } from "@/lib/task-ai";
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
type Alternative = { provider: string; providerLabel: string; model: string; label: string };
type Usage = { inputTokens: number | null; outputTokens: number | null; costMicros: number | null; durationMs: number };
type Meta = {
  demo: boolean;
  providerLabel: string;
  modelLabel: string;
  reason: string;
  warnings: string[];
  contextUsed: boolean;
};
type Failure = { message: string; alternatives: Alternative[]; retryable: boolean; partial: boolean };
type ImageResult = { files: { fileId: string; versionId: string }[]; images: string[] };

/** Operação de imagem (fora do catálogo de texto: usa modelos de geração de imagem). */
const IMAGE_OP = "image";
const IMAGE_SIZES: [string, string][] = [
  ["1024x1024", "Quadrada (1024×1024)"],
  ["1024x1536", "Retrato (1024×1536)"],
  ["1536x1024", "Paisagem (1536×1024)"],
  ["auto", "Automático"],
];

const usd = (micros: number) => `US$ ${(micros / 1_000_000).toFixed(micros < 10_000_000 ? 4 : 2)}`;

export function AiStudio({
  status,
  picker,
  clients,
  projects,
  history,
  canConfigure,
  canCreateTasks,
  canSaveFiles,
}: {
  status: {
    enabled: boolean;
    configured: boolean;
    demo: boolean;
    allowClientContext: boolean;
    monthTokens: number;
    monthlyTokenLimit: number;
    myRequestsToday: number;
    userDailyRequestLimit: number;
  };
  picker: { providers: PickerProvider[]; preferences: AiPreference[] };
  clients: { id: string; name: string }[];
  projects: { id: string; name: string; clientName: string }[];
  history: Generation[];
  canConfigure: boolean;
  canCreateTasks: boolean;
  canSaveFiles: boolean;
}) {
  const ws = useWorkspace();
  const [opKey, setOpKey] = useState(AI_OPERATIONS[0]!.key);
  const isImage = opKey === IMAGE_OP;
  const op = isImage ? null : getOperation(opKey)!;
  const task = operationTask(opKey);
  const [values, setValues] = useState<Record<string, string>>({});
  const [clientId, setClientId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [selections, setSelections] = useState<Record<string, AiSelection>>({});
  const selection = selections[task] ?? { mode: "default" };
  const setSelection = (s: AiSelection) => setSelections((all) => ({ ...all, [task]: s }));
  const [imagePrompt, setImagePrompt] = useState("");
  const [imageSize, setImageSize] = useState("1024x1024");
  const [saveImage, setSaveImage] = useState(true);
  const [output, setOutput] = useState("");
  const [tasks, setTasks] = useState<SuggestedTask[] | null>(null);
  const [image, setImage] = useState<ImageResult | null>(null);
  const [running, setRunning] = useState(false);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [costPrompt, setCostPrompt] = useState<string | null>(null);
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
    const map = new Map<string, { key: string; label: string }[]>();
    for (const o of AI_OPERATIONS) map.set(o.group, [...(map.get(o.group) ?? []), o]);
    map.set("Imagens", [{ key: IMAGE_OP, label: "Gerar imagem" }]);
    return [...map.entries()];
  }, []);

  function reset() {
    setErrors({});
    setOutput("");
    setTasks(null);
    setImage(null);
    setMeta(null);
    setUsage(null);
    setFailure(null);
    setCostPrompt(null);
  }

  /** Erros antes da geração (escolha de modelo, custo, limites, validação). */
  async function handleRejected(res: Response) {
    const err = (await res.json().catch(() => ({}))) as {
      error?: string;
      code?: string;
      fieldErrors?: Record<string, string[]>;
      alternatives?: Alternative[];
      retryable?: boolean;
    };
    const message = err.error ?? "Não foi possível gerar.";
    if (err.code === "cost_confirmation") {
      setCostPrompt(message);
      return;
    }
    if (err.fieldErrors && Object.keys(err.fieldErrors).length) {
      setErrors(err.fieldErrors);
      toast.error(message);
      return;
    }
    setFailure({
      message,
      alternatives: err.alternatives ?? [],
      retryable: err.code === "provider_error" ? !!err.retryable : res.status >= 500,
      partial: false,
    });
  }

  async function generateText(sel: AiSelection, confirmCost: boolean) {
    if (!op) return;
    const controller = new AbortController();
    abortRef.current = controller;
    let received = "";
    let finished = false;
    try {
      const res = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          orgSlug: ws.orgSlug,
          operation: op.key,
          module: "assistant",
          input: values,
          clientId: op.needsProject ? null : clientId || null,
          projectId: op.needsProject ? projectId || null : null,
          selection: sel,
          confirmCost,
        }),
      });
      if (!res.ok || !res.body) return handleRejected(res);
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
            | ({ t: "meta" } & Meta)
            | { t: "chunk"; v: string }
            | {
                t: "done";
                data?: { tasks?: Omit<SuggestedTask, "selected">[] } | null;
                usage: Usage;
                notice: string | null;
              }
            | { t: "error"; message: string; retryable: boolean };
          if (msg.t === "meta") setMeta(msg);
          else if (msg.t === "chunk") {
            received += msg.v;
            setOutput((o) => o + msg.v);
          } else if (msg.t === "error") {
            finished = true;
            setFailure({ message: msg.message, alternatives: [], retryable: msg.retryable, partial: !!received });
          } else if (msg.t === "done") {
            finished = true;
            setUsage(msg.usage);
            const notice = msg.notice;
            if (notice) setMeta((m) => (m ? { ...m, warnings: [...m.warnings, notice] } : m));
            if (op.structured) {
              const list = msg.data?.tasks;
              if (list?.length) setTasks(list.map((t) => ({ ...t, selected: true })));
              else
                setFailure({
                  message: "A resposta não trouxe sugestões de tarefas. Tente novamente.",
                  alternatives: [],
                  retryable: true,
                  partial: false,
                });
            }
          }
        }
      }
      if (!finished && !controller.signal.aborted) {
        setFailure({
          message: "A conexão terminou antes do fim da geração.",
          alternatives: [],
          retryable: true,
          partial: !!received,
        });
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setFailure({
          message: "Falha de conexão durante a geração.",
          alternatives: [],
          retryable: true,
          partial: !!received,
        });
      } else if (received) {
        setFailure({ message: "Geração interrompida.", alternatives: [], retryable: true, partial: true });
      }
    }
  }

  async function generateImage(sel: AiSelection, confirmCost: boolean) {
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch("/api/ai/image", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          orgSlug: ws.orgSlug,
          prompt: imagePrompt,
          size: imageSize,
          module: "assistant",
          clientId: clientId || null,
          saveToFiles: saveImage,
          selection: sel,
          confirmCost,
        }),
      });
      if (!res.ok) return handleRejected(res);
      const data = (await res.json()) as {
        providerLabel: string;
        model: string;
        reason: string;
        warnings: string[];
        files: ImageResult["files"];
        images: string[];
        usage: Usage;
      };
      setMeta({
        demo: false,
        providerLabel: data.providerLabel,
        modelLabel: data.model,
        reason: data.reason,
        warnings: data.warnings,
        contextUsed: false,
      });
      setImage({ files: data.files, images: data.images });
      setUsage(data.usage);
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setFailure({
          message: "Falha de conexão durante a geração.",
          alternatives: [],
          retryable: true,
          partial: false,
        });
      }
    }
  }

  async function run(opts: { selection?: AiSelection; confirmCost?: boolean } = {}) {
    const sel = opts.selection ?? selection;
    if (opts.selection) setSelection(opts.selection);
    reset();
    setRunning(true);
    try {
      if (isImage) await generateImage(sel, !!opts.confirmCost);
      else await generateText(sel, !!opts.confirmCost);
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }

  const missing = isImage
    ? imagePrompt.trim().length < 3
    : op!.fields.some((f) => f.required && !values[f.key]?.trim()) || (op!.needsProject && !projectId);
  const usagePct = status.monthlyTokenLimit ? Math.min(1, status.monthTokens / status.monthlyTokenLimit) : 0;
  const hasResult = !!(output || tasks || image || running);

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-sm shadow-xs">
        {!status.configured ? (
          <Badge tone="warning">
            <ShieldAlert /> IA não configurada
          </Badge>
        ) : status.demo ? (
          <Badge tone="warning">
            <ShieldAlert /> Somente demonstração local (sem IA real)
          </Badge>
        ) : (
          <Badge tone="accent">
            <Sparkles /> {picker.providers.filter((p) => p.ready).length} provedor(es) de IA pronto(s)
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
                        setFailure(null);
                        setCostPrompt(null);
                      }}
                      className={cn(
                        "flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                        o.key === opKey
                          ? "bg-accent-soft font-medium text-fg"
                          : "text-fg-muted hover:bg-surface-2 hover:text-fg",
                      )}
                    >
                      {o.key === IMAGE_OP ? <ImageIcon className="size-3.5" /> : null}
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
                <CardTitle>{op ? op.label : "Gerar imagem"}</CardTitle>
                <p className="mt-0.5 text-xs text-fg-muted">
                  {op
                    ? op.description
                    : "Cria uma imagem a partir da sua descrição com um modelo de geração de imagens."}
                </p>
              </div>
            </CardHeader>
            <CardContent>
              <form
                className="grid gap-4 sm:grid-cols-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!running && !missing) run();
                }}
              >
                {op?.needsProject ? (
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
                      isImage
                        ? "A imagem fica vinculada ao cliente em Arquivos. Só a sua descrição é enviada ao provedor."
                        : clientId && !status.allowClientContext && !status.demo
                          ? "A organização não autorizou enviar dados do cliente: só o seu texto será usado."
                          : "Usa tom de voz, público e identidade cadastrados na marca."
                    }
                    className="sm:col-span-2"
                  >
                    <NativeSelect id="ai-client" value={clientId} onChange={(e) => setClientId(e.target.value)}>
                      <option value="">{isImage ? "Nenhum" : "Nenhum (texto genérico)"}</option>
                      {clients.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                )}
                {isImage ? (
                  <>
                    <Field
                      label="Descrição da imagem"
                      htmlFor="ai-image-prompt"
                      required
                      error={errors.prompt}
                      className="sm:col-span-2"
                    >
                      <Textarea
                        id="ai-image-prompt"
                        rows={4}
                        value={imagePrompt}
                        placeholder="Ex.: foto de produto de um panetone artesanal sobre mesa de madeira, luz natural"
                        onChange={(e) => setImagePrompt(e.target.value)}
                      />
                    </Field>
                    <Field label="Formato" htmlFor="ai-image-size">
                      <NativeSelect id="ai-image-size" value={imageSize} onChange={(e) => setImageSize(e.target.value)}>
                        {IMAGE_SIZES.map(([v, label]) => (
                          <option key={v} value={v}>
                            {label}
                          </option>
                        ))}
                      </NativeSelect>
                    </Field>
                    <label className="flex items-center gap-2 self-end pb-2 text-sm">
                      <Checkbox
                        checked={saveImage && canSaveFiles}
                        disabled={!canSaveFiles}
                        onCheckedChange={(v) => setSaveImage(v === true)}
                      />
                      {canSaveFiles ? "Salvar em Arquivos" : "Sem permissão para salvar em Arquivos"}
                    </label>
                  </>
                ) : (
                  op!.fields.map((f) => {
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
                  })
                )}

                <AiModelPicker
                  className="sm:col-span-2"
                  providers={picker.providers}
                  preferences={picker.preferences}
                  task={task}
                  module="assistant"
                  value={selection}
                  onChange={setSelection}
                  disabled={running}
                />

                {costPrompt ? (
                  <div
                    role="alert"
                    className="grid gap-2 rounded-lg border border-warning/40 bg-warning-soft/40 p-3 text-sm sm:col-span-2"
                  >
                    <p className="flex items-start gap-2">
                      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" /> {costPrompt}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" variant="primary" size="sm" onClick={() => run({ confirmCost: true })}>
                        Confirmar e gerar
                      </Button>
                      <Button type="button" variant="ghost" size="sm" onClick={() => setCostPrompt(null)}>
                        Cancelar
                      </Button>
                    </div>
                  </div>
                ) : null}

                <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
                  <Button
                    type="submit"
                    variant="accent"
                    disabled={missing || running || !status.enabled}
                    loading={running}
                  >
                    {isImage ? <ImageIcon /> : <Wand2 />} {running ? "Gerando…" : isImage ? "Gerar imagem" : "Gerar"}
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

          {failure ? (
            <div role="alert" className="grid gap-3 rounded-xl border border-danger/40 bg-danger-soft/40 p-4 text-sm">
              <p className="flex items-start gap-2 font-medium">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" />
                <span>
                  {failure.partial ? "A geração não foi concluída: " : "Não foi possível gerar: "}
                  {failure.message}
                </span>
              </p>
              <p className="text-xs text-fg-muted">
                Nada foi salvo no histórico. O que você digitou continua no formulário.
                {failure.partial ? " O texto parcial abaixo está incompleto." : ""}
              </p>
              {failure.alternatives.length ? (
                <div className="grid gap-1.5">
                  <p className="text-xs font-medium">Modelos compatíveis disponíveis — escolha um para tentar:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {failure.alternatives.map((a) => (
                      <Button
                        key={`${a.provider}:${a.model}`}
                        type="button"
                        size="xs"
                        variant="secondary"
                        disabled={running}
                        onClick={() => run({ selection: { mode: "manual", provider: a.provider, model: a.model } })}
                      >
                        Usar {a.label} ({a.providerLabel})
                      </Button>
                    ))}
                  </div>
                </div>
              ) : null}
              <div className="flex flex-wrap gap-2">
                {failure.retryable ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={running || missing}
                    onClick={() => run()}
                  >
                    <RotateCcw /> Tentar novamente
                  </Button>
                ) : null}
                {!failure.alternatives.length && selection.mode !== "manual" ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setSelection({ mode: "manual" });
                      setFailure(null);
                    }}
                  >
                    Escolher outro modelo
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}

          {hasResult ? (
            <Card>
              <CardHeader>
                <div className="min-w-0">
                  <CardTitle>{failure?.partial ? "Resultado incompleto (não salvo)" : "Resultado"}</CardTitle>
                  {meta ? (
                    <div className="mt-0.5 grid gap-0.5 text-xs text-fg-muted">
                      <p>
                        {meta.demo ? (
                          <Badge tone="warning" className="mr-1">
                            Exemplo local — não é IA real
                          </Badge>
                        ) : null}
                        {meta.modelLabel} · {meta.providerLabel}
                        {meta.contextUsed ? " · com contexto da marca" : ""}
                      </p>
                      <p className="text-fg-subtle">{meta.reason}</p>
                      {meta.warnings.map((w) => (
                        <p key={w} className="text-warning">
                          {w}
                        </p>
                      ))}
                    </div>
                  ) : null}
                </div>
                {output && !failure?.partial ? (
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
              <CardContent className="grid gap-4">
                {image ? (
                  <div className="grid gap-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      {image.files.map((f) => (
                        <Link
                          key={f.versionId}
                          href={`/w/${ws.orgSlug}/files/${f.fileId}`}
                          className="overflow-hidden rounded-lg border border-border"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={`/api/files/${f.versionId}`} alt="Imagem gerada" className="h-auto w-full" />
                        </Link>
                      ))}
                      {image.images.map((src, i) => (
                        <a
                          key={i}
                          href={src}
                          download={`imagem-ia-${i + 1}.png`}
                          className="overflow-hidden rounded-lg border border-border"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={src} alt="Imagem gerada" className="h-auto w-full" />
                        </a>
                      ))}
                    </div>
                    <p className="text-xs text-fg-muted">
                      {image.files.length
                        ? "Imagem salva em Arquivos (rascunho). Clique para abrir."
                        : "Imagem não salva em Arquivos. Clique para baixar."}
                    </p>
                  </div>
                ) : tasks ? (
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
                  <div className={cn(failure?.partial && "opacity-70")}>
                    <Markdown text={output} />
                  </div>
                ) : running ? (
                  <p className="animate-pulse text-sm text-fg-muted">Gerando…</p>
                ) : null}
                {usage ? (
                  <p className="tabular text-xs text-fg-subtle">
                    {usage.inputTokens !== null || usage.outputTokens !== null
                      ? `${formatNumber((usage.inputTokens ?? 0) + (usage.outputTokens ?? 0))} tokens · `
                      : "tokens não informados · "}
                    {(usage.durationMs / 1000).toFixed(1)} s ·{" "}
                    {meta?.demo
                      ? "sem custo (demonstração local)"
                      : usage.costMicros !== null
                        ? `custo estimado ${usd(usage.costMicros)}`
                        : "custo não informado"}
                  </p>
                ) : null}
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
                          reset();
                          setOutput(g.output);
                          window.scrollTo({ top: 0, behavior: "smooth" });
                        }}
                      >
                        <span className="flex items-center gap-2">
                          {g.pinnedAt ? <Pin className="size-3 text-accent-text" /> : null}
                          <span className="truncate text-sm font-medium">{g.title}</span>
                        </span>
                        <span className="block truncate text-xs text-fg-muted">
                          {g.kind === IMAGE_OP
                            ? "Imagem"
                            : (getOperation(g.kind)?.label ?? taskAiOperationLabel(g.kind) ?? g.kind)}
                          {g.clientName ? ` · ${g.clientName}` : ""} · {g.model} · {g.userName ?? "—"} ·{" "}
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
