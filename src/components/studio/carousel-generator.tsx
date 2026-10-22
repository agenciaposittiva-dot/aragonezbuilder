"use client";

import { AlertTriangle, Check, Circle, ImageIcon, Loader2, Sparkles, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { AiModelPicker } from "@/components/ai/ai-model-picker";
import { useWorkspace } from "@/components/shell/workspace-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import type { AiPreference, AiSelection, PickerProvider } from "@/lib/ai-select";
import { cn } from "@/lib/utils";
import { designImagesAction } from "@/server/actions/designs";

const STEPS = [
  { key: "plan", label: "Planejando conteúdo" },
  { key: "script", label: "Criando roteiro" },
  { key: "visuals", label: "Preparando recursos visuais" },
  { key: "assemble", label: "Montando slides" },
  { key: "save", label: "Salvando projeto" },
] as const;
type StepKey = (typeof STEPS)[number]["key"];
type StepState = { status: "pending" | "running" | "done" | "skipped"; detail?: string };

type Meta = {
  demo: boolean;
  providerLabel: string;
  modelLabel: string;
  reason: string;
  imageProvider: string | null;
  imageModel: string | null;
  warnings: string[];
};

type ImageOption = { fileId: string; versionId: string; name: string; hasThumbnail: boolean };

const emptySteps = (): Record<StepKey, StepState> =>
  Object.fromEntries(STEPS.map((s) => [s.key, { status: "pending" }])) as Record<StepKey, StepState>;

/**
 * Gerador de carrosséis: modo rápido (assunto + cliente) e completo (objetivo,
 * público, quantidade, tom, formato, identidade, referências e imagens). O
 * progresso vem do servidor, etapa por etapa; no fim abre o editor real.
 */
export function CarouselGenerator({
  clients,
  projects,
  picker,
  defaultClientId,
  canSaveFiles,
  task,
}: {
  clients: { id: string; name: string }[];
  projects: { id: string; name: string; clientId: string }[];
  picker: { providers: PickerProvider[]; preferences: AiPreference[] };
  defaultClientId?: string;
  canSaveFiles: boolean;
  /** Gerado a partir de uma demanda: cliente e projeto fixos, e a arte nasce vinculada à tarefa. */
  task?: { id: string; title: string; projectId: string; clientId: string };
}) {
  const router = useRouter();
  const { orgSlug } = useWorkspace();
  const [mode, setMode] = useState<"quick" | "full">("quick");
  const [topic, setTopic] = useState("");
  const [clientId, setClientId] = useState(task?.clientId ?? defaultClientId ?? "");
  const [projectId, setProjectId] = useState(task?.projectId ?? "");
  const [objective, setObjective] = useState("");
  const [audience, setAudience] = useState("");
  const [slides, setSlides] = useState("auto");
  const [tone, setTone] = useState("");
  const [format, setFormat] = useState<"portrait" | "square">("portrait");
  const [useIdentity, setUseIdentity] = useState(true);
  const [references, setReferences] = useState("");
  const [images, setImages] = useState<"auto" | "none">("auto");
  const [fileIds, setFileIds] = useState<string[]>([]);
  const [library, setLibrary] = useState<ImageOption[] | null>(null);
  const [selection, setSelection] = useState<AiSelection>({ mode: "default" });
  const [imageSelection, setImageSelection] = useState<AiSelection>({ mode: "default" });
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<Record<StepKey, StepState> | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [error, setError] = useState<{ message: string; retryable: boolean } | null>(null);
  const [costPrompt, setCostPrompt] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const abortRef = useRef<AbortController | null>(null);

  const ready = picker.providers.filter((p) => p.ready);
  const hasImageModel = ready.some((p) => p.models.some((m) => m.caps.imageOutput === "yes" || m.kind === "image"));

  async function loadLibrary(forClient = clientId) {
    const res = await designImagesAction(orgSlug, { clientId: forClient || null, page: 1 });
    if (res.ok)
      setLibrary(
        res.data.rows
          .slice(0, 24)
          .map((r) => ({ fileId: r.fileId, versionId: r.versionId, name: r.name, hasThumbnail: r.hasThumbnail })),
      );
    else toast.error(res.error);
  }

  async function generate(confirmCost = false) {
    setError(null);
    setCostPrompt(null);
    setFieldErrors({});
    setMeta(null);
    setSteps(emptySteps());
    setRunning(true);
    const controller = new AbortController();
    abortRef.current = controller;
    let finished = false;
    try {
      const full = mode === "full";
      const res = await fetch("/api/studio/generate-carousel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          orgSlug,
          mode,
          topic,
          clientId: clientId || null,
          projectId: task ? task.projectId : full && projectId ? projectId : null,
          taskId: task?.id ?? null,
          objective: full ? objective || undefined : undefined,
          audience: full ? audience || undefined : undefined,
          tone: full ? tone || undefined : undefined,
          references: full ? references || undefined : undefined,
          slides: full && slides !== "auto" ? Number(slides) : null,
          format: full ? format : "portrait",
          useIdentity: full ? useIdentity : true,
          fileIds: full ? fileIds : [],
          images: full ? images : "auto",
          selection,
          imageSelection,
          confirmCost,
        }),
      });
      if (!res.ok || !res.body) {
        const err = (await res.json().catch(() => ({}))) as {
          error?: string;
          code?: string;
          fieldErrors?: Record<string, string[]>;
        };
        setSteps(null);
        if (err.code === "cost_confirmation") setCostPrompt(err.error ?? "Confirme o custo para continuar.");
        else {
          if (err.fieldErrors) setFieldErrors(err.fieldErrors);
          setError({ message: err.error ?? "Não foi possível gerar o carrossel.", retryable: res.status >= 500 });
        }
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
            | ({ t: "meta" } & Meta)
            | { t: "step"; step: StepKey; status: StepState["status"]; detail?: string }
            | { t: "done"; designId: string; warnings: string[]; claims: unknown[]; notice: string | null }
            | { t: "error"; message: string; retryable: boolean };
          if (msg.t === "meta") setMeta(msg);
          else if (msg.t === "step")
            setSteps((s) => ({ ...(s ?? emptySteps()), [msg.step]: { status: msg.status, detail: msg.detail } }));
          else if (msg.t === "error") {
            finished = true;
            setError({ message: msg.message, retryable: msg.retryable });
          } else if (msg.t === "done") {
            finished = true;
            if (msg.notice) toast.warning(msg.notice);
            const designId = msg.designId;
            toast.success(
              msg.claims.length
                ? `Carrossel salvo. ${msg.claims.length} dado(s) a confirmar antes de publicar.`
                : "Carrossel salvo. Abrindo o editor…",
              {
                duration: 10_000,
                action: {
                  label: "Visualizar publicação",
                  onClick: () => router.push(`/w/${orgSlug}/studio/${designId}/preview`),
                },
              },
            );
            router.push(`/w/${orgSlug}/studio/${msg.designId}?gerado=1`);
          }
        }
      }
      if (!finished && !controller.signal.aborted)
        setError({
          message: "A conexão terminou antes do fim. Nada foi marcado como salvo; tente de novo.",
          retryable: true,
        });
    } catch (err) {
      if (!controller.signal.aborted)
        setError({ message: (err as Error).message || "Falha de conexão.", retryable: true });
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }

  const visibleProjects = projects.filter((p) => !clientId || p.clientId === clientId);
  const busy = running;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <form
        className="grid content-start gap-5 rounded-xl border border-border bg-surface p-4 sm:p-6"
        onSubmit={(e) => {
          e.preventDefault();
          void generate();
        }}
        aria-busy={busy}
      >
        <div
          role="radiogroup"
          aria-label="Modo"
          className="inline-flex w-fit rounded-lg border border-border p-0.5 text-sm"
        >
          {(
            [
              ["quick", "Rápido"],
              ["full", "Completo"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={mode === k}
              onClick={() => setMode(k)}
              className={cn(
                "rounded-md px-3 py-1.5 font-medium",
                mode === k ? "bg-accent text-accent-fg" : "text-fg-muted hover:text-fg",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <Field
          label="Assunto do carrossel"
          htmlFor="cg-topic"
          required
          error={fieldErrors.topic}
          hint="Ex.: 5 erros que encarecem a conta de luz"
        >
          <Textarea
            id="cg-topic"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            rows={2}
            maxLength={300}
            required
            disabled={busy}
          />
        </Field>
        {task ? (
          <p
            className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-fg-muted"
            data-testid="carousel-task"
          >
            Para a demanda <span className="font-medium text-fg">“{task.title}”</span>: o carrossel fica vinculado a ela
            e ao projeto.
          </p>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Cliente"
            htmlFor="cg-client"
            hint="A identidade visual e o perfil da marca do cliente são usados."
          >
            <NativeSelect
              id="cg-client"
              value={clientId}
              disabled={busy || !!task}
              onChange={(e) => {
                setClientId(e.target.value);
                setProjectId("");
                setFileIds([]);
                if (library) void loadLibrary(e.target.value);
              }}
            >
              <option value="">Sem cliente (direção visual sugerida)</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          {mode === "full" ? (
            <Field label="Projeto" htmlFor="cg-project">
              <NativeSelect
                id="cg-project"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                disabled={busy || !!task}
              >
                <option value="">Nenhum</option>
                {visibleProjects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          ) : null}
        </div>

        {mode === "full" ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Objetivo" htmlFor="cg-objective" hint="Educar, engajar, gerar leads, vender…">
                <Input
                  id="cg-objective"
                  value={objective}
                  onChange={(e) => setObjective(e.target.value)}
                  maxLength={500}
                  disabled={busy}
                />
              </Field>
              <Field label="Público" htmlFor="cg-audience">
                <Input
                  id="cg-audience"
                  value={audience}
                  onChange={(e) => setAudience(e.target.value)}
                  maxLength={500}
                  disabled={busy}
                />
              </Field>
              <Field label="Quantidade de slides" htmlFor="cg-slides">
                <NativeSelect id="cg-slides" value={slides} onChange={(e) => setSlides(e.target.value)} disabled={busy}>
                  <option value="auto">Automático (a IA decide)</option>
                  {[3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                    <option key={n} value={n}>
                      {n} slides
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Tom" htmlFor="cg-tone">
                <Input
                  id="cg-tone"
                  value={tone}
                  onChange={(e) => setTone(e.target.value)}
                  placeholder="Ex.: próximo e bem-humorado"
                  maxLength={160}
                  disabled={busy}
                />
              </Field>
              <Field label="Formato" htmlFor="cg-format">
                <NativeSelect
                  id="cg-format"
                  value={format}
                  onChange={(e) => setFormat(e.target.value as "portrait" | "square")}
                  disabled={busy}
                >
                  <option value="portrait">Retrato 1080 × 1350 (recomendado)</option>
                  <option value="square">Quadrado 1080 × 1080</option>
                </NativeSelect>
              </Field>
              <Field
                label="Imagens"
                htmlFor="cg-images"
                hint={hasImageModel ? undefined : "Nenhum modelo de imagem configurado: só elementos vetoriais."}
              >
                <NativeSelect
                  id="cg-images"
                  value={images}
                  onChange={(e) => setImages(e.target.value as "auto" | "none")}
                  disabled={busy}
                >
                  <option value="auto">Usar imagens (Arquivos e IA, quando houver)</option>
                  <option value="none">Somente formas, ícones e tipografia</option>
                </NativeSelect>
              </Field>
            </div>
            <label className="flex items-start gap-2 text-sm">
              <Checkbox
                checked={useIdentity}
                onCheckedChange={(v) => setUseIdentity(v === true)}
                disabled={busy || !clientId}
                aria-label="Usar identidade visual do cliente"
              />
              <span>
                Usar a identidade visual do cliente (cores, fontes e logo do perfil da marca)
                {!clientId ? (
                  <span className="block text-xs text-fg-muted">Escolha um cliente para usar a identidade dele.</span>
                ) : null}
              </span>
            </label>
            <Field
              label="Referências e dados"
              htmlFor="cg-refs"
              hint="Números e dados só entram no carrossel se estiverem aqui (com a fonte, de preferência)."
            >
              <Textarea
                id="cg-refs"
                value={references}
                onChange={(e) => setReferences(e.target.value)}
                rows={4}
                maxLength={2000}
                disabled={busy}
              />
            </Field>
            {images === "auto" ? (
              <div className="grid gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium">
                    Imagens dos Arquivos {fileIds.length ? `(${fileIds.length})` : "(opcional)"}
                  </span>
                  <Button type="button" size="sm" variant="ghost" onClick={() => void loadLibrary()} disabled={busy}>
                    <ImageIcon /> {library ? "Atualizar" : "Escolher imagens"}
                  </Button>
                </div>
                {library ? (
                  library.length ? (
                    <ul className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                      {library.map((img) => {
                        const on = fileIds.includes(img.fileId);
                        return (
                          <li key={img.fileId}>
                            <button
                              type="button"
                              aria-pressed={on}
                              title={img.name}
                              onClick={() =>
                                setFileIds((ids) =>
                                  on
                                    ? ids.filter((x) => x !== img.fileId)
                                    : ids.length < 6
                                      ? [...ids, img.fileId]
                                      : ids,
                                )
                              }
                              className={cn(
                                "relative block aspect-square w-full overflow-hidden rounded-md border-2",
                                on ? "border-accent" : "border-transparent",
                              )}
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={`/api/files/${img.versionId}${img.hasThumbnail ? "?thumb=1" : ""}`}
                                alt={img.name}
                                className="h-full w-full object-cover"
                              />
                              {on ? (
                                <Check className="absolute top-1 right-1 size-4 rounded-full bg-accent p-0.5 text-accent-fg" />
                              ) : null}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="text-xs text-fg-muted">
                      Nenhuma imagem em Arquivos{clientId ? " deste cliente" : ""}.
                    </p>
                  )
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <span className="text-sm font-medium">IA do roteiro</span>
            <AiModelPicker
              providers={picker.providers}
              preferences={picker.preferences}
              task="planning"
              module="carousel"
              value={selection}
              onChange={setSelection}
              disabled={busy}
            />
          </div>
          {(mode === "quick" || images === "auto") && canSaveFiles ? (
            <div className="grid gap-1.5">
              <span className="text-sm font-medium">IA das imagens</span>
              <AiModelPicker
                providers={picker.providers}
                preferences={picker.preferences}
                task="image_generation"
                module="carousel"
                value={imageSelection}
                onChange={setImageSelection}
                disabled={busy}
              />
            </div>
          ) : null}
        </div>

        {costPrompt ? (
          <div
            role="alert"
            className="flex flex-col gap-2 rounded-lg border border-transparent bg-warning-soft p-3 text-sm sm:flex-row sm:items-center sm:justify-between"
          >
            <span>{costPrompt}</span>
            <Button type="button" size="sm" variant="primary" onClick={() => void generate(true)}>
              Confirmar e gerar
            </Button>
          </div>
        ) : null}
        {error ? (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-transparent bg-danger-soft p-3 text-sm text-danger"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span className="flex-1">{error.message}</span>
            {error.retryable ? (
              <Button type="button" size="sm" variant="ghost" onClick={() => void generate()}>
                Tentar de novo
              </Button>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" variant="primary" disabled={busy || topic.trim().length < 3}>
            {busy ? <Loader2 className="animate-spin" /> : <Sparkles />} Gerar carrossel
          </Button>
          {busy ? (
            <Button type="button" variant="ghost" onClick={() => abortRef.current?.abort()}>
              <X /> Cancelar
            </Button>
          ) : null}
        </div>
      </form>

      <aside className="grid content-start gap-4">
        <section
          className="rounded-xl border border-border bg-surface p-4"
          aria-live="polite"
          data-testid="carousel-progress"
        >
          <h2 className="mb-3 text-sm font-semibold">Progresso</h2>
          {steps ? (
            <ol className="grid gap-2.5">
              {STEPS.map((s) => {
                const st = steps[s.key];
                return (
                  <li key={s.key} data-step={s.key} data-status={st.status} className="flex items-start gap-2 text-sm">
                    {st.status === "done" ? (
                      <Check className="mt-0.5 size-4 shrink-0 text-success" />
                    ) : st.status === "running" ? (
                      <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-accent-text" />
                    ) : (
                      <Circle className="mt-0.5 size-4 shrink-0 text-fg-subtle" />
                    )}
                    <span className="min-w-0">
                      <span className={cn(st.status === "pending" && "text-fg-muted")}>{s.label}</span>
                      {st.detail ? <span className="block text-xs text-fg-muted">{st.detail}</span> : null}
                    </span>
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="text-sm text-fg-muted">
              A IA planeja o conteúdo, escreve o roteiro, prepara os visuais e monta os slides no editor. Você revisa
              tudo antes de publicar.
            </p>
          )}
        </section>
        {meta ? (
          <section className="grid gap-2 rounded-xl border border-border bg-surface p-4 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{meta.providerLabel}</span>
              <span className="text-fg-muted">{meta.modelLabel}</span>
              {meta.demo ? <Badge tone="warning">Demonstração</Badge> : null}
            </div>
            <p className="text-xs text-fg-muted">{meta.reason}</p>
            <p className="text-xs text-fg-muted">
              Imagens:{" "}
              {meta.imageProvider ? `${meta.imageProvider} · ${meta.imageModel}` : "sem modelo de imagem (só vetores)"}
            </p>
            {meta.warnings.length ? (
              <ul className="grid gap-1 text-xs text-warning">
                {meta.warnings.map((w) => (
                  <li key={w} className="flex gap-1.5">
                    <AlertTriangle className="mt-0.5 size-3 shrink-0" /> {w}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ) : null}
      </aside>
    </div>
  );
}
