"use client";

import { AlertTriangle, CheckCircle2, ImagePlus, Plus, Sparkles, Trash2, Wand2 } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { AiModelPicker } from "@/components/ai/ai-model-picker";
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
import { Field } from "@/components/ui/field";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { useOrgAction } from "@/hooks/use-action";
import type { AiSelection } from "@/lib/ai-select";
import { CONTENT_FORMATS, type ContentFormat } from "@/lib/content";
import { contentImageAction, contentPackAction, createFromTrendAction } from "@/server/actions/trends";
import type { AiPickerData } from "@/server/services/ai-models";

type Texts = {
  title: string;
  concept: string;
  strategy: string;
  copy: string;
  caption: string;
  cta: string;
  script: string;
  visualDirection: string;
  imagePrompt: string;
  hashtags: string;
  slides: { title: string; text: string }[];
};

const EMPTY: Texts = {
  title: "",
  concept: "",
  strategy: "",
  copy: "",
  caption: "",
  cta: "",
  script: "",
  visualDirection: "",
  imagePrompt: "",
  hashtags: "",
  slides: [],
};

const FORMAT_OPTIONS: ContentFormat[] = ["feed", "stories", "carousel", "reels"];
const needsConfirm = (r: { ok: boolean; code?: string; error?: string }) =>
  !r.ok && r.code === "conflict" && /Confirme para continuar/.test(r.error ?? "");

type Option = { id: string; name: string; clientId: string };

export function CreateContentDialog({
  base,
  trendId,
  trendTitle,
  clients,
  campaigns,
  projects,
  picker,
  can,
  defaultOpen,
  defaultClientId,
}: {
  /** /w/<org> */
  base: string;
  trendId: string;
  trendTitle: string;
  clients: { id: string; name: string }[];
  campaigns: Option[];
  projects: Option[];
  picker: AiPickerData;
  can: { designs: boolean; requests: boolean; tasks: boolean; projects: boolean; files: boolean };
  defaultOpen?: boolean;
  defaultClientId?: string;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  const [step, setStep] = useState<"setup" | "review" | "done">("setup");
  const [clientId, setClientId] = useState(
    defaultClientId && clients.some((c) => c.id === defaultClientId) ? defaultClientId : "",
  );
  const [formats, setFormats] = useState<ContentFormat[]>(["feed"]);
  const [objective, setObjective] = useState("");
  const [notes, setNotes] = useState("");
  const [selection, setSelection] = useState<AiSelection>({ mode: "default" });
  const [texts, setTexts] = useState<Texts>(EMPTY);
  const [meta, setMeta] = useState<{ analysisId: string | null; demo: boolean; guardrails: string[]; fromAi: boolean }>(
    {
      analysisId: null,
      demo: false,
      guardrails: [],
      fromAi: false,
    },
  );
  const [costPrompt, setCostPrompt] = useState<{ kind: "pack" | "image"; message: string } | null>(null);
  const [image, setImage] = useState<{ fileId: string; versionId: string } | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [campaignMode, setCampaignMode] = useState<"none" | "existing" | "new">("none");
  const [campaignId, setCampaignId] = useState("");
  const [campaignName, setCampaignName] = useState("");
  const [projectMode, setProjectMode] = useState<"none" | "existing" | "new">("none");
  const [projectId, setProjectId] = useState("");
  const [projectName, setProjectName] = useState("");
  const [plannedDate, setPlannedDate] = useState("");
  const [createDesigns, setCreateDesigns] = useState(can.designs);
  const [createRequest, setCreateRequest] = useState(false);
  const [createTask, setCreateTask] = useState(false);
  const [taskDueDate, setTaskDueDate] = useState("");
  const [done, setDone] = useState<{
    items: { id: string; format: ContentFormat; designs: string[] }[];
    taskId: string | null;
    requestId: string | null;
    projectId: string | null;
  } | null>(null);

  const pack = useOrgAction(contentPackAction);
  const img = useOrgAction(contentImageAction);
  const create = useOrgAction(createFromTrendAction, {
    success: "Conteúdo criado",
    onSuccess: (r) => {
      setDone(r);
      setStep("done");
    },
  });

  const clientCampaigns = useMemo(() => campaigns.filter((c) => c.clientId === clientId), [campaigns, clientId]);
  const clientProjects = useMemo(() => projects.filter((p) => p.clientId === clientId), [projects, clientId]);
  const set = (k: keyof Texts, v: string) => setTexts((t) => ({ ...t, [k]: v }));
  const hasCarousel = formats.includes("carousel");
  const artCount = createDesigns
    ? formats.reduce((n, f) => n + (f === "reels" ? 0 : f === "carousel" ? Math.max(texts.slides.length, 1) : 1), 0)
    : 0;

  async function generate(confirmCost?: boolean) {
    setCostPrompt(null);
    const r = await pack.run({
      trendId,
      clientId,
      formats,
      objective: objective || undefined,
      notes: notes || undefined,
      selection,
      confirmCost,
    });
    if (needsConfirm(r)) {
      setCostPrompt({ kind: "pack", message: (r as { error: string }).error });
      return;
    }
    if (!r.ok) return;
    const p = r.data.pack;
    setTexts({
      title: p.title || trendTitle,
      concept: p.concept,
      strategy: p.strategy,
      copy: p.copy,
      caption: p.caption,
      cta: p.cta,
      script: p.script,
      visualDirection: p.visualDirection,
      imagePrompt: p.imagePrompt,
      hashtags: p.hashtags.join(" "),
      slides: p.slides,
    });
    setMeta({ analysisId: r.data.analysisId, demo: r.data.demo, guardrails: r.data.guardrails, fromAi: true });
    setStep("review");
  }

  function startBlank() {
    setTexts({ ...EMPTY, title: trendTitle, slides: hasCarousel ? [{ title: "", text: "" }] : [] });
    setMeta({ analysisId: null, demo: false, guardrails: [], fromAi: false });
    setStep("review");
  }

  async function generateImage(confirmCost?: boolean) {
    setCostPrompt(null);
    setImageError(null);
    const r = await img.run({
      clientId,
      prompt: texts.imagePrompt,
      orientation: "portrait",
      selection: { mode: "default" },
      confirmCost,
    });
    if (needsConfirm(r)) {
      setCostPrompt({ kind: "image", message: (r as { error: string }).error });
      return;
    }
    if (!r.ok) return;
    if (!r.data.ok) {
      // Falha real do provedor: mostramos a mensagem e seguimos sem imagem.
      setImageError(r.data.message);
      return;
    }
    setImage({ fileId: r.data.fileId, versionId: r.data.versionId });
  }

  function confirm() {
    void create.run({
      trendId,
      clientId,
      analysisId: meta.analysisId,
      campaign:
        campaignMode === "existing" && campaignId
          ? { mode: "existing", id: campaignId }
          : campaignMode === "new" && campaignName.trim()
            ? { mode: "new", name: campaignName.trim() }
            : { mode: "none" },
      project:
        projectMode === "existing" && projectId
          ? { mode: "existing", id: projectId }
          : projectMode === "new" && projectName.trim()
            ? { mode: "new", name: projectName.trim() }
            : { mode: "none" },
      formats,
      plannedDate: plannedDate || null,
      texts: {
        title: texts.title,
        concept: texts.concept,
        strategy: texts.strategy,
        copy: texts.copy,
        caption: texts.caption,
        cta: texts.cta,
        script: texts.script,
        visualDirection: texts.visualDirection,
        imagePrompt: texts.imagePrompt,
        hashtags: texts.hashtags
          .split(/[\s,]+/)
          .map((h) => h.trim())
          .filter(Boolean)
          .slice(0, 30),
        slides: hasCarousel ? texts.slides.filter((s) => s.title.trim() || s.text.trim()) : [],
      },
      image: image ? { fileId: image.fileId } : null,
      createDesigns,
      createRequest,
      createTask,
      taskDueDate: taskDueDate || null,
    });
  }

  const taskBlocked = createTask && projectMode === "none";

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v && step === "done") {
          setStep("setup");
          setDone(null);
          setImage(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="primary" size="sm">
          <Wand2 /> Criar conteúdo
        </Button>
      </DialogTrigger>
      <DialogContent size="xl" aria-describedby="create-content-desc">
        <DialogHeader>
          <DialogTitle>Criar conteúdo a partir da tendência</DialogTitle>
          <DialogDescription id="create-content-desc">
            {step === "setup"
              ? "Escolha o cliente e os formatos. A IA prepara uma prévia que você revisa antes de qualquer coisa ser criada."
              : step === "review"
                ? "Revise e ajuste tudo. Nada é criado até você confirmar."
                : "Pronto. Tudo ficou ligado à tendência, ao cliente e à campanha."}
          </DialogDescription>
        </DialogHeader>

        {step === "setup" ? (
          <>
            <DialogBody className="grid gap-4 sm:grid-cols-2">
              <Field label="Tendência" className="sm:col-span-2">
                <p className="text-sm font-medium">{trendTitle}</p>
              </Field>
              <Field label="Cliente" htmlFor="cc-client" required>
                <NativeSelect id="cc-client" value={clientId} onChange={(e) => setClientId(e.target.value)}>
                  <option value="">Escolha um cliente</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Formatos" required>
                <div className="flex flex-wrap gap-3">
                  {FORMAT_OPTIONS.map((f) => (
                    <label key={f} className="flex items-center gap-1.5 text-sm">
                      <Checkbox
                        checked={formats.includes(f)}
                        onCheckedChange={(v) =>
                          setFormats((cur) => (v ? [...new Set([...cur, f])] : cur.filter((x) => x !== f)))
                        }
                      />
                      {CONTENT_FORMATS[f].label}
                    </label>
                  ))}
                </div>
              </Field>
              <Field label="Objetivo (opcional)" htmlFor="cc-objective">
                <Input
                  id="cc-objective"
                  value={objective}
                  onChange={(e) => setObjective(e.target.value)}
                  placeholder="Ex.: engajamento, lançamento, autoridade"
                />
              </Field>
              <Field label="Observações para a IA (opcional)" htmlFor="cc-notes">
                <Input
                  id="cc-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Ex.: citar a loja do centro"
                />
              </Field>
              <AiModelPicker
                className="sm:col-span-2"
                providers={picker.providers}
                preferences={picker.preferences}
                task="copy"
                module="trends"
                value={selection}
                onChange={setSelection}
                disabled={pack.pending}
              />
              {costPrompt?.kind === "pack" ? (
                <div
                  role="alert"
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-warning/40 bg-warning-soft/40 p-3 text-sm sm:col-span-2"
                >
                  <AlertTriangle className="size-4 text-warning" /> {costPrompt.message}
                  <Button size="sm" variant="primary" onClick={() => void generate(true)} loading={pack.pending}>
                    Confirmar e gerar
                  </Button>
                </div>
              ) : null}
            </DialogBody>
            <DialogFooter>
              <Button variant="ghost" disabled={!clientId || !formats.length} onClick={startBlank}>
                Preencher sem IA
              </Button>
              <Button
                variant="primary"
                disabled={!clientId || !formats.length}
                loading={pack.pending}
                onClick={() => void generate()}
              >
                <Sparkles /> Gerar prévia com IA
              </Button>
            </DialogFooter>
          </>
        ) : null}

        {step === "review" ? (
          <>
            <DialogBody className="grid gap-4">
              {meta.fromAi ? (
                <p className="flex flex-wrap items-center gap-1.5 text-xs text-fg-muted">
                  <Sparkles className="size-3.5 text-accent-text" /> Textos sugeridos pela IA — revise antes de
                  confirmar.
                  {meta.demo ? <Badge tone="warning">Demonstração</Badge> : null}
                </p>
              ) : null}
              {meta.guardrails.length ? (
                <ul className="grid gap-0.5 rounded-lg border border-border bg-surface-2/50 p-2 text-xs text-fg-muted">
                  {meta.guardrails.map((g) => (
                    <li key={g}>• {g}</li>
                  ))}
                </ul>
              ) : null}
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Título" htmlFor="cc-title" required className="sm:col-span-2">
                  <Input id="cc-title" value={texts.title} onChange={(e) => set("title", e.target.value)} />
                </Field>
                <Field label="Conceito" htmlFor="cc-concept">
                  <Textarea
                    id="cc-concept"
                    rows={3}
                    value={texts.concept}
                    onChange={(e) => set("concept", e.target.value)}
                  />
                </Field>
                <Field label="Estratégia" htmlFor="cc-strategy">
                  <Textarea
                    id="cc-strategy"
                    rows={3}
                    value={texts.strategy}
                    onChange={(e) => set("strategy", e.target.value)}
                  />
                </Field>
                <Field label="Texto da arte (copy)" htmlFor="cc-copy">
                  <Textarea id="cc-copy" rows={2} value={texts.copy} onChange={(e) => set("copy", e.target.value)} />
                </Field>
                <Field label="Chamada (CTA)" htmlFor="cc-cta">
                  <Input id="cc-cta" value={texts.cta} onChange={(e) => set("cta", e.target.value)} />
                </Field>
                <Field label="Legenda" htmlFor="cc-caption" className="sm:col-span-2">
                  <Textarea
                    id="cc-caption"
                    rows={3}
                    value={texts.caption}
                    onChange={(e) => set("caption", e.target.value)}
                  />
                </Field>
                <Field label="Hashtags" htmlFor="cc-hashtags">
                  <Input id="cc-hashtags" value={texts.hashtags} onChange={(e) => set("hashtags", e.target.value)} />
                </Field>
                <Field label="Direção visual" htmlFor="cc-visual">
                  <Input
                    id="cc-visual"
                    value={texts.visualDirection}
                    onChange={(e) => set("visualDirection", e.target.value)}
                  />
                </Field>
                {formats.includes("reels") || formats.includes("stories") ? (
                  <Field label="Roteiro (Reels / Stories)" htmlFor="cc-script" className="sm:col-span-2">
                    <Textarea
                      id="cc-script"
                      rows={3}
                      value={texts.script}
                      onChange={(e) => set("script", e.target.value)}
                    />
                  </Field>
                ) : null}
              </div>

              {hasCarousel ? (
                <fieldset className="grid gap-2">
                  <legend className="text-sm font-medium">Páginas do carrossel (cada uma vira uma arte)</legend>
                  {texts.slides.map((sl, i) => (
                    <div key={i} className="grid gap-2 rounded-lg border border-border p-2 sm:grid-cols-[1fr_2fr_auto]">
                      <Input
                        aria-label={`Título da página ${i + 1}`}
                        value={sl.title}
                        placeholder={`Página ${i + 1}`}
                        onChange={(e) =>
                          setTexts((t) => ({
                            ...t,
                            slides: t.slides.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)),
                          }))
                        }
                      />
                      <Input
                        aria-label={`Texto da página ${i + 1}`}
                        value={sl.text}
                        onChange={(e) =>
                          setTexts((t) => ({
                            ...t,
                            slides: t.slides.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)),
                          }))
                        }
                      />
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Remover página ${i + 1}`}
                        onClick={() => setTexts((t) => ({ ...t, slides: t.slides.filter((_, j) => j !== i) }))}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  ))}
                  {texts.slides.length < 10 ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="justify-self-start"
                      onClick={() => setTexts((t) => ({ ...t, slides: [...t.slides, { title: "", text: "" }] }))}
                    >
                      <Plus /> Adicionar página
                    </Button>
                  ) : null}
                </fieldset>
              ) : null}

              <section className="grid gap-2 rounded-lg border border-border p-3">
                <p className="text-sm font-medium">Imagem principal (opcional)</p>
                <Field label="Prompt da imagem" htmlFor="cc-imgprompt">
                  <Textarea
                    id="cc-imgprompt"
                    rows={2}
                    value={texts.imagePrompt}
                    onChange={(e) => set("imagePrompt", e.target.value)}
                  />
                </Field>
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={!can.files || texts.imagePrompt.trim().length < 3}
                    loading={img.pending}
                    onClick={() => void generateImage()}
                  >
                    <ImagePlus /> {image ? "Gerar outra imagem" : "Gerar imagem com IA"}
                  </Button>
                  {!can.files ? (
                    <span className="text-xs text-fg-muted">Exige permissão para salvar em Arquivos.</span>
                  ) : null}
                  {image ? (
                    <Button variant="ghost" size="sm" onClick={() => setImage(null)}>
                      Não usar imagem
                    </Button>
                  ) : null}
                </div>
                {costPrompt?.kind === "image" ? (
                  <div role="alert" className="flex flex-wrap items-center gap-2 text-sm">
                    <AlertTriangle className="size-4 text-warning" /> {costPrompt.message}
                    <Button size="sm" variant="primary" onClick={() => void generateImage(true)} loading={img.pending}>
                      Confirmar e gerar
                    </Button>
                  </div>
                ) : null}
                {imageError ? (
                  <p role="alert" className="text-sm text-danger">
                    A imagem não foi gerada: {imageError}
                  </p>
                ) : null}
                {image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/api/files/${image.versionId}`}
                    alt="Imagem gerada para o conteúdo"
                    className="max-h-56 w-auto justify-self-start rounded-md border border-border"
                  />
                ) : null}
              </section>

              <section className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-2">
                <Field label="Campanha" htmlFor="cc-campaign">
                  <NativeSelect
                    id="cc-campaign"
                    value={campaignMode === "existing" ? campaignId : campaignMode}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "none" || v === "new") setCampaignMode(v);
                      else {
                        setCampaignMode("existing");
                        setCampaignId(v);
                      }
                    }}
                  >
                    <option value="none">Sem campanha</option>
                    <option value="new">+ Nova campanha</option>
                    {clientCampaigns.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </NativeSelect>
                  {campaignMode === "new" ? (
                    <Input
                      aria-label="Nome da nova campanha"
                      placeholder="Nome da campanha"
                      value={campaignName}
                      onChange={(e) => setCampaignName(e.target.value)}
                    />
                  ) : null}
                </Field>
                <Field label="Projeto" htmlFor="cc-project">
                  <NativeSelect
                    id="cc-project"
                    value={projectMode === "existing" ? projectId : projectMode}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "none" || v === "new") setProjectMode(v);
                      else {
                        setProjectMode("existing");
                        setProjectId(v);
                      }
                    }}
                  >
                    <option value="none">Sem projeto</option>
                    {can.projects ? <option value="new">+ Novo projeto</option> : null}
                    {clientProjects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </NativeSelect>
                  {projectMode === "new" ? (
                    <Input
                      aria-label="Nome do novo projeto"
                      placeholder="Nome do projeto"
                      value={projectName}
                      onChange={(e) => setProjectName(e.target.value)}
                    />
                  ) : null}
                </Field>
                <Field label="Data planejada (calendário editorial)" htmlFor="cc-date">
                  <Input
                    id="cc-date"
                    type="date"
                    value={plannedDate}
                    onChange={(e) => setPlannedDate(e.target.value)}
                  />
                </Field>
                <div className="grid content-start gap-2 text-sm">
                  <label className="flex items-center gap-2">
                    <Checkbox
                      checked={createDesigns}
                      disabled={!can.designs}
                      onCheckedChange={(v) => setCreateDesigns(!!v)}
                    />
                    Criar artes editáveis no Estúdio
                  </label>
                  <label className="flex items-center gap-2">
                    <Checkbox
                      checked={createRequest}
                      disabled={!can.requests}
                      onCheckedChange={(v) => setCreateRequest(!!v)}
                    />
                    Criar briefing (solicitação em rascunho)
                  </label>
                  <label className="flex items-center gap-2">
                    <Checkbox checked={createTask} disabled={!can.tasks} onCheckedChange={(v) => setCreateTask(!!v)} />
                    Criar tarefa de produção
                  </label>
                  {createTask ? (
                    <Input
                      type="date"
                      aria-label="Prazo da tarefa"
                      value={taskDueDate}
                      onChange={(e) => setTaskDueDate(e.target.value)}
                    />
                  ) : null}
                  {taskBlocked ? (
                    <p className="text-xs text-danger">Escolha ou crie um projeto para a tarefa.</p>
                  ) : null}
                </div>
              </section>

              <div
                className="rounded-lg border border-accent/40 bg-accent-soft/20 p-3 text-sm"
                data-testid="create-summary"
              >
                <p className="font-medium">Será criado ao confirmar:</p>
                <ul className="mt-1 list-inside list-disc text-fg-muted">
                  <li>
                    {formats.length} peça(s) de conteúdo: {formats.map((f) => CONTENT_FORMATS[f].label).join(", ")}
                  </li>
                  {artCount ? (
                    <li>
                      {artCount} arte(s) editável(is) no Estúdio{image ? ", com a imagem gerada" : ""}
                    </li>
                  ) : null}
                  {campaignMode === "new" && campaignName.trim() ? <li>Campanha “{campaignName.trim()}”</li> : null}
                  {projectMode === "new" && projectName.trim() ? <li>Projeto “{projectName.trim()}”</li> : null}
                  {createRequest ? <li>1 briefing em rascunho</li> : null}
                  {createTask ? <li>1 tarefa de produção</li> : null}
                  {plannedDate ? (
                    <li>No calendário editorial em {plannedDate.split("-").reverse().join("/")}</li>
                  ) : null}
                </ul>
              </div>
            </DialogBody>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setStep("setup")} disabled={create.pending}>
                Voltar
              </Button>
              <Button
                variant="primary"
                disabled={
                  !texts.title.trim() ||
                  taskBlocked ||
                  (campaignMode === "new" && campaignName.trim().length < 2) ||
                  (projectMode === "new" && projectName.trim().length < 2)
                }
                loading={create.pending}
                onClick={confirm}
              >
                Confirmar e criar
              </Button>
            </DialogFooter>
          </>
        ) : null}

        {step === "done" && done ? (
          <>
            <DialogBody className="grid gap-3 text-sm" data-testid="create-done">
              <p className="flex items-center gap-1.5 font-medium">
                <CheckCircle2 className="size-4 text-success" /> Criado com sucesso
              </p>
              <ul className="grid gap-1.5">
                {done.items.map((it) => (
                  <li key={it.id} className="flex flex-wrap items-center gap-2">
                    <Link href={`${base}/content/${it.id}`} className="font-medium text-accent-text hover:underline">
                      {CONTENT_FORMATS[it.format].label}
                    </Link>
                    {it.designs.map((d, i) => (
                      <Link key={d} href={`${base}/studio/${d}`} className="text-xs text-fg-muted hover:underline">
                        Abrir arte {it.designs.length > 1 ? i + 1 : ""} no editor
                      </Link>
                    ))}
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-3 text-xs">
                {done.taskId ? (
                  <Link href={`${base}/tasks/${done.taskId}`} className="hover:underline">
                    Ver tarefa
                  </Link>
                ) : null}
                {done.requestId ? (
                  <Link href={`${base}/requests/${done.requestId}`} className="hover:underline">
                    Ver briefing
                  </Link>
                ) : null}
                <Link href={`${base}/content?view=calendar`} className="hover:underline">
                  Ver calendário editorial
                </Link>
              </div>
            </DialogBody>
            <DialogFooter>
              <Button variant="primary" onClick={() => setOpen(false)}>
                Fechar
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
