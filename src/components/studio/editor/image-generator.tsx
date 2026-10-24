"use client";

import {
  AlertTriangle,
  Check,
  Eraser,
  ExternalLink,
  ImagePlus,
  Images,
  RefreshCw,
  Sparkles,
  Trash2,
  Undo2,
  X,
  Maximize2,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { AiModelPicker } from "@/components/ai/ai-model-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip } from "@/components/ui/tooltip";
import { useWorkspace } from "@/components/shell/workspace-context";
import { previewSelection, type AiSelection } from "@/lib/ai-select";
import { locate } from "@/lib/design-doc";
import {
  IMAGE_CONTEXT_LABEL,
  IMAGE_FORMATS,
  IMAGE_GEN_LIMITS,
  IMAGE_STYLES,
  imageProviderOptions,
  insertImageOps,
  outputSizeFor,
  ratioLabel,
  ratioOf,
  type ImageContextMode,
  type ImageFormatKey,
  type ImageStyleKey,
  type InsertImageMode,
  type Ratio,
} from "@/lib/image-gen";
import { cn } from "@/lib/utils";
import { designAiSetupAction } from "@/server/actions/design-ai";
import { enhanceImagePromptAction, generatedImagesAction } from "@/server/actions/design-image-gen";
import type { DesignAiSetup } from "@/server/services/design-ai";
import type {
  DesignImageGenResult,
  DesignImageUpscaleResult,
  GeneratedLibraryItem,
} from "@/server/services/design-image-gen";
import { loadImage } from "./media";
import { useEditor, type EditorStore } from "./store";

/*
 * Gerar imagem (Estúdio Criador → painel Imagens). O estado fica num store
 * próprio criado junto com o editor: fechar o painel, trocar de aba ou abrir a
 * gaveta no celular não perde a descrição, as opções nem os resultados, e uma
 * geração em andamento continua até terminar. A inserção usa as operações
 * normais do editor (desfazer, salvamento automático): a imagem gerada é uma
 * imagem como qualquer outra, já salva em Arquivos pelo servidor.
 */

type Alternative = { provider: string; providerLabel: string; model: string; label: string };

/** Imagem escolhida para inserir (de um resultado ou da biblioteca de geradas). */
export type PickedImage = {
  src: string;
  width: number;
  height: number;
  name: string;
  fileId: string;
  versionId: string;
  origin: "result" | "library";
};

type Library = {
  items: GeneratedLibraryItem[];
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  page: number;
  hasMore: boolean;
  open: boolean;
};

export type ImageGenState = {
  prompt: string;
  /** Descrição antes de "Melhorar com IA" (para desfazer). */
  originalPrompt: string | null;
  format: ImageFormatKey;
  customRatio: Ratio;
  style: ImageStyleKey;
  /** "" = padrão do provedor. */
  quality: string;
  variations: number;
  negativePrompt: string;
  /** Usar a imagem selecionada na arte como referência de composição (modelos que aceitam). */
  useReference: boolean;
  /** Ampliar resolução (upscale) da imagem selecionada. */
  upscale: {
    selection: AiSelection;
    showModel: boolean;
    scale: 2 | 4 | 8 | 16;
    status: "idle" | "running" | "error";
    error: { message: string; alternatives: Alternative[] } | null;
    costPrompt: string | null;
    last: DesignImageUpscaleResult | null;
  };
  context: ImageContextMode;
  /** Modelo de imagem (gerar). */
  selection: AiSelection;
  showModel: boolean;
  /** Modelo de texto do "Melhorar com IA" (independente do modelo de imagem). */
  enhanceSelection: AiSelection;
  showEnhanceModel: boolean;
  setup: DesignAiSetup | null;
  setupError: string | null;
  status: "idle" | "running" | "done" | "error";
  error: { message: string; alternatives: Alternative[] } | null;
  costPrompt: string | null;
  enhancing: boolean;
  enhanceCost: string | null;
  enhanceError: { message: string; alternatives: Alternative[] } | null;
  result: DesignImageGenResult | null;
  picked: PickedImage | null;
  inserting: boolean;
  library: Library;
};

const initialState = (): ImageGenState => ({
  prompt: "",
  originalPrompt: null,
  format: "page",
  customRatio: { w: 3, h: 2 },
  style: "none",
  quality: "",
  variations: 1,
  negativePrompt: "",
  useReference: false,
  upscale: {
    selection: { mode: "default" },
    showModel: false,
    scale: 2,
    status: "idle",
    error: null,
    costPrompt: null,
    last: null,
  },
  context: "none",
  selection: { mode: "default" },
  showModel: false,
  enhanceSelection: { mode: "default" },
  showEnhanceModel: false,
  setup: null,
  setupError: null,
  status: "idle",
  error: null,
  costPrompt: null,
  enhancing: false,
  enhanceCost: null,
  enhanceError: null,
  result: null,
  picked: null,
  inserting: false,
  library: { items: [], status: "idle", error: null, page: 1, hasMore: false, open: false },
});

export class ImageGenStore {
  state: ImageGenState = initialState();
  /** Geração em andamento (cancelável). */
  abort: AbortController | null = null;
  private listeners = new Set<() => void>();

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  get = () => this.state;

  set(patch: Partial<ImageGenState> | ((s: ImageGenState) => Partial<ImageGenState>)) {
    this.state = { ...this.state, ...(typeof patch === "function" ? patch(this.state) : patch) };
    for (const l of this.listeners) l();
  }

  cancel() {
    this.abort?.abort();
    this.abort = null;
  }

  /** Registra a geração em andamento (cancela a anterior, se houver). */
  start(controller: AbortController) {
    this.cancel();
    this.abort = controller;
  }

  /** Encerra a geração se ainda for a registrada (uma mais nova pode ter começado). */
  finish(controller: AbortController) {
    if (this.abort === controller) this.abort = null;
  }
}

export function useImageGen(gen: ImageGenStore) {
  return useSyncExternalStore(gen.subscribe, gen.get, gen.get);
}

const MODULE = "editor";
const TASK = "image_generation" as const;
const ENHANCE_TASK = "image_prompt" as const;
const UPSCALE_TASK = "image_upscale" as const;
const UPSCALE_SCALES = [2, 4, 8, 16] as const;
const FORMAT_ORDER: ImageFormatKey[] = ["square", "portrait", "story", "landscape", "page", "custom"];
const PROMPT_EXAMPLE =
  "Ex.: Fotografia publicitária hiper-realista de um frasco de perfume premium sobre uma superfície de mármore preto, iluminação cinematográfica, reflexos controlados, composição sofisticada e acabamento de campanha de luxo.";

const H = ({ children }: { children: React.ReactNode }) => (
  <h3 className="mb-1.5 text-xs font-semibold text-fg-subtle uppercase">{children}</h3>
);

const needsConfirm = (r: { ok: boolean; code?: string; error?: string }) =>
  !r.ok && r.code === "conflict" && /Confirme para continuar/.test(r.error ?? "");

function imageName(prompt: string) {
  const t = prompt.replace(/\s+/g, " ").trim();
  return `IA: ${t.length > 50 ? `${t.slice(0, 49)}…` : t || "imagem"}`;
}

export function ImageGeneratorPanel({
  store,
  gen,
  design,
  canWrite,
  onDone,
}: {
  store: EditorStore;
  gen: ImageGenStore;
  design: { id: string; clientId: string | null; clientName: string | null };
  canWrite: boolean;
  /** Fecha a gaveta (celular) depois de inserir. */
  onDone?: () => void;
}) {
  const { orgSlug } = useWorkspace();
  const st = useImageGen(gen);
  const doc = useEditor(store, (s) => s.doc);
  const page = useEditor(store, (s) => s.activePage);
  const pageIndex = useEditor(store, (s) => s.doc.pages.findIndex((p) => p.id === s.activePageId));
  const pageCount = doc.pages.length;
  const selection = useEditor(store, (s) => s.selection);

  // Dados do seletor de modelos (uma vez; ficam no store ao fechar o painel).
  useEffect(() => {
    if (gen.state.setup || gen.state.setupError) return;
    let alive = true;
    void designAiSetupAction(orgSlug, { designId: design.id })
      .then((res) => {
        if (!alive) return;
        if (res.ok) gen.set({ setup: res.data, setupError: null });
        else gen.set({ setupError: res.error });
      })
      .catch(() => alive && gen.set({ setupError: "Falha de conexão ao carregar os modelos de IA." }));
    return () => {
      alive = false;
    };
  }, [gen, orgSlug, design.id]);

  const setup = st.setup?.canUse ? st.setup : null;
  const preview = useMemo(
    () =>
      setup
        ? previewSelection(setup.picker.providers, setup.picker.preferences, {
            module: MODULE,
            task: TASK,
            selection: st.selection,
          })
        : null,
    [setup, st.selection],
  );
  // Modelo de texto que o "Melhorar com IA" vai usar (mesmas regras do servidor, que revalida).
  const enhancePreview = useMemo(
    () =>
      setup
        ? previewSelection(setup.picker.providers, setup.picker.preferences, {
            module: MODULE,
            task: ENHANCE_TASK,
            selection: st.enhanceSelection,
          })
        : null,
    [setup, st.enhanceSelection],
  );
  const providerLabel = (id: string) => setup?.picker.providers.find((p) => p.id === id)?.label ?? id;
  const options = imageProviderOptions(
    preview && !preview.problem ? preview.model?.provider : null,
    preview && !preview.problem ? preview.model?.id : null,
  );
  // Modelo de ampliação (upscale) da imagem selecionada.
  const upscalePreview = useMemo(
    () =>
      setup
        ? previewSelection(setup.picker.providers, setup.picker.preferences, {
            module: MODULE,
            task: UPSCALE_TASK,
            selection: st.upscale.selection,
          })
        : null,
    [setup, st.upscale.selection],
  );
  const ratio = ratioOf(st.format, page, st.customRatio);
  const output = ratio && options ? outputSizeFor(ratio, options.sizes) : null;
  const contextBlocked = !!design.clientId && !!setup && !setup.allowClientContext && !setup.demo;
  const selectedImageId = (() => {
    if (selection.length !== 1) return null;
    const loc = locate(doc, selection[0]!);
    return loc?.object.type === "image" && loc.pageId === page.id ? loc.object.id : null;
  })();
  // Modelo com problema não bloqueia o botão: o servidor revalida e devolve o erro com alternativas.
  const blocked = !canWrite || !setup || !setup.enabled || !setup.canEdit || !setup.canSaveFiles;
  const promptOk = st.prompt.trim().length >= 3;
  const running = st.status === "running";

  /* ---------------------------- geração ---------------------------- */

  async function generate(opts: { confirmCost?: boolean; sel?: AiSelection } = {}) {
    if (running || blocked) return;
    if (!promptOk) return toast.error("Descreva a imagem (pelo menos 3 caracteres).");
    if (!ratio) return toast.error("Informe uma proporção válida (de 1:3 a 3:1).");
    const sel = opts.sel ?? gen.state.selection;
    const controller = new AbortController();
    gen.start(controller);
    gen.set({ status: "running", error: null, costPrompt: null, selection: sel });
    try {
      const res = await fetch("/api/designs/ai/generate-image", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          orgSlug,
          designId: design.id,
          prompt: gen.state.prompt.trim(),
          format: gen.state.format,
          customRatio: gen.state.format === "custom" ? gen.state.customRatio : undefined,
          style: gen.state.style,
          quality: options?.qualities && gen.state.quality ? gen.state.quality : undefined,
          variations: Math.min(gen.state.variations, options?.maxVariations ?? 1),
          negativePrompt:
            options?.negativePrompt && gen.state.negativePrompt.trim() ? gen.state.negativePrompt : undefined,
          reference:
            options?.references && gen.state.useReference && selectedImageId
              ? { objectId: selectedImageId }
              : undefined,
          context: gen.state.context,
          document: store.doc,
          pageId: store.activePageId,
          ai: sel,
          confirmCost: opts.confirmCost,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        result?: DesignImageGenResult;
        error?: string;
        code?: string;
        alternatives?: Alternative[];
      };
      if (res.ok && json.ok && json.result) {
        const r = json.result;
        // Carrega antes de mostrar: a inserção não espera pelo download.
        await Promise.all(r.images.map((i) => loadImage(i.src)));
        const first = r.images[0]!;
        gen.set({
          status: "done",
          result: r,
          picked: { ...first, name: imageName(r.prompt), origin: "result" },
          library: { ...gen.state.library, status: "idle" },
        });
        if (r.notice) toast.warning(r.notice);
        for (const w of r.warnings) toast.info(w);
        return;
      }
      if (json.code === "cost_confirmation") {
        gen.set({ status: "idle", costPrompt: json.error ?? "Confirme o custo para continuar." });
        return;
      }
      gen.set({
        status: "error",
        error: {
          message: json.error ?? "Não foi possível gerar a imagem. Tente novamente.",
          alternatives: json.alternatives ?? [],
        },
      });
    } catch {
      if (controller.signal.aborted) {
        gen.set({ status: "idle" });
        toast.info("Geração cancelada.");
      } else {
        gen.set({
          status: "error",
          error: { message: "Sem conexão com o servidor. Verifique a internet e tente de novo.", alternatives: [] },
        });
      }
    } finally {
      gen.finish(controller);
    }
  }

  async function enhance(opts: { confirmCost?: boolean; sel?: AiSelection } = {}) {
    if (st.enhancing || !promptOk || !setup) return;
    const sel = opts.sel ?? gen.state.enhanceSelection;
    gen.set({ enhancing: true, enhanceCost: null, enhanceError: null, enhanceSelection: sel });
    const original = gen.state.prompt;
    try {
      const res = await enhanceImagePromptAction(orgSlug, {
        designId: design.id,
        prompt: original.trim(),
        style: gen.state.style,
        context: gen.state.context,
        document: store.doc as unknown as Record<string, unknown>,
        pageId: store.activePageId,
        ai: sel,
        confirmCost: opts.confirmCost,
      });
      if (needsConfirm(res)) return gen.set({ enhanceCost: (res as { error: string }).error });
      if (!res.ok) {
        // Modelo escolhido indisponível ou sem texto: mostra o motivo e as alternativas compatíveis.
        const alternatives = "alternatives" in res ? res.alternatives : [];
        return gen.set({ enhanceError: { message: res.error, alternatives } });
      }
      gen.set({ prompt: res.data.prompt, originalPrompt: original });
      if (res.data.notice) toast.warning(res.data.notice);
      toast.success(
        res.data.demo
          ? "Descrição melhorada (exemplo da demonstração local)."
          : `Descrição melhorada por ${res.data.providerLabel}.`,
      );
    } catch {
      toast.error("Falha de conexão ao melhorar a descrição.");
    } finally {
      gen.set({ enhancing: false });
    }
  }

  /* ---------------------------- ampliação ---------------------------- */

  const upscaling = st.upscale.status === "running";
  const setUpscale = (patch: Partial<ImageGenState["upscale"]>) =>
    gen.set((s) => ({ upscale: { ...s.upscale, ...patch } }));

  async function upscale(opts: { confirmCost?: boolean; sel?: AiSelection } = {}) {
    if (upscaling || blocked || !selectedImageId) return;
    const sel = opts.sel ?? gen.state.upscale.selection;
    const controller = new AbortController();
    gen.start(controller);
    setUpscale({ status: "running", error: null, costPrompt: null, selection: sel });
    try {
      const res = await fetch("/api/designs/ai/upscale-image", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          orgSlug,
          designId: design.id,
          objectId: selectedImageId,
          scale: gen.state.upscale.scale,
          document: store.doc,
          ai: sel,
          confirmCost: opts.confirmCost,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        result?: DesignImageUpscaleResult;
        error?: string;
        code?: string;
        alternatives?: Alternative[];
      };
      if (res.ok && json.ok && json.result) {
        const r = json.result;
        await loadImage(r.image.src);
        gen.set((s) => ({
          upscale: { ...s.upscale, status: "idle", last: r },
          picked: { ...r.image, name: `IA: ampliada ${r.scale}×`, origin: "result" },
        }));
        for (const w of r.warnings) toast.info(w);
        toast.success(
          `Imagem ampliada ${r.scale}× (${r.image.width}×${r.image.height} px) e salva em Arquivos. Use "Substituir" para trocá-la na arte.`,
        );
        return;
      }
      if (json.code === "cost_confirmation") {
        setUpscale({ status: "idle", costPrompt: json.error ?? "Confirme o custo para continuar." });
        return;
      }
      setUpscale({
        status: "error",
        error: {
          message: json.error ?? "Não foi possível ampliar a imagem. Tente novamente.",
          alternatives: json.alternatives ?? [],
        },
      });
    } catch {
      if (controller.signal.aborted) {
        setUpscale({ status: "idle" });
        toast.info("Ampliação cancelada.");
      } else {
        setUpscale({
          status: "error",
          error: { message: "Sem conexão com o servidor. Verifique a internet e tente de novo.", alternatives: [] },
        });
      }
    } finally {
      gen.finish(controller);
    }
  }

  /* ---------------------------- inserção ---------------------------- */

  async function insert(mode: InsertImageMode) {
    const img = gen.state.picked;
    if (!img || gen.state.inserting) return;
    // Sempre a página ativa NESTE momento (nunca a de quando a imagem foi gerada).
    const target = store.activePage;
    const index = store.doc.pages.indexOf(target);
    let targetId: string | null = null;
    if (mode === "replace") {
      const sel = store.selection.length === 1 ? locate(store.doc, store.selection[0]!) : null;
      if (!sel || sel.object.type !== "image" || sel.pageId !== target.id) {
        return toast.error("Selecione uma imagem no slide atual para substituir.");
      }
      targetId = sel.object.id;
    }
    gen.set({ inserting: true });
    try {
      const loaded = await loadImage(img.src);
      if (loaded.missing) return toast.error("Não foi possível carregar a imagem gerada. Tente de novo.");
      const { ops, id } = insertImageOps(
        target,
        {
          src: img.src,
          width: loaded.el.naturalWidth || img.width,
          height: loaded.el.naturalHeight || img.height,
          name: img.name,
        },
        mode,
        targetId,
      );
      const r = store.dispatch(ops, {
        label:
          mode === "replace"
            ? "Trocar imagem"
            : mode === "background"
              ? "Fundo com imagem gerada"
              : "Inserir imagem gerada",
        select: [id],
      });
      if (!r) return;
      store.setSelection([id]);
      store.scene?.revealPage(target.id);
      const where = pageCount > 1 ? `no slide ${index + 1}` : "na página";
      toast.success(
        mode === "replace"
          ? `Imagem substituída ${where}.`
          : mode === "background"
            ? `Imagem aplicada como fundo ${where}.`
            : `Imagem inserida ${where}.`,
      );
      onDone?.();
    } finally {
      gen.set({ inserting: false });
    }
  }

  /* ---------------------------- biblioteca ---------------------------- */

  async function loadLibrary(pageNumber: number) {
    gen.set((s) => ({ library: { ...s.library, status: "loading", error: null } }));
    const res = await generatedImagesAction(orgSlug, { designId: design.id, page: pageNumber }).catch(() => null);
    if (!res?.ok) {
      gen.set((s) => ({
        library: {
          ...s.library,
          status: "error",
          error: res && !res.ok ? res.error : "Não foi possível carregar as imagens geradas.",
        },
      }));
      return;
    }
    gen.set((s) => ({
      library: {
        ...s.library,
        status: "ready",
        page: pageNumber,
        hasMore: res.data.hasMore,
        items: pageNumber === 1 ? res.data.items : [...s.library.items, ...res.data.items],
      },
    }));
  }

  const toggleLibrary = () => {
    const open = !st.library.open;
    gen.set((s) => ({ library: { ...s.library, open } }));
    if (open && st.library.status !== "ready") void loadLibrary(1);
  };

  /* ---------------------------- render ---------------------------- */

  const whereLabel = pageCount > 1 ? `Slide ${pageIndex + 1} de ${pageCount}` : "Página única";
  const modelLine = preview
    ? preview.problem
      ? preview.reason
      : `${preview.model!.label} · ${setup!.picker.providers.find((p) => p.id === preview.model!.provider)?.label ?? preview.model!.provider}`
    : null;

  return (
    <div className="grid gap-4" data-testid="image-generator" data-status={st.status}>
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-fg-muted">
        <Badge tone="accent" data-testid="image-generator-where">
          {whereLabel}
        </Badge>
        <span>
          {page.width}×{page.height} px
        </span>
      </div>

      {st.setupError ? (
        <p role="alert" className="rounded-md bg-danger-soft p-2 text-xs text-danger">
          {st.setupError}{" "}
          <button type="button" className="underline" onClick={() => gen.set({ setupError: null })}>
            Tentar de novo
          </button>
        </p>
      ) : null}
      {st.setup && !st.setup.canUse ? (
        <p className="rounded-md bg-warning-soft p-2 text-xs">Você não tem permissão para usar a IA nesta agência.</p>
      ) : null}
      {setup && !setup.enabled ? (
        <p className="rounded-md bg-warning-soft p-2 text-xs">O assistente de IA está desativado nesta organização.</p>
      ) : null}
      {setup && !setup.canSaveFiles ? (
        <p className="rounded-md bg-warning-soft p-2 text-xs">
          Gerar imagens exige permissão para enviar arquivos (a imagem é salva em Arquivos).
        </p>
      ) : null}

      {/* Descrição */}
      <section>
        <H>Descrição da imagem</H>
        <Textarea
          value={st.prompt}
          onChange={(e) => gen.set({ prompt: e.target.value, originalPrompt: null })}
          rows={5}
          maxLength={IMAGE_GEN_LIMITS.prompt}
          placeholder={PROMPT_EXAMPLE}
          aria-label="Descrição da imagem"
          disabled={running}
          className="text-xs"
          data-testid="image-generator-prompt"
        />
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <Button
            size="xs"
            variant="secondary"
            onClick={() => void enhance()}
            loading={st.enhancing}
            disabled={!promptOk || running || !setup || !setup.enabled}
            data-testid="image-generator-enhance"
          >
            <Sparkles /> Melhorar com IA
          </Button>
          {st.originalPrompt !== null ? (
            <Button
              size="xs"
              variant="ghost"
              onClick={() => gen.set({ prompt: st.originalPrompt!, originalPrompt: null })}
              data-testid="image-generator-undo-enhance"
            >
              <Undo2 /> Voltar ao texto original
            </Button>
          ) : null}
          <Button
            size="xs"
            variant="ghost"
            onClick={() => gen.set({ prompt: "", originalPrompt: null })}
            disabled={!st.prompt || running}
            aria-label="Limpar a descrição"
          >
            <Eraser /> Limpar
          </Button>
        </div>
        {setup ? (
          <div className="mt-1.5 flex items-start gap-1.5 text-[11px]" data-testid="image-generator-enhance-model">
            {enhancePreview?.problem ? (
              <AlertTriangle className="mt-0.5 size-3 shrink-0 text-danger" />
            ) : (
              <Sparkles className="mt-0.5 size-3 shrink-0 text-fg-subtle" />
            )}
            <span className={cn("min-w-0 flex-1", enhancePreview?.problem ? "text-danger" : "text-fg-subtle")}>
              Melhorar com IA usa:{" "}
              {enhancePreview
                ? enhancePreview.problem
                  ? enhancePreview.reason
                  : `${enhancePreview.model!.label} · ${providerLabel(enhancePreview.model!.provider)}`
                : "—"}
            </span>
            <button
              type="button"
              className="shrink-0 text-accent-text underline"
              onClick={() => gen.set({ showEnhanceModel: !st.showEnhanceModel })}
              data-testid="image-generator-enhance-model-toggle"
            >
              {st.showEnhanceModel ? "Ocultar" : "Alterar"}
            </button>
          </div>
        ) : null}
        {st.showEnhanceModel && setup ? (
          <AiModelPicker
            providers={setup.picker.providers}
            preferences={setup.picker.preferences}
            task={ENHANCE_TASK}
            module={MODULE}
            value={st.enhanceSelection}
            onChange={(enhanceSelection) => gen.set({ enhanceSelection, enhanceError: null })}
            disabled={st.enhancing}
            className="mt-2"
          />
        ) : null}
        {st.enhanceCost ? (
          <div role="alert" className="mt-2 grid gap-1.5 rounded-md bg-warning-soft/60 p-2 text-xs">
            <span>{st.enhanceCost}</span>
            <span className="flex gap-1.5">
              <Button size="xs" variant="primary" onClick={() => void enhance({ confirmCost: true })}>
                Confirmar
              </Button>
              <Button size="xs" variant="ghost" onClick={() => gen.set({ enhanceCost: null })}>
                Cancelar
              </Button>
            </span>
          </div>
        ) : null}
        {st.enhanceError ? (
          <div
            role="alert"
            className="mt-2 grid gap-1.5 rounded-md bg-danger-soft p-2 text-xs text-danger"
            data-testid="image-generator-enhance-error"
          >
            <span className="flex items-start gap-1.5">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {st.enhanceError.message}
            </span>
            {st.enhanceError.alternatives.length ? (
              <span className="flex flex-wrap gap-1.5">
                {st.enhanceError.alternatives.map((a) => (
                  <Button
                    key={`${a.provider}:${a.model}`}
                    size="xs"
                    variant="secondary"
                    onClick={() => void enhance({ sel: { mode: "manual", provider: a.provider, model: a.model } })}
                  >
                    Usar {a.label} ({a.providerLabel})
                  </Button>
                ))}
              </span>
            ) : null}
          </div>
        ) : null}
      </section>

      {/* Contexto */}
      <section>
        <H>Contexto</H>
        <div role="radiogroup" aria-label="Contexto da imagem" className="flex flex-wrap gap-1">
          {(Object.keys(IMAGE_CONTEXT_LABEL) as ImageContextMode[]).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={st.context === k}
              disabled={running || (k !== "none" && contextBlocked)}
              onClick={() => gen.set({ context: k })}
              className={cn(
                "rounded-md border px-2 py-1 text-xs transition-colors disabled:opacity-50",
                st.context === k
                  ? "border-accent bg-accent-soft font-medium text-fg"
                  : "border-border bg-surface text-fg-muted hover:text-fg",
              )}
            >
              {IMAGE_CONTEXT_LABEL[k]}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[11px] text-fg-subtle">
          {contextBlocked
            ? "A política de IA da organização não permite enviar dados de clientes ao provedor; o contexto desta arte fica desligado (Configurações → Inteligência artificial)."
            : st.context === "slide"
              ? "Usa os textos e elementos deste slide e a identidade visual do cliente para a imagem complementar a mensagem."
              : st.context === "carousel"
                ? "Usa o tema, a narrativa e a sequência dos slides, as imagens já geradas e a identidade visual, para manter a continuidade."
                : "Só a sua descrição é enviada ao provedor."}
        </p>
      </section>

      {/* Modelo */}
      <section>
        <H>Modelo de IA</H>
        {!setup ? (
          st.setupError ? null : (
            <p className="flex items-center gap-1.5 text-xs text-fg-muted">
              <Spinner className="size-3.5" /> Carregando modelos…
            </p>
          )
        ) : st.showModel ? (
          <>
            <AiModelPicker
              providers={setup.picker.providers}
              preferences={setup.picker.preferences}
              task={TASK}
              module={MODULE}
              value={st.selection}
              onChange={(selection) => gen.set({ selection })}
              disabled={running}
            />
            <button
              type="button"
              className="mt-1 text-[11px] text-fg-subtle underline"
              onClick={() => gen.set({ showModel: false })}
            >
              Ocultar opções de modelo
            </button>
          </>
        ) : (
          <div className="flex items-start gap-1.5 text-xs" data-testid="image-generator-model">
            {preview?.problem ? (
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-danger" />
            ) : (
              <Sparkles className="mt-0.5 size-3.5 shrink-0 text-fg-subtle" />
            )}
            <span className={cn("min-w-0 flex-1", preview?.problem ? "text-danger" : "text-fg-muted")}>
              {modelLine}
              {setup.demo ? " A demonstração local não gera imagens." : ""}
            </span>
            <button
              type="button"
              className="shrink-0 text-[11px] text-accent-text underline"
              onClick={() => gen.set({ showModel: true })}
            >
              Alterar
            </button>
          </div>
        )}
      </section>

      {/* Formato */}
      <section>
        <H>Formato</H>
        <div className="grid grid-cols-3 gap-1" role="radiogroup" aria-label="Formato da imagem">
          {FORMAT_ORDER.map((k) => {
            const f = IMAGE_FORMATS[k];
            const r = k === "page" ? ratioOf("page", page, null) : null;
            const sub = k === "page" ? (r ? ratioLabel(r) : "—") : k === "custom" ? "W:H" : f.ratio;
            return (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={st.format === k}
                aria-label={`Formato ${f.label}${k === "page" || k === "custom" ? "" : ` ${f.ratio}`}`}
                disabled={running}
                onClick={() => gen.set({ format: k })}
                className={cn(
                  "flex flex-col items-center gap-0.5 rounded-md border px-1 py-1.5 text-[11px] leading-tight transition-colors disabled:opacity-50",
                  st.format === k
                    ? "border-accent bg-accent-soft font-medium text-fg"
                    : "border-border bg-surface text-fg-muted hover:text-fg",
                )}
              >
                <FormatGlyph ratio={k === "page" ? r : k === "custom" ? st.customRatio : { w: f.w, h: f.h }} />
                <span className="font-semibold">{sub}</span>
                <span className="truncate">{k === "page" ? "Slide" : f.label.split(" ")[0]}</span>
              </button>
            );
          })}
        </div>
        {st.format === "custom" ? (
          <div className="mt-2 flex items-center gap-1.5 text-xs">
            <label className="flex items-center gap-1">
              <span className="text-fg-subtle">L</span>
              <Input
                type="number"
                min={1}
                max={IMAGE_GEN_LIMITS.customRatio}
                value={st.customRatio.w}
                onChange={(e) => gen.set({ customRatio: { ...st.customRatio, w: Number(e.target.value) } })}
                className="h-7 w-16 px-2 text-xs"
                aria-label="Proporção: largura"
              />
            </label>
            <span className="text-fg-subtle">:</span>
            <label className="flex items-center gap-1">
              <span className="text-fg-subtle">A</span>
              <Input
                type="number"
                min={1}
                max={IMAGE_GEN_LIMITS.customRatio}
                value={st.customRatio.h}
                onChange={(e) => gen.set({ customRatio: { ...st.customRatio, h: Number(e.target.value) } })}
                className="h-7 w-16 px-2 text-xs"
                aria-label="Proporção: altura"
              />
            </label>
          </div>
        ) : null}
        <p className="mt-1.5 text-[11px] text-fg-subtle" data-testid="image-generator-format">
          {ratio
            ? `Selecionado: ${IMAGE_FORMATS[st.format].label} ${ratioLabel(ratio)}${
                output
                  ? ` → ${output.width}×${output.height} px (gerada em ${output.base.w}×${output.base.h} e recortada ao centro)`
                  : ""
              }`
            : "Proporção inválida: use valores de 1 a 32, entre 1:3 e 3:1."}
        </p>
      </section>

      {/* Qualidade e estilo (dinâmicos pelo provedor) */}
      <section className="grid gap-2">
        <H>Qualidade e estilo</H>
        {options?.qualities ? (
          <label className="grid gap-1 text-xs">
            <span className="text-fg-muted">{options.qualityLabel ?? "Qualidade"}</span>
            <NativeSelect
              value={st.quality}
              onChange={(e) => gen.set({ quality: e.target.value })}
              disabled={running}
              className="h-8 text-xs"
              aria-label="Qualidade"
            >
              <option value="">Padrão do provedor</option>
              {Object.entries(options.qualities).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </NativeSelect>
          </label>
        ) : null}
        <label className="grid gap-1 text-xs">
          <span className="text-fg-muted">Estilo</span>
          <NativeSelect
            value={st.style}
            onChange={(e) => gen.set({ style: e.target.value as ImageStyleKey })}
            disabled={running}
            className="h-8 text-xs"
            aria-label="Estilo"
          >
            {(Object.keys(IMAGE_STYLES) as ImageStyleKey[]).map((k) => (
              <option key={k} value={k}>
                {IMAGE_STYLES[k].label}
              </option>
            ))}
          </NativeSelect>
        </label>
        {options && options.maxVariations > 1 ? (
          <div className="grid gap-1 text-xs">
            <span className="text-fg-muted">Variações</span>
            <div role="radiogroup" aria-label="Quantidade de variações" className="flex gap-1">
              {Array.from({ length: options.maxVariations }, (_, i) => i + 1).map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={st.variations === n}
                  disabled={running}
                  onClick={() => gen.set({ variations: n })}
                  className={cn(
                    "size-8 rounded-md border text-xs transition-colors disabled:opacity-50",
                    st.variations === n
                      ? "border-accent bg-accent-soft font-medium text-fg"
                      : "border-border bg-surface text-fg-muted hover:text-fg",
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {options?.negativePrompt ? (
          <label className="grid gap-1 text-xs">
            <span className="text-fg-muted">Evitar (instruções negativas)</span>
            <Textarea
              value={st.negativePrompt}
              onChange={(e) => gen.set({ negativePrompt: e.target.value })}
              rows={2}
              maxLength={IMAGE_GEN_LIMITS.negativePrompt}
              disabled={running}
              className="min-h-0 text-xs"
            />
          </label>
        ) : null}
        {options?.references ? (
          <label className="flex items-start gap-2 text-xs" data-testid="image-generator-reference">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={st.useReference && !!selectedImageId}
              disabled={running || !selectedImageId}
              onChange={(e) => gen.set({ useReference: e.target.checked })}
            />
            <span className="text-fg-muted">
              Usar a imagem selecionada como referência de composição
              {selectedImageId ? "" : " (selecione uma imagem no slide atual)"}
            </span>
          </label>
        ) : null}
        {!options && preview && !preview.problem ? (
          <p className="text-[11px] text-fg-subtle">Este provedor não oferece opções de qualidade ou variações.</p>
        ) : null}
      </section>

      {/* Gerar */}
      <section className="grid gap-2">
        {running ? (
          <div
            role="status"
            className="flex items-center gap-2 rounded-md border border-border bg-surface-2/60 p-2 text-xs"
            data-testid="image-generator-running"
          >
            <Spinner className="size-4 shrink-0 text-accent-text" />
            <span className="min-w-0 flex-1">
              Gerando {st.variations > 1 ? `${st.variations} variações` : "a imagem"}
              {preview?.model ? ` com ${preview.model.label}` : ""}… pode levar até um minuto.
            </span>
            <Button size="xs" variant="ghost" onClick={() => gen.cancel()} aria-label="Cancelar geração">
              <X /> Cancelar
            </Button>
          </div>
        ) : (
          <Button
            variant="primary"
            className="w-full"
            onClick={() => void generate()}
            disabled={blocked || !promptOk || !ratio}
            data-testid="image-generator-generate"
          >
            <ImagePlus /> {st.result ? "Gerar novamente" : "Gerar imagem"}
          </Button>
        )}
        {st.costPrompt ? (
          <div role="alert" className="grid gap-1.5 rounded-md bg-warning-soft/60 p-2 text-xs">
            <span>{st.costPrompt}</span>
            <span className="flex gap-1.5">
              <Button size="xs" variant="primary" onClick={() => void generate({ confirmCost: true })}>
                Confirmar e gerar
              </Button>
              <Button size="xs" variant="ghost" onClick={() => gen.set({ costPrompt: null })}>
                Cancelar
              </Button>
            </span>
          </div>
        ) : null}
        {st.error ? (
          <div
            role="alert"
            className="grid gap-1.5 rounded-md bg-danger-soft p-2 text-xs text-danger"
            data-testid="image-generator-error"
          >
            <span className="flex items-start gap-1.5">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {st.error.message}
            </span>
            <span className="flex flex-wrap gap-1.5">
              {st.error.alternatives.map((a) => (
                <Button
                  key={`${a.provider}:${a.model}`}
                  size="xs"
                  variant="secondary"
                  onClick={() => void generate({ sel: { mode: "manual", provider: a.provider, model: a.model } })}
                >
                  Usar {a.label} ({a.providerLabel})
                </Button>
              ))}
              <Button size="xs" variant="secondary" onClick={() => void generate()}>
                <RefreshCw /> Tentar de novo
              </Button>
            </span>
          </div>
        ) : null}
      </section>

      {/* Ampliar resolução da imagem selecionada */}
      {setup && selectedImageId ? (
        <section className="grid gap-2" data-testid="image-upscale">
          <H>Ampliar imagem selecionada</H>
          <p className="text-[11px] text-fg-subtle">
            Aumenta a resolução da imagem selecionada com um modelo de ampliação (ex.: Magnific). O resultado vai para
            Arquivos; você escolhe se substitui a imagem na arte.
          </p>
          {st.upscale.showModel ? (
            <AiModelPicker
              providers={setup.picker.providers}
              preferences={setup.picker.preferences}
              task={UPSCALE_TASK}
              module={MODULE}
              value={st.upscale.selection}
              onChange={(selection) => setUpscale({ selection, error: null })}
              disabled={upscaling}
            />
          ) : (
            <div className="flex items-start gap-1.5 text-xs" data-testid="image-upscale-model">
              {upscalePreview?.problem ? (
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-danger" />
              ) : (
                <Maximize2 className="mt-0.5 size-3.5 shrink-0 text-fg-subtle" />
              )}
              <span className={cn("min-w-0 flex-1", upscalePreview?.problem ? "text-danger" : "text-fg-muted")}>
                {upscalePreview?.problem
                  ? upscalePreview.problem
                  : upscalePreview?.model
                    ? `${upscalePreview.model.label} · ${providerLabel(upscalePreview.model.provider)}`
                    : "Escolha automática"}
              </span>
              <button
                type="button"
                className="shrink-0 text-[11px] text-accent-text underline"
                onClick={() => setUpscale({ showModel: true })}
              >
                Alterar
              </button>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <div role="radiogroup" aria-label="Fator de ampliação" className="flex gap-1">
              {UPSCALE_SCALES.map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={st.upscale.scale === n}
                  disabled={upscaling}
                  onClick={() => setUpscale({ scale: n })}
                  className={cn(
                    "h-8 rounded-md border px-2 text-xs transition-colors disabled:opacity-50",
                    st.upscale.scale === n
                      ? "border-accent bg-accent-soft font-medium text-fg"
                      : "border-border bg-surface text-fg-muted hover:text-fg",
                  )}
                >
                  {n}×
                </button>
              ))}
            </div>
            {upscaling ? (
              <Button size="sm" variant="ghost" onClick={() => gen.cancel()} aria-label="Cancelar ampliação">
                <X /> Cancelar
              </Button>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void upscale()}
                disabled={blocked}
                data-testid="image-upscale-run"
              >
                <Maximize2 /> Ampliar {st.upscale.scale}×
              </Button>
            )}
          </div>
          {upscaling ? (
            <p
              role="status"
              className="flex items-center gap-1.5 text-xs text-fg-muted"
              data-testid="image-upscale-running"
            >
              <Spinner className="size-3.5" /> Ampliando… tarefas assíncronas do provedor podem levar até dois minutos.
            </p>
          ) : null}
          {st.upscale.costPrompt ? (
            <div role="alert" className="grid gap-1.5 rounded-md bg-warning-soft/60 p-2 text-xs">
              <span>{st.upscale.costPrompt}</span>
              <span className="flex gap-1.5">
                <Button size="xs" variant="primary" onClick={() => void upscale({ confirmCost: true })}>
                  Confirmar e ampliar
                </Button>
                <Button size="xs" variant="ghost" onClick={() => setUpscale({ costPrompt: null })}>
                  Cancelar
                </Button>
              </span>
            </div>
          ) : null}
          {st.upscale.error ? (
            <div
              role="alert"
              className="grid gap-1.5 rounded-md bg-danger-soft p-2 text-xs text-danger"
              data-testid="image-upscale-error"
            >
              <span className="flex items-start gap-1.5">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {st.upscale.error.message}
              </span>
              {st.upscale.error.alternatives.length ? (
                <span className="flex flex-wrap gap-1.5">
                  {st.upscale.error.alternatives.map((a) => (
                    <Button
                      key={`${a.provider}:${a.model}`}
                      size="xs"
                      variant="secondary"
                      onClick={() => void upscale({ sel: { mode: "manual", provider: a.provider, model: a.model } })}
                    >
                      Usar {a.label} ({a.providerLabel})
                    </Button>
                  ))}
                </span>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {/* Resultados */}
      {st.result ? (
        <section className="grid gap-2" data-testid="image-generator-results">
          <div className="flex items-center justify-between gap-2">
            <H>Resultado</H>
            <Tooltip content="Descartar estes resultados (as imagens continuam em Arquivos)">
              <Button
                size="xs"
                variant="ghost"
                onClick={() => gen.set({ result: null, picked: null, status: "idle" })}
                aria-label="Descartar resultados"
              >
                <Trash2 /> Descartar
              </Button>
            </Tooltip>
          </div>
          <p className="text-[11px] text-fg-subtle">
            {st.result.images.length} imagem(ns) · {st.result.modelLabel} · {st.result.providerLabel} ·{" "}
            {st.result.ratio}
            {st.result.contextUsed ? " · com contexto" : ""}
          </p>
          {st.result.images.length > 1 ? (
            <ul className="grid grid-cols-3 gap-1.5">
              {st.result.images.map((img, i) => {
                const active = st.picked?.versionId === img.versionId;
                return (
                  <li key={img.versionId}>
                    <button
                      type="button"
                      aria-label={`Variação ${i + 1}`}
                      aria-pressed={active}
                      onClick={() =>
                        gen.set({ picked: { ...img, name: imageName(st.result!.prompt), origin: "result" } })
                      }
                      className={cn(
                        "relative block aspect-square w-full overflow-hidden rounded-md border bg-surface-2",
                        active ? "border-accent ring-2 ring-accent/40" : "border-border hover:border-accent",
                      )}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={img.src} alt="" className="size-full object-cover" />
                      {active ? (
                        <span className="absolute top-1 right-1 rounded-full bg-accent p-0.5 text-accent-fg">
                          <Check className="size-3" strokeWidth={3} />
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </section>
      ) : null}

      {st.picked ? (
        <PickedPreview
          picked={st.picked}
          orgSlug={orgSlug}
          where={pageCount > 1 ? `no slide ${pageIndex + 1}` : "na página"}
          canReplace={!!selectedImageId}
          busy={st.inserting}
          disabled={!canWrite}
          onInsert={(mode) => void insert(mode)}
          onClear={() => gen.set({ picked: null })}
        />
      ) : null}

      {/* Biblioteca de imagens geradas */}
      <section>
        <button
          type="button"
          onClick={toggleLibrary}
          aria-expanded={st.library.open}
          className="flex w-full items-center gap-1.5 text-left text-xs font-semibold text-fg-subtle uppercase hover:text-fg"
          data-testid="image-generator-library-toggle"
        >
          <Images className="size-3.5" /> Geradas anteriormente
          <span className="ml-auto text-[11px] font-normal normal-case">{st.library.open ? "Ocultar" : "Ver"}</span>
        </button>
        {st.library.open ? (
          <div className="mt-2 grid gap-2" data-testid="image-generator-library">
            {st.library.status === "error" ? (
              <p className="text-xs text-danger">
                {st.library.error}{" "}
                <button type="button" className="underline" onClick={() => void loadLibrary(1)}>
                  Tentar de novo
                </button>
              </p>
            ) : st.library.status === "loading" && !st.library.items.length ? (
              <p className="text-xs text-fg-muted">Carregando…</p>
            ) : st.library.items.length === 0 ? (
              <p className="text-xs text-fg-muted">
                Nenhuma imagem gerada por IA{" "}
                {design.clientId ? `para ${design.clientName ?? "este cliente"}` : "sem cliente"} ainda.
              </p>
            ) : (
              <ul className="grid grid-cols-3 gap-1.5">
                {st.library.items.map((it) => {
                  const active = st.picked?.versionId === it.versionId;
                  return (
                    <li key={it.versionId}>
                      <Tooltip content={`${it.prompt || it.name}${it.model ? ` · ${it.model}` : ""}`}>
                        <button
                          type="button"
                          aria-label={`Usar imagem gerada ${it.name}`}
                          aria-pressed={active}
                          onClick={() =>
                            gen.set({
                              picked: {
                                src: it.src,
                                width: it.width ?? 0,
                                height: it.height ?? 0,
                                name: it.prompt ? imageName(it.prompt) : it.name.slice(0, 60),
                                fileId: it.fileId,
                                versionId: it.versionId,
                                origin: "library",
                              },
                            })
                          }
                          className={cn(
                            "block aspect-square w-full overflow-hidden rounded-md border bg-surface-2",
                            active ? "border-accent ring-2 ring-accent/40" : "border-border hover:border-accent",
                          )}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={`${it.src}${it.hasThumbnail ? "?thumb=1" : ""}`}
                            alt=""
                            loading="lazy"
                            className="size-full object-cover"
                          />
                        </button>
                      </Tooltip>
                    </li>
                  );
                })}
              </ul>
            )}
            {st.library.hasMore ? (
              <Button
                size="xs"
                variant="ghost"
                loading={st.library.status === "loading"}
                onClick={() => void loadLibrary(st.library.page + 1)}
              >
                Carregar mais
              </Button>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}

/** Miniatura esquemática da proporção (caixa dentro de 24×24). */
function FormatGlyph({ ratio }: { ratio: Ratio | null }) {
  const r = ratio && ratio.w > 0 && ratio.h > 0 ? ratio.w / ratio.h : 1;
  const w = r >= 1 ? 22 : Math.max(8, Math.round(22 * r));
  const h = r >= 1 ? Math.max(8, Math.round(22 / r)) : 22;
  return (
    <span className="flex size-6 items-center justify-center" aria-hidden="true">
      <span className="rounded-[2px] border border-current" style={{ width: w, height: h }} />
    </span>
  );
}

/** Imagem escolhida ampliada + ações de inserção na página ativa. */
function PickedPreview({
  picked,
  orgSlug,
  where,
  canReplace,
  busy,
  disabled,
  onInsert,
  onClear,
}: {
  picked: PickedImage;
  orgSlug: string;
  where: string;
  canReplace: boolean;
  busy: boolean;
  disabled: boolean;
  onInsert: (mode: InsertImageMode) => void;
  onClear: () => void;
}) {
  const aspect = picked.width > 0 && picked.height > 0 ? `${picked.width} / ${picked.height}` : "1 / 1";
  return (
    <section
      className="grid gap-2 rounded-lg border border-border bg-surface-2/40 p-2"
      data-testid="image-generator-picked"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium">
          {picked.origin === "library" ? "Imagem da biblioteca" : "Imagem selecionada"}
        </span>
        <button type="button" className="text-fg-subtle hover:text-fg" onClick={onClear} aria-label="Fechar prévia">
          <X className="size-3.5" />
        </button>
      </div>
      <a href={picked.src} target="_blank" rel="noreferrer" aria-label="Abrir a imagem em tamanho real">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={picked.src}
          alt="Imagem gerada ampliada"
          className="max-h-64 w-full rounded-md border border-border bg-surface object-contain"
          style={{ aspectRatio: aspect }}
          data-testid="image-generator-preview"
        />
      </a>
      <p className="text-[11px] text-fg-subtle">
        {picked.width && picked.height ? `${picked.width}×${picked.height} px · ` : ""}
        Salva em{" "}
        <Link href={`/w/${orgSlug}/files/${picked.fileId}`} className="underline" target="_blank">
          Arquivos <ExternalLink className="inline size-3" />
        </Link>
      </p>
      <Button
        variant="accent"
        size="sm"
        className="w-full"
        loading={busy}
        disabled={disabled}
        onClick={() => onInsert("element")}
        data-testid="image-generator-insert"
      >
        <ImagePlus /> Inserir {where}
      </Button>
      <div className="grid grid-cols-2 gap-1.5">
        <Button
          size="xs"
          variant="secondary"
          disabled={disabled || busy}
          onClick={() => onInsert("background")}
          data-testid="image-generator-insert-background"
        >
          Como fundo
        </Button>
        <Tooltip
          content={canReplace ? "Troca a imagem selecionada mantendo a caixa" : "Selecione uma imagem no slide atual"}
        >
          <Button
            size="xs"
            variant="secondary"
            disabled={disabled || busy || !canReplace}
            onClick={() => onInsert("replace")}
            data-testid="image-generator-insert-replace"
          >
            Substituir selecionada
          </Button>
        </Tooltip>
      </div>
      <p className="text-[11px] text-fg-subtle">
        Depois de inserir, a imagem é uma camada comum: mova, redimensione, recorte e gire pelo editor.
      </p>
    </section>
  );
}
