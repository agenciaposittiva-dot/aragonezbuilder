"use client";

import {
  ArrowLeft,
  Download,
  Eye,
  History,
  ImagePlus,
  Keyboard,
  Layers,
  Maximize,
  MoreHorizontal,
  Palette,
  Plus,
  Redo2,
  Send,
  SlidersHorizontal,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { SaveIndicator } from "@/components/app/save-indicator";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Tooltip } from "@/components/ui/tooltip";
import { useWorkspace } from "@/components/shell/workspace-context";
import { outcomeFromAction, useAutosave } from "@/hooks/use-autosave";
import { clearLocalDraft, loadLocalDraft, type LocalDraft } from "@/lib/autosave/local-draft";
import { assetsOf, fontsOf, locate, readDesignDocument, type DesignDocument } from "@/lib/design-doc";
import { cn } from "@/lib/utils";
import {
  duplicateDesignAction,
  resolveDesignConflictAction,
  saveDesignAction,
  updateDesignMetaAction,
} from "@/server/actions/designs";
import { DesignConflictDialog, DesignHistory } from "../design-history";
import { createActions, type EditorBrand } from "./actions";
import { CanvasArea } from "./canvas-area";
import { downloadExport, sendExportToFiles, type ExportOptions } from "./export";
import { ExportDialog } from "./export-dialog";
import { ensureFonts } from "./fonts";
import { LeftPanel, PanelBody, type LeftTab } from "./left-panel";
import { loadImage } from "./media";
import { PropertiesPanel } from "./properties";
import type { Scene } from "./scene";
import { EditorStore, useEditor } from "./store";
import { useShortcuts, SHORTCUTS } from "./shortcuts";

export type EditorDesign = {
  id: string;
  name: string;
  width: number;
  height: number;
  document: Record<string, unknown>;
  revision: number;
  isTemplate: boolean;
  clientId: string | null;
  projectId: string | null;
  taskId: string | null;
  outputFileId: string | null;
  clientName: string | null;
};

type MobileSheet = null | "add" | "brand" | "layers" | "props" | "media" | "components" | "templates";

/**
 * Editor de artes do Estúdio: documento de várias páginas, camadas,
 * componentes, guias e exportação. Salvamento automático, recuperação de
 * rascunho, conflitos e versões reaproveitam a nuvem central.
 */
export function DesignEditor({
  design,
  brand,
  canWrite,
  canManageTemplates = false,
  focus,
}: {
  design: EditorDesign;
  brand: EditorBrand;
  canWrite: boolean;
  canManageTemplates?: boolean;
  /** Abre numa página (e camada) específica — atalho vindo da pré-visualização. */
  focus?: { pageId?: string; objectId?: string };
}) {
  const ws = useWorkspace();
  const initial = useMemo(() => readDesignDocument(design.document, design), [design]);
  const [store] = useState(() => new EditorStore(initial.doc));
  const [scene, setScene] = useState<Scene | null>(null);
  const sceneRef = useRef<Scene | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const revisionRef = useRef(design.revision);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sizeRef = useRef<{ width: number; height: number } | null>(null);
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<LeftTab>("add");
  const [mobileSheet, setMobileSheet] = useState<MobileSheet>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [conflictDismissed, setConflictDismissed] = useState(false);
  const [recovery, setRecovery] = useState<LocalDraft<unknown> | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState<"download" | "send" | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [name, setName] = useState(design.name);
  const [, setEditingText] = useState(false);

  const canUndo = useEditor(store, (s) => s.canUndo);
  const canRedo = useEditor(store, (s) => s.canRedo);
  const selection = useEditor(store, (s) => s.selection);
  const view = useEditor(store, (s) => s.view);

  const actions = useMemo(
    () =>
      createActions({
        store,
        scene: () => store.scene,
        orgSlug: ws.orgSlug,
        design: { id: design.id, name, clientId: design.clientId, projectId: design.projectId, taskId: design.taskId },
        brand,
      }),
    [store, ws.orgSlug, design.id, name, design.clientId, design.projectId, design.taskId, brand],
  );

  /* ---------------------------- salvamento ---------------------------- */

  /**
   * Um salvamento no servidor (documento inteiro + miniatura). O controle de
   * revisão recusa gravar sobre uma versão mais nova: vira "conflito".
   */
  const persist = useCallback(async () => {
    if (!canWrite) return { ok: true as const };
    const res = await saveDesignAction(ws.orgSlug, {
      id: design.id,
      revision: revisionRef.current,
      document: store.doc as unknown as Record<string, unknown>,
      thumbnail: sceneRef.current?.thumbnail() ?? undefined,
    }).catch(() => null);
    if (res?.ok) revisionRef.current = res.data.revision;
    return outcomeFromAction(res);
  }, [canWrite, design.id, store, ws.orgSlug]);

  const autosave = useAutosave({
    save: persist,
    enabled: canWrite,
    draft: { key: `design:${design.id}`, snapshot: () => store.doc, baseRevision: () => revisionRef.current },
  });
  const markDirty = autosave.markDirty;

  useEffect(() => {
    store.setHandlers({
      onChange: (reason) => {
        if (canWrite && (reason === "edit" || reason === "history")) markDirty();
      },
      onError: (m) => toast.error(m),
    });
    return () => store.setHandlers({ onChange: null, onError: null });
  }, [store, canWrite, markDirty]);

  /** Troca o documento inteiro (restauração, conflito, rascunho) sem contar como edição. */
  const replaceDocument = useCallback(
    async (raw: unknown) => {
      const { doc } = readDesignDocument(raw, design);
      await preload(doc);
      store.replaceDocument(doc);
      sceneRef.current?.refreshFonts(fontsOf(doc));
    },
    [design, store],
  );

  /* ---------------------------- inicialização ---------------------------- */

  const startScene = useCallback(
    async (size: { width: number; height: number }) => {
      sizeRef.current = size;
      if (sceneRef.current || !canvasRef.current) return;
      const [fabric, { Scene }] = await Promise.all([import("fabric"), import("./scene")]);
      if (sceneRef.current || !canvasRef.current) return;
      const missing = await preload(store.doc);
      const s = new Scene(canvasRef.current, fabric, store, {
        canWrite,
        onTextEditing: (v) => setEditingText(v),
      });
      s.brand = {
        ink: brand?.colors[0]?.hex ?? "#121110",
        accent: brand?.colors[1]?.hex ?? brand?.colors[0]?.hex ?? "#F4BF2F",
        font: brand?.fonts[0]?.name || "Inter",
      };
      s.setWorkspaceColor(getComputedStyle(document.documentElement).getPropertyValue("--surface-3").trim());
      sceneRef.current = s;
      store.attachScene(s);
      setScene(s);
      s.setSize(sizeRef.current!.width, sizeRef.current!.height);
      s.sync();
      s.fit(store.doc.meta?.carousel && store.doc.pages.length <= 4 ? "all" : "page");
      if (focus?.pageId && store.doc.pages.some((p) => p.id === focus.pageId)) {
        store.setActivePage(focus.pageId);
        if (focus.objectId && locate(store.doc, focus.objectId)) store.setSelection([focus.objectId]);
        s.fit(focus.objectId && store.selection.length ? "selection" : "page");
      }
      setReady(true);
      if (missing) toast.warning(`${missing} imagem(ns) desta arte não estão mais disponíveis na nuvem.`);
      for (const n of initial.notes) toast.info(n);
      if (process.env.NODE_ENV !== "production") {
        (window as unknown as { __designEditor?: unknown }).__designEditor = { store, scene: s };
      }

      // Alterações que ficaram só neste aparelho (aba fechada, queda de conexão): oferece recuperar.
      if (canWrite) {
        const draft = await loadLocalDraft<unknown>(`design:${design.id}`);
        if (draft?.data) {
          const local = readDesignDocument(draft.data, design).doc;
          if (JSON.stringify(local) !== JSON.stringify(store.doc)) setRecovery(draft);
          else void clearLocalDraft(`design:${design.id}`);
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    return () => {
      sceneRef.current?.dispose();
      sceneRef.current = null;
      store.attachScene(null);
    };
  }, [store]);

  // Tema claro/escuro: a cor da área de trabalho acompanha.
  useEffect(() => {
    const obs = new MutationObserver(() =>
      sceneRef.current?.setWorkspaceColor(
        getComputedStyle(document.documentElement).getPropertyValue("--surface-3").trim(),
      ),
    );
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
    return () => obs.disconnect();
  }, []);

  // Página ativa sempre à vista.
  const activePage = useEditor(store, (s) => s.activePageId);
  useEffect(() => {
    if (ready) scene?.revealPage(activePage);
  }, [activePage, ready, scene]);

  /* ---------------------------- conflito e histórico ---------------------------- */

  const showConflict = conflictOpen || (autosave.state.status === "conflict" && !conflictDismissed);

  const resolveConflict = async (strategy: "mine" | "theirs") => {
    const res = await resolveDesignConflictAction(ws.orgSlug, {
      designId: design.id,
      strategy,
      document: store.doc as unknown as Record<string, unknown>,
      thumbnail: sceneRef.current?.thumbnail() ?? null,
    }).catch(() => null);
    if (!res?.ok) {
      toast.error(res && !res.ok ? res.error : "Falha de conexão. Nada foi alterado; tente de novo.");
      return;
    }
    revisionRef.current = res.data.revision;
    if (strategy === "theirs") await replaceDocument(res.data.document);
    autosave.conflictResolved({ pending: false });
    setConflictOpen(false);
    setConflictDismissed(false);
    toast.success(
      strategy === "mine"
        ? `Suas alterações foram salvas. A outra versão ficou no histórico (versão ${res.data.keptVersion}).`
        : `Versão salva carregada. Suas alterações ficaram no histórico (versão ${res.data.keptVersion}).`,
    );
  };

  /** Antes de versionar, restaurar ou exportar: o servidor precisa ter o estado atual. */
  const flushOrWarn = async () => {
    if (!canWrite) return true;
    const st = await autosave.flush();
    if (st.status === "saved") return true;
    toast.error(
      st.status === "conflict"
        ? "Resolva o conflito de edição antes."
        : "As últimas alterações ainda não foram salvas. Verifique a conexão e tente de novo.",
    );
    return false;
  };

  /* ---------------------------- exportação ---------------------------- */

  const exportCtx = () => ({
    scene: sceneRef.current!,
    store,
    orgSlug: ws.orgSlug,
    design: {
      id: design.id,
      name,
      clientId: design.clientId,
      projectId: design.projectId,
      taskId: design.taskId,
      outputFileId: design.outputFileId,
    },
  });

  const doDownload = async (o: ExportOptions) => {
    if (!sceneRef.current) return;
    setExporting("download");
    try {
      await downloadExport(exportCtx(), o);
      setExportOpen(false);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setExporting(null);
    }
  };

  const doSend = async (o: ExportOptions) => {
    if (!sceneRef.current) return;
    setExporting("send");
    try {
      if (!(await flushOrWarn())) return;
      const r = await sendExportToFiles(exportCtx(), o);
      setExportOpen(false);
      const what =
        r.count > 1
          ? `${r.count} arquivos enviados para Arquivos`
          : r.newVersions
            ? "Nova versão enviada para Arquivos"
            : "Arte enviada para Arquivos";
      toast.success(what, {
        action: { label: "Abrir", onClick: () => window.open(`/w/${ws.orgSlug}/files/${r.fileId}`, "_self") },
      });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setExporting(null);
    }
  };

  /** Atalho do cabeçalho: todas as páginas em PNG para Arquivos. */
  const quickSend = () =>
    void doSend({ format: "png", pageIds: store.doc.pages.map((p) => p.id), scale: 1, quality: 0.92 });

  const rename = async () => {
    if (!canWrite || !name.trim() || name === design.name) return;
    const res = await updateDesignMetaAction(ws.orgSlug, {
      id: design.id,
      name: name.trim(),
      clientId: design.clientId,
      projectId: design.projectId,
      taskId: design.taskId,
    });
    if (!res.ok) toast.error(res.error);
  };

  const duplicateDesign = async (asTemplate: boolean) => {
    if (!(await flushOrWarn())) return;
    const res = await duplicateDesignAction(ws.orgSlug, { id: design.id, asTemplate }).catch(() => null);
    if (!res?.ok) return toast.error(res && !res.ok ? res.error : "Não foi possível duplicar.");
    toast.success(asTemplate ? "Template criado a partir desta arte." : "Cópia criada.", {
      action: { label: "Abrir", onClick: () => window.open(`/w/${ws.orgSlug}/studio/${res.data.id}`, "_self") },
    });
  };

  /* ---------------------------- teclado ---------------------------- */

  useShortcuts({
    store,
    scene: () => sceneRef.current,
    actions,
    canWrite,
    onSave: () => void autosave.flush(),
    onExport: () => setExportOpen(true),
    onHelp: () => setShortcutsOpen(true),
  });

  const pickImage = () => fileInputRef.current?.click();
  const openPanel = (t: LeftTab) => {
    if (typeof window !== "undefined" && window.innerWidth < 1024) setMobileSheet(t === "layers" ? "layers" : t);
    else setTab(t);
  };

  const panelProps = {
    store,
    actions,
    brand,
    canWrite,
    design: { id: design.id, clientId: design.clientId, clientName: design.clientName, isTemplate: design.isTemplate },
    canManageTemplates,
    onPickImage: pickImage,
  };

  const zoomPct = useSyncExternalStore(
    (fn) => (scene ? scene.onViewport(fn) : () => undefined),
    () => (scene ? Math.round(scene.zoom * 100) : 100),
    () => 100,
  );

  return (
    <div
      className="fixed inset-0 z-[var(--z-overlay)] flex flex-col bg-bg"
      data-editor-ready={ready ? "true" : "false"}
      data-testid="design-editor"
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void actions.addImageFromFile(f);
          e.target.value = "";
          setMobileSheet(null);
        }}
      />
      <header className="flex h-12 shrink-0 items-center gap-1.5 border-b border-border bg-surface px-2 sm:px-3">
        <Button variant="ghost" size="icon-sm" asChild aria-label="Voltar ao Estúdio">
          <Link href={`/w/${ws.orgSlug}/studio`}>
            <ArrowLeft />
          </Link>
        </Button>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => void rename()}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          readOnly={!canWrite}
          aria-label="Nome da arte"
          className="h-8 w-24 min-w-0 rounded-md border border-transparent bg-transparent px-2 text-sm font-medium hover:border-border focus:border-accent focus:outline-none sm:w-56"
        />
        {canWrite ? (
          <SaveIndicator
            state={autosave.state}
            onRetry={autosave.retry}
            onReview={() => setConflictOpen(true)}
            compact
          />
        ) : (
          <span className="hidden text-xs text-fg-subtle sm:inline">Somente leitura</span>
        )}
        <span className="min-w-0 flex-1" />
        {canWrite ? (
          <>
            <Tooltip content="Desfazer (Ctrl+Z)">
              <Button variant="ghost" size="icon-sm" onClick={store.undo} disabled={!canUndo} aria-label="Desfazer">
                <Undo2 />
              </Button>
            </Tooltip>
            <Tooltip content="Refazer (Ctrl+Shift+Z)">
              <Button variant="ghost" size="icon-sm" onClick={store.redo} disabled={!canRedo} aria-label="Refazer">
                <Redo2 />
              </Button>
            </Tooltip>
          </>
        ) : null}
        <Tooltip content="Histórico de versões">
          <Button variant="ghost" size="icon-sm" onClick={() => setHistoryOpen(true)} aria-label="Histórico de versões">
            <History />
          </Button>
        </Tooltip>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="hidden w-16 tabular-nums md:inline-flex"
              aria-label="Zoom e visualização"
            >
              {zoomPct}%
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuItem onSelect={() => scene?.zoomTo(scene.zoom * 1.25)}>
              <ZoomIn /> Aumentar zoom <span className="ml-auto text-[11px] text-fg-subtle">Ctrl +</span>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => scene?.zoomTo(scene.zoom / 1.25)}>
              <ZoomOut /> Diminuir zoom <span className="ml-auto text-[11px] text-fg-subtle">Ctrl −</span>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => scene?.fit("page")}>
              <Maximize /> Ajustar a página <span className="ml-auto text-[11px] text-fg-subtle">Shift 1</span>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => scene?.fit("all")}>Ver todas as páginas</DropdownMenuItem>
            <DropdownMenuItem disabled={!selection.length} onSelect={() => scene?.fit("selection")}>
              Ajustar à seleção <span className="ml-auto text-[11px] text-fg-subtle">Shift 2</span>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => scene?.zoomTo(1)}>
              100% <span className="ml-auto text-[11px] text-fg-subtle">Shift 0</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Precisão</DropdownMenuLabel>
            <DropdownMenuCheckboxItem
              checked={view.rulers}
              onCheckedChange={(v) => store.setView({ rulers: v === true })}
            >
              Réguas
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem checked={view.grid} onCheckedChange={(v) => store.setView({ grid: v === true })}>
              Grade
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem checked={view.snap} onCheckedChange={(v) => store.setView({ snap: v === true })}>
              Alinhamento magnético
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {canWrite ? (
          // Entre 1024 e 1280 px o painel de propriedades vira gaveta, para o canvas não ficar apertado.
          <Button
            variant="ghost"
            size="sm"
            className="hidden lg:inline-flex xl:hidden"
            onClick={() => setMobileSheet("props")}
          >
            <SlidersHorizontal /> Propriedades
          </Button>
        ) : null}
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setExportOpen(true)}
          disabled={!ready}
          className="hidden sm:inline-flex"
        >
          <Download /> Exportar
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Mais ações">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuItem className="sm:hidden" onSelect={() => setExportOpen(true)}>
              <Download /> Exportar…
            </DropdownMenuItem>
            {canWrite ? (
              <DropdownMenuItem onSelect={() => void duplicateDesign(false)}>Duplicar arte</DropdownMenuItem>
            ) : null}
            {canManageTemplates && !design.isTemplate ? (
              <DropdownMenuItem onSelect={() => void duplicateDesign(true)}>Salvar como template</DropdownMenuItem>
            ) : null}
            <DropdownMenuItem asChild>
              <Link href={`/w/${ws.orgSlug}/studio/${design.id}/preview`}>
                <Eye /> Visualizar publicação
              </Link>
            </DropdownMenuItem>
            {design.outputFileId ? (
              <DropdownMenuItem asChild>
                <Link href={`/w/${ws.orgSlug}/files/${design.outputFileId}`}>
                  Abrir arquivo exportado (aprovação e portal)
                </Link>
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setShortcutsOpen(true)}>
              <Keyboard /> Atalhos de teclado
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {canWrite && !design.isTemplate ? (
          <Button variant="primary" size="sm" onClick={quickSend} loading={exporting === "send"} disabled={!ready}>
            <Send /> <span className="hidden sm:inline">Enviar para Arquivos</span>
            <span className="sm:hidden">Enviar</span>
          </Button>
        ) : null}
      </header>
      {recovery ? (
        <div
          role="alert"
          className="flex flex-col gap-2 border-b border-warning/40 bg-warning-soft px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between"
        >
          <span>
            Há alterações desta arte que não chegaram ao servidor (guardadas neste aparelho às{" "}
            {new Date(recovery.savedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}).
          </span>
          <span className="flex shrink-0 gap-2">
            <Button
              size="xs"
              variant="secondary"
              onClick={() => {
                void clearLocalDraft(`design:${design.id}`);
                setRecovery(null);
              }}
            >
              Descartar
            </Button>
            <Button
              size="xs"
              variant="primary"
              onClick={async () => {
                const draft = recovery;
                setRecovery(null);
                await replaceDocument(draft.data);
                // Feitas sobre uma revisão antiga? O servidor acusa o conflito e a pessoa decide.
                if (draft.baseRevision !== null) revisionRef.current = draft.baseRevision;
                autosave.markDirty();
                void autosave.flush();
              }}
            >
              Recuperar alterações
            </Button>
          </span>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        {canWrite ? (
          <aside
            className="hidden w-[304px] shrink-0 flex-col border-r border-border bg-surface lg:flex"
            data-testid="editor-left-panel"
          >
            <LeftPanel {...panelProps} tab={tab} onTab={setTab} />
          </aside>
        ) : null}

        <CanvasArea
          store={store}
          scene={scene}
          actions={actions}
          canWrite={canWrite}
          canvasRef={canvasRef}
          onReady={(size) => void startScene(size)}
          onPickImage={pickImage}
          onComponents={() => openPanel("components")}
          ready={ready}
        />

        {canWrite ? (
          <aside
            className="hidden w-[288px] shrink-0 scrollbar-thin overflow-y-auto border-l border-border bg-surface xl:block"
            data-testid="properties-panel"
          >
            <PropertiesPanel store={store} actions={actions} brand={brand} onReplaceImage={pickImage} />
          </aside>
        ) : null}
      </div>

      {canWrite ? (
        <nav
          className="flex shrink-0 justify-around border-t border-border bg-surface px-1 py-1 lg:hidden"
          aria-label="Ferramentas"
        >
          {(
            [
              ["add", "Adicionar", Plus],
              ["brand", "Marca", Palette],
              ["props", "Editar", SlidersHorizontal],
              ["layers", "Camadas", Layers],
            ] as const
          ).map(([k, label, Icon]) => (
            <button
              key={k}
              type="button"
              onClick={() => setMobileSheet(k)}
              className={cn(
                "flex flex-col items-center gap-0.5 rounded-md px-3 py-1 text-[11px] text-fg-muted hover:text-fg",
                k === "props" && selection.length && "text-accent-text",
              )}
            >
              <Icon className="size-5" />
              {label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setMobileSheet("media")}
            className="flex flex-col items-center gap-0.5 rounded-md px-3 py-1 text-[11px] text-fg-muted"
          >
            <ImagePlus className="size-5" />
            Imagem
          </button>
        </nav>
      ) : null}

      <Sheet open={!!mobileSheet} onOpenChange={(o) => !o && setMobileSheet(null)}>
        <SheetContent side="right" width="sm" aria-describedby={undefined} className="max-w-[360px]">
          <SheetTitle className="border-b border-border px-4 py-3.5 text-sm font-semibold">
            {
              {
                add: "Adicionar",
                brand: "Marca",
                layers: "Camadas",
                props: "Editar",
                media: "Imagens",
                components: "Componentes",
                templates: "Modelos",
              }[mobileSheet ?? "add"]
            }
          </SheetTitle>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {mobileSheet === "props" ? (
              <PropertiesPanel store={store} actions={actions} brand={brand} onReplaceImage={pickImage} />
            ) : mobileSheet ? (
              <div className="p-4">
                <PanelBody
                  {...panelProps}
                  tab={mobileSheet}
                  onDone={() => setMobileSheet(null)}
                  onNavigate={(t) => setMobileSheet(t)}
                />
              </div>
            ) : null}
          </div>
        </SheetContent>
      </Sheet>

      <ExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        store={store}
        canSend={canWrite && !design.isTemplate}
        busy={exporting}
        onDownload={(o) => void doDownload(o)}
        onSend={(o) => void doSend(o)}
      />
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      <DesignHistory
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        designId={design.id}
        canWrite={canWrite}
        prepare={flushOrWarn}
        onRestored={async (r) => {
          revisionRef.current = r.revision;
          await replaceDocument(r.document);
          autosave.markSaved();
        }}
      />
      <DesignConflictDialog
        open={showConflict}
        onOpenChange={(v) => {
          setConflictOpen(v);
          if (!v) setConflictDismissed(true);
        }}
        onResolve={resolveConflict}
      />
    </div>
  );
}

/** Fontes e imagens prontas antes de desenhar (o texto é medido com a fonte real). */
async function preload(doc: DesignDocument) {
  const [, images] = await Promise.all([
    ensureFonts(fontsOf(doc)),
    Promise.all(assetsOf(doc).map((a) => loadImage(a.src))),
  ]);
  return images.filter((i) => i.missing).length;
}

function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Atalhos de teclado</DialogTitle>
          <DialogDescription>No Mac, use ⌘ no lugar de Ctrl.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <dl className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
            {SHORTCUTS.map(([keys, label]) => (
              <div key={keys} className="flex items-center justify-between gap-3 border-b border-border/60 py-1">
                <dt className="text-fg-muted">{label}</dt>
                <dd className="shrink-0 font-mono text-xs">{keys}</dd>
              </div>
            ))}
          </dl>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
