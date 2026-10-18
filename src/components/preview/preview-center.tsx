"use client";

import {
  Copy,
  Download,
  Eye,
  Info,
  Minus,
  Monitor,
  PenLine,
  Plus,
  RefreshCw,
  Save,
  Send,
  Shield,
  Smartphone,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { useWorkspace } from "@/components/shell/workspace-context";
import { downloadBlob } from "@/components/studio/editor/media";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useOrgAction } from "@/hooks/use-action";
import { CONTENT_FORMATS, CONTENT_STATUS, type ContentFormat, type ContentStatus } from "@/lib/content";
import { aabbOf, locate } from "@/lib/design-doc";
import { formatDate, formatDateTime } from "@/lib/format";
import { runPreviewChecks, type CheckIssue } from "@/lib/preview-check";
import { checkInputOf, type PreviewData } from "@/lib/preview-data";
import {
  defaultPlacement,
  isNetworkKey,
  NETWORK_KEYS,
  placementsOf,
  SOCIAL_SPECS,
  type NetworkKey,
  type PlacementKey,
} from "@/lib/social-specs";
import { buildZip } from "@/lib/zip";
import { cn } from "@/lib/utils";
import {
  duplicateContentAction,
  savePreviewTargetAction,
  savePreviewTextsAction,
} from "@/server/actions/content-preview";
import type { AiPickerData } from "@/server/services/ai-models";
import { AiPanel } from "./ai-panel";
import { ApprovalPanel } from "./approval-panel";
import { ChecksPanel } from "./checks-panel";
import type { MediaItem } from "./frames";
import { PreviewStage, Thumbnails, VIEW_MODE_LABEL, type Device, type Highlight, type ViewMode } from "./preview-stage";
import { useRenderedPages } from "./use-rendered-pages";

const ZOOMS = [0.5, 0.67, 0.8, 1, 1.25, 1.5, 2];
const WIDE = "(min-width: 1280px)";
const subscribeWide = (cb: () => void) => {
  const m = window.matchMedia(WIDE);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};
type SideTab = "checks" | "caption" | "approval" | "ai" | "details";

/** Nome de arquivo sem acentos nem símbolos (alguns navegadores descartam nomes com acento). */
const fileSafe = (v: string) =>
  v
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9 -]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const parseTags = (v: string) =>
  v
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => (t.startsWith("#") ? t : `#${t}`))
    .slice(0, 30);

/**
 * Central de pré-visualização: a publicação simulada na rede escolhida, com
 * navegação entre páginas, legenda, verificação, aprovação e IA. Tudo vem dos
 * registros salvos (peça, artes, arquivos e rodadas de aprovação).
 */
export function PreviewCenter({ data, picker }: { data: PreviewData; picker: AiPickerData | null }) {
  const ws = useWorkspace();
  const router = useRouter();
  const w = `/w/${ws.orgSlug}`;
  const content = data.content;
  const firstSlide = data.slides[0];

  const savedNetwork: NetworkKey = isNetworkKey(content?.network) ? content.network : "instagram";
  const initialPlacement = (n: NetworkKey) =>
    defaultPlacement(n, {
      saved: n === savedNetwork ? content?.placement : null,
      contentFormat: content?.format,
      pages: data.slides.length,
      width: firstSlide?.width ?? 1080,
      height: firstSlide?.height ?? 1350,
    });
  const [network, setNetwork] = useState<NetworkKey>(savedNetwork);
  const [placement, setPlacement] = useState<PlacementKey>(() => initialPlacement(savedNetwork));
  const [index, setIndex] = useState(0);
  const [mode, setMode] = useState<ViewMode>("post");
  // Sem escolha da pessoa, o dispositivo acompanha a largura da tela.
  const [chosenDevice, setDevice] = useState<Device | null>(null);
  const wide = useSyncExternalStore(
    subscribeWide,
    () => window.matchMedia(WIDE).matches,
    () => false,
  );
  const device: Device = chosenDevice ?? (wide ? "desktop" : "mobile");
  const [zoom, setZoom] = useState(1);
  const [safeArea, setSafeArea] = useState(false);
  const [highlight, setHighlight] = useState<Highlight>(null);
  const [tab, setTab] = useState<SideTab>("checks");
  const savedTexts = {
    caption: content?.caption ?? "",
    hashtags: (content?.hashtags ?? []).join(" "),
    cta: content?.cta ?? "",
  };
  const savedKey = JSON.stringify(savedTexts);
  const [texts, setTexts] = useState(savedTexts);
  // Dados salvos mudaram (voltou do editor, salvou a legenda): a legenda local acompanha.
  const [syncedKey, setSyncedKey] = useState(savedKey);
  if (syncedKey !== savedKey) {
    setSyncedKey(savedKey);
    setTexts(savedTexts);
  }
  const stageRef = useRef<HTMLDivElement>(null);

  // Ao voltar para a aba (por exemplo, depois de editar a arte em outra aba), busca o último salvamento.
  useEffect(() => {
    let last = Date.now();
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - last > 5000) {
        last = Date.now();
        router.refresh();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [router]);

  const rendered = useRenderedPages(data.designs);
  const items: MediaItem[] = useMemo(
    () =>
      data.slides.map((s) =>
        s.kind === "page"
          ? {
              key: s.key,
              label: s.label,
              src: rendered.pages.get(s.key)?.url ?? null,
              kind: "image" as const,
              width: s.width,
              height: s.height,
            }
          : {
              key: s.key,
              label: s.label,
              src: `/api/files/${s.versionId}`,
              kind: s.mimeType.startsWith("video/") ? ("video" as const) : ("image" as const),
              width: s.width,
              height: s.height,
            },
      ),
    [data.slides, rendered.pages],
  );
  const safeIndex = Math.min(index, Math.max(0, items.length - 1));
  const current = data.slides[safeIndex];

  const draftTexts = useMemo(
    () => ({ caption: texts.caption, hashtags: parseTags(texts.hashtags), cta: texts.cta || null }),
    [texts],
  );
  const issues = useMemo(
    () => runPreviewChecks(checkInputOf(data, { network, placement }, draftTexts)),
    [data, network, placement, draftTexts],
  );
  const errors = issues.filter((i) => i.level === "error").length;
  const counts = useMemo(() => {
    const out: Record<string, { error: number; warning: number }> = {};
    for (const i of issues) {
      if (!i.slideKey) continue;
      const c = (out[i.slideKey] ??= { error: 0, warning: 0 });
      if (i.level === "error") c.error++;
      else if (i.level === "warning") c.warning++;
    }
    return out;
  }, [issues]);

  const net = SOCIAL_SPECS[network];
  const spec = net.placements[placement];
  const placements = placementsOf(network);
  const targetChanged =
    !!content && (network !== savedNetwork || placement !== (content.placement ?? initialPlacement(savedNetwork)));
  const textsChanged =
    !!content &&
    (texts.caption !== (content.caption ?? "") ||
      parseTags(texts.hashtags).join(" ") !== content.hashtags.join(" ") ||
      texts.cta !== (content.cta ?? ""));

  const saveTarget = useOrgAction(savePreviewTargetAction, { success: "Rede e formato salvos na peça" });
  const saveTexts = useOrgAction(savePreviewTextsAction, {
    success: "Legenda salva",
    onSuccess: () => router.refresh(),
  });
  const duplicate = useOrgAction(duplicateContentAction, {
    success: "Peça duplicada (cópia em rascunho)",
    onSuccess: (r) => router.push(`${w}/content/${r.id}/preview`),
  });

  const changeNetwork = (n: NetworkKey) => {
    setNetwork(n);
    if (!SOCIAL_SPECS[n].placements[placement]) setPlacement(initialPlacement(n));
    setHighlight(null);
  };

  const goTo = useCallback((i: number) => {
    setIndex(Math.max(0, i));
    setHighlight(null);
  }, []);

  const slideEditHref = (key: string, objectId?: string) => {
    const s = data.slides.find((x) => x.key === key);
    if (!s) return null;
    if (s.kind === "file") return `${w}/files/${s.fileId}`;
    if (!data.permissions.writeDesign) return `${w}/studio/${s.designId}`;
    const q = new URLSearchParams({ pagina: s.pageId });
    if (objectId) q.set("objeto", objectId);
    return `${w}/studio/${s.designId}?${q}`;
  };

  const showIssue = (issue: CheckIssue) => {
    const i = data.slides.findIndex((s) => s.key === issue.slideKey);
    if (i < 0) return;
    setIndex(i);
    const s = data.slides[i]!;
    if (issue.objectId && s.kind === "page") {
      const doc = data.designs.find((d) => d.id === s.designId)?.document;
      const loc = doc ? locate(doc, issue.objectId) : null;
      setHighlight(loc ? { slideKey: s.key, box: aabbOf(loc.object) } : null);
    } else setHighlight(null);
    if (mode === "strip") setMode("art");
    stageRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  async function exportImages(all: boolean) {
    const list = all ? data.slides : current ? [current] : [];
    try {
      const files: { name: string; data: Uint8Array }[] = [];
      for (const s of list) {
        let blob: Blob | null = null;
        let ext = "png";
        if (s.kind === "page") blob = rendered.pages.get(s.key)?.blob ?? null;
        else {
          const res = await fetch(`/api/files/${s.versionId}`);
          if (res.ok) blob = await res.blob();
          ext = s.mimeType.split("/")[1]?.replace("jpeg", "jpg").replace("quicktime", "mov") ?? "bin";
        }
        if (!blob) throw new Error("A prévia ainda está desenhando as páginas. Tente de novo em instantes.");
        const n = all ? data.slides.indexOf(s) + 1 : safeIndex + 1;
        files.push({
          name: `${String(n).padStart(2, "0")}-${fileSafe(s.label) || "pagina"}.${ext}`,
          data: new Uint8Array(await blob.arrayBuffer()),
        });
      }
      if (!files.length) return;
      const title = fileSafe(content?.title ?? data.design?.name ?? "") || "previa";
      if (files.length === 1) downloadBlob(new Blob([files[0]!.data as BlobPart]), `${title} - ${files[0]!.name}`);
      else downloadBlob(new Blob([buildZip(files) as BlobPart], { type: "application/zip" }), `${title}.zip`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao exportar.");
    }
  }

  const slideLabel = (pageId: string | null, designId: string) =>
    data.slides.find((s) => s.kind === "page" && s.designId === designId && s.pageId === pageId)?.label ?? "Página";

  const firstDesign = data.designs[0];
  const isVideoFormat = content?.format === "reels";
  const hasVideo = data.slides.some((s) => s.kind === "file" && s.mimeType.startsWith("video/"));
  const title = content?.title ?? data.design?.name ?? "Prévia";
  const statusLabel = content ? CONTENT_STATUS[content.status as ContentStatus] : null;

  return (
    <div className="grid gap-4">
      {/* Cabeçalho e ações */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-fg-muted">
            <Badge tone="info">
              <Eye className="size-3" aria-hidden /> Simulação
            </Badge>
            {statusLabel ? <span>{statusLabel}</span> : null}
            {content ? <span>· {CONTENT_FORMATS[content.format as ContentFormat]?.label.split(" (")[0]}</span> : null}
            {data.client ? <span>· {data.client.name}</span> : null}
            {content?.plannedDate ? <span>· planejado para {formatDate(content.plannedDate)}</span> : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {firstDesign ? (
            <Button asChild size="sm" variant="primary">
              <Link href={current?.kind === "page" ? slideEditHref(current.key)! : `${w}/studio/${firstDesign.id}`}>
                <PenLine /> Editar arte
              </Link>
            </Button>
          ) : null}
          {content ? (
            <Button asChild size="sm">
              <Link href={`${w}/content/${content.id}`}>Abrir conteúdo</Link>
            </Button>
          ) : null}
          {content && data.permissions.writeContent ? (
            <Button size="sm" onClick={() => void duplicate.run({ id: content.id })} loading={duplicate.pending}>
              <Copy /> Duplicar
            </Button>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" disabled={!items.length}>
                <Download /> Exportar
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuItem onSelect={() => void exportImages(false)}>Página atual (imagem)</DropdownMenuItem>
              {items.length > 1 ? (
                <DropdownMenuItem onSelect={() => void exportImages(true)}>
                  Todas as páginas (.zip, em ordem)
                </DropdownMenuItem>
              ) : null}
              {firstDesign ? (
                <DropdownMenuItem asChild>
                  <Link href={`${w}/studio/${firstDesign.id}`}>PDF, JPG ou Arquivos: exportar no editor</Link>
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
          {content && data.permissions.requestApproval ? (
            <Button size="sm" onClick={() => setTab("approval")}>
              <Send /> Aprovação
            </Button>
          ) : null}
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={() => router.refresh()}
            aria-label="Atualizar com o último salvamento"
          >
            <RefreshCw />
          </Button>
        </div>
      </div>

      {/* Controles da simulação */}
      <div
        className="flex flex-wrap items-end gap-x-3 gap-y-2 rounded-xl border border-border bg-surface p-3 shadow-xs"
        role="toolbar"
        aria-label="Controles da prévia"
      >
        <Field label="Rede" htmlFor="pv-network" className="w-36">
          <NativeSelect id="pv-network" value={network} onChange={(e) => changeNetwork(e.target.value as NetworkKey)}>
            {NETWORK_KEYS.map((k) => (
              <option key={k} value={k}>
                {SOCIAL_SPECS[k].label}
                {SOCIAL_SPECS[k].fidelity === "approximate" ? " (aproximada)" : ""}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Formato" htmlFor="pv-placement" className="w-48">
          <NativeSelect
            id="pv-placement"
            value={placement}
            onChange={(e) => {
              setPlacement(e.target.value as PlacementKey);
              setHighlight(null);
            }}
          >
            {placements.map(({ key, spec: s }) => (
              <option key={key} value={key}>
                {s.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
        {targetChanged && data.permissions.writeContent ? (
          <Button
            size="sm"
            onClick={() => void saveTarget.run({ contentId: content!.id, network, placement })}
            loading={saveTarget.pending}
          >
            <Save /> Salvar destino
          </Button>
        ) : null}
        <div className="grid gap-1.5">
          <span className="text-xs font-medium text-fg-muted" id="pv-mode-label">
            Visualização
          </span>
          <div
            className="inline-flex flex-wrap gap-0.5 rounded-lg border border-border bg-surface-2 p-0.5"
            role="radiogroup"
            aria-labelledby="pv-mode-label"
          >
            {(Object.keys(VIEW_MODE_LABEL) as ViewMode[])
              .filter((m) => m !== "strip" || items.length > 1)
              .map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={mode === m}
                  onClick={() => setMode(m)}
                  className={cn(
                    "h-7 rounded-md px-2.5 text-[13px] font-medium text-fg-muted hover:text-fg focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none",
                    mode === m && "bg-surface text-fg shadow-xs",
                  )}
                >
                  {VIEW_MODE_LABEL[m]}
                </button>
              ))}
          </div>
        </div>
        <div className="flex items-center gap-1" role="group" aria-label="Dispositivo">
          <Button
            size="icon-sm"
            variant={device === "mobile" ? "secondary" : "ghost"}
            aria-pressed={device === "mobile"}
            aria-label="Celular"
            onClick={() => setDevice("mobile")}
          >
            <Smartphone />
          </Button>
          <Button
            size="icon-sm"
            variant={device === "desktop" ? "secondary" : "ghost"}
            aria-pressed={device === "desktop"}
            aria-label="Computador"
            onClick={() => setDevice("desktop")}
          >
            <Monitor />
          </Button>
        </div>
        <div className="flex items-center gap-1" role="group" aria-label="Zoom">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Diminuir zoom"
            disabled={zoom <= ZOOMS[0]!}
            onClick={() => setZoom(ZOOMS[Math.max(0, ZOOMS.indexOf(zoom) - 1)]!)}
          >
            <Minus />
          </Button>
          <button
            type="button"
            className="w-12 text-center text-xs text-fg-muted tabular-nums hover:text-fg"
            onClick={() => setZoom(1)}
            aria-label="Zoom em 100%"
          >
            {Math.round(zoom * 100)}%
          </button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Aumentar zoom"
            disabled={zoom >= ZOOMS[ZOOMS.length - 1]!}
            onClick={() => setZoom(ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(zoom) + 1)]!)}
          >
            <Plus />
          </Button>
        </div>
        <Button
          size="sm"
          variant={safeArea ? "secondary" : "ghost"}
          aria-pressed={safeArea}
          onClick={() => setSafeArea((v) => !v)}
        >
          <Shield /> {spec?.safeArea ? "Áreas seguras" : "Margens"}
        </Button>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-3">
          <div className="flex flex-wrap gap-2 text-xs">
            {net.fidelity === "approximate" ? <Badge tone="warning">Simulação aproximada</Badge> : null}
            {net.notes.map((n) => (
              <span key={n} className="text-fg-muted">
                {n}
              </span>
            ))}
            {spec?.note ? <span className="text-fg-muted">{spec.note}</span> : null}
          </div>

          <section
            ref={stageRef}
            className="relative min-h-80 rounded-xl border border-border bg-surface-2 p-3 sm:p-6"
            aria-label="Prévia"
            data-testid="preview-stage"
            data-network={network}
            data-placement={placement}
          >
            {rendered.loading && data.designs.length ? (
              <span className="absolute top-3 right-3 text-xs text-fg-muted" role="status">
                Desenhando páginas…
              </span>
            ) : null}
            {rendered.error ? (
              <p className="mb-3 rounded-md bg-danger-soft px-3 py-2 text-xs text-danger" role="alert">
                {rendered.error}
              </p>
            ) : null}
            {rendered.missingImages ? (
              <p className="mb-3 rounded-md bg-warning-soft px-3 py-2 text-xs text-warning">
                {rendered.missingImages} imagem(ns) da arte não estão mais disponíveis na nuvem.
              </p>
            ) : null}
            {isVideoFormat && !hasVideo ? (
              <p className="mb-3 rounded-md bg-info-soft px-3 py-2 text-xs text-info">
                Reels: nenhum vídeo anexado a esta peça. A prévia mostra a arte de capa (se houver); o roteiro está no
                conteúdo.
              </p>
            ) : null}
            <PreviewStage
              network={network}
              placement={placement}
              items={items}
              index={safeIndex}
              onIndex={goTo}
              profile={{ name: data.client?.name ?? ws.orgName, avatarUrl: data.client?.avatarUrl ?? null }}
              caption={texts.caption}
              hashtags={draftTexts.hashtags}
              cta={draftTexts.cta}
              plannedDate={content?.plannedDate}
              hasCaption={!!content}
              mode={mode}
              device={device}
              zoom={zoom}
              safeArea={safeArea}
              highlight={highlight}
            />
            {spec?.kind === "stories" && mode === "post" ? (
              <p className="mt-3 text-center text-xs text-fg-muted">
                Enquetes, links e caixas de perguntas não fazem parte da arte: são adicionados no aplicativo da rede ao
                publicar e não são simulados aqui.
              </p>
            ) : null}
          </section>

          <Thumbnails
            items={items}
            index={safeIndex}
            onIndex={goTo}
            counts={counts}
            editHref={(it) => (data.permissions.writeDesign ? slideEditHref(it.key) : null)}
          />
          {data.designs.length ? (
            <p className="text-xs text-fg-muted">
              Mostrando o último salvamento das artes
              {data.designs.length === 1 ? ` (${formatDateTime(data.designs[0]!.updatedAt)})` : ""}. Ao salvar no
              editor, a prévia atualiza quando você volta para ela.
            </p>
          ) : null}
        </div>

        <aside className="min-w-0 rounded-xl border border-border bg-surface p-3 shadow-xs">
          <Tabs value={tab} onValueChange={(v) => setTab(v as SideTab)}>
            <TabsList className="mb-3 flex w-full flex-wrap justify-start">
              <TabsTrigger value="checks">
                Verificação
                {errors ? (
                  <span className="rounded bg-danger px-1 text-[10px] text-white" aria-label={`${errors} erro(s)`}>
                    {errors}
                  </span>
                ) : null}
              </TabsTrigger>
              <TabsTrigger value="caption">Legenda</TabsTrigger>
              <TabsTrigger value="approval">Aprovação</TabsTrigger>
              <TabsTrigger value="ai">IA</TabsTrigger>
              <TabsTrigger value="details">Detalhes</TabsTrigger>
            </TabsList>
            <TabsContent value="checks">
              <ChecksPanel
                issues={issues}
                onShow={showIssue}
                editHref={(i) =>
                  i.slideKey && data.permissions.writeDesign ? slideEditHref(i.slideKey, i.objectId) : null
                }
                onEditCaption={content ? () => setTab("caption") : undefined}
                networkLabel={net.label}
              />
            </TabsContent>
            <TabsContent value="caption">
              {content ? (
                <form
                  className="grid gap-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void saveTexts.run({
                      contentId: content.id,
                      caption: texts.caption,
                      hashtags: parseTags(texts.hashtags),
                      cta: texts.cta,
                    });
                  }}
                >
                  <fieldset disabled={!data.permissions.writeContent} className="grid gap-3">
                    <Field
                      label="Legenda"
                      htmlFor="pv-caption"
                      hint={`${texts.caption.length} de ${net.caption.max} caracteres · os primeiros ${net.caption.preview} aparecem antes de “mais”`}
                    >
                      <Textarea
                        id="pv-caption"
                        rows={7}
                        maxLength={4000}
                        value={texts.caption}
                        onChange={(e) => setTexts({ ...texts, caption: e.target.value })}
                      />
                    </Field>
                    <Field
                      label="Hashtags"
                      htmlFor="pv-tags"
                      hint={`${draftTexts.hashtags.length}${net.caption.hashtagsMax ? ` de ${net.caption.hashtagsMax}` : ""}`}
                    >
                      <Input
                        id="pv-tags"
                        value={texts.hashtags}
                        onChange={(e) => setTexts({ ...texts, hashtags: e.target.value })}
                      />
                    </Field>
                    <Field label="Chamada para ação" htmlFor="pv-cta">
                      <Input
                        id="pv-cta"
                        maxLength={300}
                        value={texts.cta}
                        onChange={(e) => setTexts({ ...texts, cta: e.target.value })}
                      />
                    </Field>
                  </fieldset>
                  <p className="text-xs text-fg-muted">
                    A prévia e a verificação usam o texto acima enquanto você digita.
                  </p>
                  {data.permissions.writeContent ? (
                    <div className="flex gap-2">
                      <Button
                        type="submit"
                        size="sm"
                        variant="primary"
                        disabled={!textsChanged}
                        loading={saveTexts.pending}
                      >
                        <Save /> Salvar legenda
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={!textsChanged}
                        onClick={() =>
                          setTexts({
                            caption: content.caption ?? "",
                            hashtags: content.hashtags.join(" "),
                            cta: content.cta ?? "",
                          })
                        }
                      >
                        Desfazer
                      </Button>
                    </div>
                  ) : null}
                </form>
              ) : (
                <p className="text-sm text-fg-muted">
                  Artes avulsas do Estúdio não têm legenda. Ligue a arte a um conteúdo para simular a publicação
                  completa.
                </p>
              )}
            </TabsContent>
            <TabsContent value="approval">
              {content ? (
                <ApprovalPanel data={data} errors={errors} slideLabel={slideLabel} />
              ) : (
                <div className="grid gap-2 text-sm text-fg-muted">
                  <p>A aprovação acontece nos arquivos exportados desta arte.</p>
                  {data.outputs.map((o) => (
                    <Link key={o.fileId} href={`${w}/files/${o.fileId}`} className="text-accent-text hover:underline">
                      {slideLabel(o.pageId, o.designId)}: abrir arquivo e aprovação
                    </Link>
                  ))}
                </div>
              )}
            </TabsContent>
            <TabsContent value="ai">
              <AiPanel
                contentId={content?.id ?? null}
                designId={data.design?.id ?? null}
                format={content?.format ?? null}
                network={network}
                placement={placement}
                picker={data.permissions.useAi ? picker : null}
                canWrite={data.permissions.writeContent && data.permissions.writeDesign}
                onShowPage={(label) => {
                  const i = data.slides.findIndex((s) => s.label === label);
                  if (i >= 0) goTo(i);
                }}
              />
            </TabsContent>
            <TabsContent value="details">
              <Details data={data} network={network} placement={placement} />
            </TabsContent>
          </Tabs>
        </aside>
      </div>
    </div>
  );
}

function Details({ data, network, placement }: { data: PreviewData; network: NetworkKey; placement: PlacementKey }) {
  const ws = useWorkspace();
  const w = `/w/${ws.orgSlug}`;
  const c = data.content;
  const approvals = data.outputs;
  const approvalSummary = !approvals.length
    ? "Sem páginas exportadas"
    : approvals.every((o) => o.client === "approved")
      ? "Aprovada pelo cliente"
      : approvals.some((o) => o.client === "changes_requested" || o.internal === "changes_requested")
        ? "Ajustes solicitados"
        : approvals.some((o) => o.client === "pending")
          ? "Aguardando o cliente"
          : approvals.some((o) => o.internal === "pending")
            ? "Em revisão interna"
            : approvals.every((o) => o.internal === "approved")
              ? "Revisão interna aprovada"
              : "Não enviada";
  const rows: [string, React.ReactNode][] = [
    [
      "Cliente",
      data.client ? (
        <Link href={`${w}/clients/${data.client.id}`} className="hover:underline">
          {data.client.name}
        </Link>
      ) : (
        "—"
      ),
    ],
    ["Campanha", c?.campaignName ?? "—"],
    [
      "Projeto",
      c?.projectId && c.projectName ? (
        <Link href={`${w}/projects/${c.projectId}`} className="hover:underline">
          {c.projectName}
        </Link>
      ) : (
        "—"
      ),
    ],
    [
      "Conteúdo",
      c ? (
        <Link href={`${w}/content/${c.id}`} className="hover:underline">
          {c.title}
        </Link>
      ) : (
        "Arte avulsa do Estúdio"
      ),
    ],
    [
      "Artes",
      data.designs.length ? (
        <span className="grid gap-0.5">
          {data.designs.map((d) => (
            <Link key={d.id} href={`${w}/studio/${d.id}`} className="hover:underline">
              {d.name} ({d.document.pages.length} pág.)
            </Link>
          ))}
        </span>
      ) : (
        "—"
      ),
    ],
    [
      "Arquivos",
      approvals.length ? (
        <span className="grid gap-0.5">
          {approvals.map((o) => (
            <Link key={`${o.fileId}-${o.pageId}`} href={`${w}/files/${o.fileId}`} className="truncate hover:underline">
              {o.name}
              {o.versionNumber ? ` · v${o.versionNumber}` : ""}
            </Link>
          ))}
        </span>
      ) : (
        "—"
      ),
    ],
    [
      "Formato e rede",
      `${SOCIAL_SPECS[network].placements[placement]?.label ?? placement} · ${SOCIAL_SPECS[network].label}`,
    ],
    ["Criado por", c?.createdByName ?? "—"],
    ["Aprovação", approvalSummary],
    [
      "Data planejada",
      c?.plannedDate ? (
        <Link href={`${w}/content?view=calendar&month=${c.plannedDate.slice(0, 7)}`} className="hover:underline">
          {formatDate(c.plannedDate)}
        </Link>
      ) : (
        "—"
      ),
    ],
    ["Status", c ? CONTENT_STATUS[c.status as ContentStatus] : "—"],
  ];
  return (
    <div className="grid gap-3">
      <dl className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-[13px]" data-testid="preview-details">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-fg-muted">{k}</dt>
            <dd className="min-w-0 break-words">{v}</dd>
          </div>
        ))}
      </dl>
      {c && (c.status === "scheduled" || c.status === "published") ? (
        <p className="flex gap-2 rounded-lg bg-surface-2 px-3 py-2 text-xs text-fg-muted">
          <Info className="size-4 shrink-0" aria-hidden /> A plataforma ainda não está conectada às redes: a prévia
          mostra a peça salva, não a publicação real nem métricas.
        </p>
      ) : null}
      <p className="text-xs text-fg-muted">
        Versões das artes ficam no histórico do editor; versões e decisões de aprovação ficam em cada arquivo.
      </p>
    </div>
  );
}
