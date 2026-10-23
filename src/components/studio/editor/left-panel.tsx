"use client";

import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Award,
  BadgePercent,
  Calendar,
  Camera,
  Check,
  Circle,
  Clock,
  Coffee,
  Component,
  CreditCard,
  Flame,
  Gift,
  Globe,
  Heart,
  Hexagon,
  House,
  ImagePlus,
  Images,
  Layers,
  LayoutTemplate,
  Leaf,
  Mail,
  MapPin,
  MessageCircle,
  Minus,
  Music,
  Palette,
  PanelLeftClose,
  Phone,
  Play,
  Plus,
  Quote,
  RefreshCw,
  Search,
  ShoppingBag,
  ShoppingCart,
  Smile,
  Sparkles,
  Square,
  Star,
  Store,
  Sun,
  Tag,
  ThumbsUp,
  Trash2,
  Triangle,
  Trophy,
  Truck,
  User,
  Users,
  X,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/tooltip";
import { useWorkspace } from "@/components/shell/workspace-context";
import { colorsOf, locate, newId, type TextObject } from "@/lib/design-doc";
import { cn } from "@/lib/utils";
import {
  designImagesAction,
  designTemplatesAction,
  duplicateDesignAction,
  templatePagesAction,
} from "@/server/actions/designs";
import type { EditorActions, EditorBrand, ShapeKind } from "./actions";
import { pagesFromTemplate } from "./clone";
import { ensureFont } from "./fonts";
import { PagesAndLayers } from "./layers";
import { useEditor, type EditorStore } from "./store";

export type LeftTab = "add" | "layers" | "brand" | "media" | "components" | "templates";

// Ordem da referência (modelos primeiro, camadas por último); "Adicionar" reúne texto, elementos e ícones.
export const LEFT_TABS: { key: LeftTab; label: string; icon: typeof Plus }[] = [
  { key: "templates", label: "Modelos", icon: LayoutTemplate },
  { key: "add", label: "Adicionar", icon: Plus },
  { key: "media", label: "Fotos", icon: Images },
  { key: "brand", label: "Marca", icon: Palette },
  { key: "components", label: "Componentes", icon: Component },
  { key: "layers", label: "Camadas", icon: Layers },
];

export type PanelProps = {
  store: EditorStore;
  actions: EditorActions;
  brand: EditorBrand;
  canWrite: boolean;
  design: { id: string; clientId: string | null; clientName: string | null; isTemplate: boolean };
  canManageTemplates: boolean;
  onPickImage: () => void;
  /** Fecha o painel (no celular) depois de inserir algo. */
  onDone?: () => void;
  /** No celular: abre outro painel (componentes, modelos) a partir do painel Adicionar. */
  onNavigate?: (tab: LeftTab) => void;
};

/**
 * Trilho de ícones + conteúdo do painel. Recolhido (botão no cabeçalho do painel),
 * só o trilho fica (48 px) e o canvas ganha o espaço; qualquer ícone reabre.
 */
export function LeftPanel(
  props: PanelProps & {
    tab: LeftTab;
    onTab: (t: LeftTab) => void;
    collapsed?: boolean;
    onCollapsedChange?: (collapsed: boolean) => void;
  },
) {
  const { tab, onTab, collapsed = false, onCollapsedChange } = props;
  const current = LEFT_TABS.find((t) => t.key === tab)!;
  return (
    <div className="flex min-h-0 flex-1">
      <nav
        className={cn("flex w-12 shrink-0 flex-col items-center gap-1 py-2", !collapsed && "border-r border-border")}
        aria-label="Painéis do editor"
      >
        {LEFT_TABS.map(({ key, label, icon: Icon }) => {
          const active = tab === key && !collapsed;
          return (
            <Tooltip key={key} content={label} side="right">
              <button
                type="button"
                aria-label={label}
                aria-pressed={active}
                onClick={() => {
                  onTab(key);
                  if (collapsed) onCollapsedChange?.(false);
                }}
                className={cn(
                  "inline-flex size-9 items-center justify-center rounded-lg [&_svg]:size-[18px]",
                  active ? "bg-accent-soft text-fg" : "text-fg-muted hover:bg-surface-2 hover:text-fg",
                )}
              >
                <Icon />
              </button>
            </Tooltip>
          );
        })}
      </nav>
      {collapsed ? null : (
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-10 shrink-0 items-center justify-between border-b border-border pr-1.5 pl-3.5 text-sm font-semibold">
            {current.label}
            {onCollapsedChange ? (
              <Tooltip content="Recolher painel (o canvas ganha o espaço)">
                <button
                  type="button"
                  aria-label="Recolher painel"
                  data-testid="toggle-left-panel"
                  onClick={() => onCollapsedChange(true)}
                  className="inline-flex size-7 items-center justify-center rounded-md text-fg-muted hover:bg-surface-2 hover:text-fg [&_svg]:size-4"
                >
                  <PanelLeftClose />
                </button>
              </Tooltip>
            ) : null}
          </div>
          <div className="min-h-0 flex-1 scrollbar-thin overflow-y-auto p-3.5">
            <PanelBody {...props} tab={tab} />
          </div>
        </div>
      )}
    </div>
  );
}

export function PanelBody(props: PanelProps & { tab: LeftTab }) {
  switch (props.tab) {
    case "add":
      return <AddPanel {...props} />;
    case "layers":
      return <PagesAndLayers store={props.store} actions={props.actions} canWrite={props.canWrite} />;
    case "brand":
      return <BrandPanel {...props} />;
    case "media":
      return <MediaPanel {...props} />;
    case "components":
      return <ComponentsPanel {...props} />;
    case "templates":
      return <TemplatesPanel {...props} />;
  }
}

const H = ({ children }: { children: React.ReactNode }) => (
  <h3 className="mb-2 text-xs font-semibold text-fg-subtle uppercase">{children}</h3>
);

/* ------------------------------------------------------------------ */
/* Adicionar                                                           */
/* ------------------------------------------------------------------ */

const SHAPES: [ShapeKind, typeof Square, string][] = [
  ["rect", Square, "Retângulo"],
  ["rounded", Square, "Arredondado"],
  ["ellipse", Circle, "Círculo"],
  ["triangle", Triangle, "Triângulo"],
  ["polygon", Hexagon, "Polígono"],
  ["star", Star, "Estrela"],
  ["line", Minus, "Linha"],
];

const ICONS: [string, typeof Heart][] = [
  ["Coração", Heart],
  ["Estrela", Star],
  ["Confirmado", Check],
  ["Fechar", X],
  ["Seta direita", ArrowRight],
  ["Seta esquerda", ArrowLeft],
  ["Seta para cima", ArrowUp],
  ["Seta para baixo", ArrowDown],
  ["Brilho", Sparkles],
  ["Raio", Zap],
  ["Chama", Flame],
  ["Prêmio", Award],
  ["Troféu", Trophy],
  ["Curtir", ThumbsUp],
  ["Conversa", MessageCircle],
  ["Citação", Quote],
  ["Sacola", ShoppingBag],
  ["Carrinho", ShoppingCart],
  ["Etiqueta", Tag],
  ["Desconto", BadgePercent],
  ["Presente", Gift],
  ["Cartão", CreditCard],
  ["Entrega", Truck],
  ["Loja", Store],
  ["Casa", House],
  ["Telefone", Phone],
  ["E-mail", Mail],
  ["Local", MapPin],
  ["Site", Globe],
  ["Agenda", Calendar],
  ["Relógio", Clock],
  ["Pessoa", User],
  ["Pessoas", Users],
  ["Sorriso", Smile],
  ["Sol", Sun],
  ["Folha", Leaf],
  ["Café", Coffee],
  ["Câmera", Camera],
  ["Música", Music],
  ["Play", Play],
];

function AddPanel({ actions, onPickImage, onDone, onNavigate }: PanelProps) {
  const done = () => onDone?.();
  return (
    <div className="grid gap-5">
      {onNavigate ? (
        <div className="grid grid-cols-3 gap-1.5">
          {(
            [
              ["media", "Fotos", Images],
              ["components", "Componentes", Component],
              ["templates", "Modelos", LayoutTemplate],
            ] as const
          ).map(([k, label, Icon]) => (
            <button
              key={k}
              type="button"
              onClick={() => onNavigate(k)}
              className="flex flex-col items-center gap-1 rounded-md border border-border px-1 py-2 text-[11px] hover:bg-surface-2"
            >
              <Icon className="size-4" />
              {label}
            </button>
          ))}
        </div>
      ) : null}
      <section>
        <H>Texto</H>
        <div className="grid gap-1.5">
          <button
            type="button"
            onClick={() => {
              actions.addText("title");
              done();
            }}
            className="rounded-md border border-border px-3 py-2 text-left text-lg font-bold hover:bg-surface-2"
          >
            Adicionar título
          </button>
          <button
            type="button"
            onClick={() => {
              actions.addText("subtitle");
              done();
            }}
            className="rounded-md border border-border px-3 py-2 text-left text-base hover:bg-surface-2"
          >
            Adicionar subtítulo
          </button>
          <button
            type="button"
            onClick={() => {
              actions.addText("body");
              done();
            }}
            className="rounded-md border border-border px-3 py-2 text-left text-sm hover:bg-surface-2"
          >
            Adicionar texto
          </button>
        </div>
      </section>
      <section>
        <H>Formas e linhas</H>
        <div className="grid grid-cols-4 gap-1.5">
          {SHAPES.map(([k, Icon, label]) => (
            <Tooltip key={k} content={label}>
              <button
                type="button"
                onClick={() => {
                  actions.addShape(k);
                  done();
                }}
                aria-label={`Adicionar ${label.toLowerCase()}`}
                className="flex aspect-square items-center justify-center rounded-md border border-border hover:bg-surface-2"
              >
                <Icon className={cn("size-5", k === "rounded" && "rounded-sm")} />
              </button>
            </Tooltip>
          ))}
        </div>
      </section>
      <section>
        <H>Imagem</H>
        <Button
          variant="secondary"
          className="w-full"
          onClick={() => {
            onPickImage();
          }}
        >
          <ImagePlus /> Enviar imagem
        </Button>
        <p className="mt-1.5 text-[11px] text-fg-subtle">
          A imagem vai para Arquivos (do cliente da arte). Imagens grandes são reduzidas para até 2048 px.
        </p>
      </section>
      <section>
        <H>Ícones</H>
        <div className="grid grid-cols-6 gap-1">
          {ICONS.map(([label, Icon]) => (
            <button
              key={label}
              type="button"
              title={label}
              aria-label={`Ícone ${label}`}
              onClick={(e) => {
                const svg = e.currentTarget.querySelector("svg");
                if (svg) actions.addIcon(svg, label);
                done();
              }}
              className="flex aspect-square items-center justify-center rounded-md border border-transparent text-fg-muted hover:border-border hover:bg-surface-2 hover:text-fg"
            >
              <Icon className="size-5" />
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[11px] text-fg-subtle">Ícones Lucide (licença ISC), editáveis como desenho.</p>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Marca                                                               */
/* ------------------------------------------------------------------ */

function BrandPanel({ store, actions, brand, design }: PanelProps) {
  const { orgSlug } = useWorkspace();
  const doc = useEditor(store, (s) => s.doc);
  const selection = useEditor(store, (s) => s.selection);
  const page = useEditor(store, (s) => s.activePage);
  const [swap, setSwap] = useState<string | null>(null);
  const selectedText = selection
    .map((id) => locate(doc, id)?.object)
    .filter((o): o is TextObject => o?.type === "text");
  const font = brand?.fonts[0]?.name || "Inter";
  const ink = brand?.colors[0]?.hex ?? "#121110";
  const used = colorsOf(doc, page.id)
    .filter((c) => /^#[0-9a-f]{6}$/i.test(c))
    .slice(0, 10);
  const presets = [
    { key: "h", label: "Estilo de destaque", size: 0.085, weight: 700 },
    { key: "s", label: "Estilo de apoio", size: 0.05, weight: 500 },
    { key: "b", label: "Estilo de corpo", size: 0.032, weight: 400 },
  ];
  const applyText = async (s: {
    fontFamily: string;
    fontSize: number;
    fontWeight: number;
    lineHeight?: number;
    letterSpacing?: number;
    color?: unknown;
  }) => {
    await ensureFont(s.fontFamily);
    if (selectedText.length) actions.setStyle(s as never);
  };
  return (
    <div className="grid gap-5">
      {!design.clientId ? (
        <p className="text-sm text-fg-muted">Vincule a arte a um cliente para usar as cores e fontes da marca.</p>
      ) : !brand || (!brand.colors.length && !brand.fonts.length) ? (
        <p className="text-sm text-fg-muted">
          Nenhuma cor ou fonte cadastrada para {design.clientName}.{" "}
          <Link href={`/w/${orgSlug}/clients/${design.clientId}/brand`} className="text-accent-text hover:underline">
            Cadastrar marca
          </Link>
        </p>
      ) : null}
      {brand?.colors.length ? (
        <section>
          <H>Cores de {design.clientName}</H>
          <div className="grid grid-cols-5 gap-2">
            {brand.colors.map((c) => (
              <Tooltip key={c.hex + c.name} content={`${c.name || "Cor"} ${c.hex} — clique para aplicar`}>
                <button
                  type="button"
                  onClick={() => actions.applyColor(c.hex)}
                  className="aspect-square rounded-md border border-border shadow-xs"
                  style={{ background: c.hex }}
                  aria-label={`Aplicar ${c.name || c.hex}`}
                />
              </Tooltip>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] text-fg-subtle">
            Com um elemento selecionado, aplica nele; sem seleção, no fundo da página.
          </p>
        </section>
      ) : null}
      {brand?.fonts.length ? (
        <section>
          <H>Fontes</H>
          <ul className="grid gap-1">
            {brand.fonts.map((f) => (
              <li key={f.name}>
                <button
                  type="button"
                  onClick={async () => {
                    await ensureFont(f.name);
                    if (selectedText.length) actions.setStyle({ fontFamily: f.name });
                    else actions.addText("title");
                  }}
                  className="w-full rounded-md border border-border px-3 py-2 text-left text-sm hover:bg-surface-2"
                  style={{ fontFamily: f.name }}
                >
                  {f.name}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <section>
        <H>Estilos de texto</H>
        <ul className="grid gap-1">
          {presets.map((p) => (
            <li key={p.key}>
              <button
                type="button"
                disabled={!selectedText.length}
                onClick={() =>
                  applyText({
                    fontFamily: font,
                    fontSize: Math.round(page.width * p.size),
                    fontWeight: p.weight,
                    color: ink,
                  })
                }
                className="w-full rounded-md border border-border px-3 py-1.5 text-left text-sm hover:bg-surface-2 disabled:opacity-50"
              >
                {p.label}
                <span className="block text-[11px] text-fg-subtle">
                  {font} · {Math.round(page.width * p.size)} px · {p.weight}
                </span>
              </button>
            </li>
          ))}
          {(doc.styles?.text ?? []).map((s) => (
            <li key={s.id} className="flex items-center gap-1">
              <button
                type="button"
                disabled={!selectedText.length}
                onClick={() => applyText(s)}
                className="min-w-0 flex-1 rounded-md border border-border px-3 py-1.5 text-left text-sm hover:bg-surface-2 disabled:opacity-50"
              >
                {s.name}
                <span className="block text-[11px] text-fg-subtle">
                  {s.fontFamily} · {s.fontSize} px · {s.fontWeight}
                </span>
              </button>
              <button
                type="button"
                aria-label={`Excluir estilo ${s.name}`}
                className="rounded p-1 text-fg-subtle hover:text-danger"
                onClick={() =>
                  store.dispatch(
                    [
                      {
                        op: "setStyles",
                        styles: { ...doc.styles, text: (doc.styles?.text ?? []).filter((x) => x.id !== s.id) },
                      },
                    ],
                    {
                      label: "Estilos",
                    },
                  )
                }
              >
                <Trash2 className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
        <Button
          size="xs"
          variant="secondary"
          className="mt-2"
          disabled={selectedText.length !== 1}
          onClick={() => {
            const t = selectedText[0]!;
            const name = `Estilo ${(doc.styles?.text?.length ?? 0) + 1}`;
            store.dispatch(
              [
                {
                  op: "setStyles",
                  styles: {
                    ...doc.styles,
                    text: [
                      ...(doc.styles?.text ?? []),
                      {
                        id: newId(),
                        name,
                        fontFamily: t.fontFamily,
                        fontSize: t.fontSize,
                        fontWeight: t.fontWeight,
                        lineHeight: t.lineHeight,
                        letterSpacing: t.letterSpacing,
                        color: t.color,
                      },
                    ],
                  },
                },
              ],
              { label: "Salvar estilo" },
            );
            toast.success(`${name} salvo nesta arte.`);
          }}
        >
          <Plus /> Salvar estilo do texto selecionado
        </Button>
      </section>
      {used.length && brand?.colors.length ? (
        <section>
          <H>Trocar cores pela paleta</H>
          <p className="mb-2 text-[11px] text-fg-subtle">
            Cores usadas nesta página. Escolha uma e a cor da marca que vai substituí-la.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {used.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setSwap(swap === c ? null : c)}
                className={cn("size-7 rounded-md border border-border", swap === c && "ring-2 ring-accent")}
                style={{ background: c }}
                aria-label={`Trocar a cor ${c}`}
              />
            ))}
          </div>
          {swap ? (
            <div className="mt-2 grid gap-1.5 rounded-md border border-border p-2">
              <span className="text-[11px] text-fg-subtle">Substituir {swap} por:</span>
              <div className="flex flex-wrap gap-1.5">
                {brand.colors.map((b) => (
                  <span key={b.hex} className="flex items-center gap-1">
                    <button
                      type="button"
                      className="size-6 rounded border border-border"
                      style={{ background: b.hex }}
                      aria-label={`Substituir por ${b.name || b.hex} nesta página`}
                      onClick={() => {
                        actions.changePalette(swap, b.hex, false);
                        setSwap(null);
                      }}
                    />
                  </span>
                ))}
              </div>
              <button
                type="button"
                className="justify-self-start text-[11px] text-accent-text hover:underline"
                onClick={() => {
                  const target = brand.colors[0]!.hex;
                  actions.changePalette(swap, target, true);
                  setSwap(null);
                }}
              >
                Aplicar a primeira cor da marca em todas as páginas
              </button>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Imagens da plataforma                                               */
/* ------------------------------------------------------------------ */

type ImageRow = {
  fileId: string;
  versionId: string;
  name: string;
  width: number | null;
  height: number | null;
  hasThumbnail: boolean;
  clientName: string | null;
};

function MediaPanel({ actions, design, onPickImage, onDone }: PanelProps) {
  const { orgSlug } = useWorkspace();
  const [scope, setScope] = useState<"client" | "all">(design.clientId ? "client" : "all");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<ImageRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const load = useCallback(
    async (p: number, query: string, sc: "client" | "all") => {
      const res = await designImagesAction(orgSlug, {
        clientId: sc === "client" ? design.clientId : null,
        q: query || undefined,
        page: p,
      }).catch(() => null);
      if (!res?.ok) {
        setError(res && !res.ok ? res.error : "Não foi possível carregar as imagens.");
        return;
      }
      setError(null);
      setTotal(res.data.total);
      setRows((cur) => (p === 1 ? res.data.rows : [...(cur ?? []), ...res.data.rows]));
    },
    [design.clientId, orgSlug],
  );
  useEffect(() => {
    const t = setTimeout(() => {
      setPage(1);
      void load(1, q, scope);
    }, 250);
    return () => clearTimeout(t);
  }, [load, q, scope]);
  return (
    <div className="grid gap-3">
      <Button variant="secondary" className="w-full" onClick={onPickImage}>
        <ImagePlus /> Enviar imagem
      </Button>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-fg-subtle" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar em Arquivos"
          aria-label="Buscar imagens"
          className="h-8 pl-8 text-sm"
        />
      </div>
      {design.clientId ? (
        <div className="flex gap-1 text-xs">
          {(
            [
              ["client", `De ${design.clientName ?? "cliente"}`],
              ["all", "Todas"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              aria-pressed={scope === k}
              onClick={() => setScope(k)}
              className={cn(
                "rounded-md border px-2 py-1",
                scope === k ? "border-accent bg-accent-soft" : "border-border text-fg-muted hover:bg-surface-2",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}
      {error ? (
        <p className="text-sm text-danger">
          {error}{" "}
          <button type="button" className="underline" onClick={() => void load(1, q, scope)}>
            <RefreshCw className="inline size-3" /> Tentar de novo
          </button>
        </p>
      ) : rows === null ? (
        <p className="text-sm text-fg-muted">Carregando…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-fg-muted">Nenhuma imagem encontrada.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-2" data-testid="image-library">
          {rows.map((r) => (
            <li key={r.versionId}>
              <button
                type="button"
                title={r.name}
                aria-label={`Inserir imagem ${r.name}`}
                onClick={() => {
                  void actions.addImageFromLibrary(r);
                  onDone?.();
                }}
                className="group relative block aspect-square w-full overflow-hidden rounded-md border border-border bg-surface-2 hover:border-accent"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/files/${r.versionId}${r.hasThumbnail ? "?thumb=1" : ""}`}
                  alt=""
                  loading="lazy"
                  className="size-full object-cover"
                />
                <span className="absolute inset-x-0 bottom-0 truncate bg-black/55 px-1.5 py-0.5 text-left text-[10px] text-white">
                  {r.name}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {rows && rows.length < total ? (
        <Button
          size="xs"
          variant="ghost"
          onClick={() => {
            const next = page + 1;
            setPage(next);
            void load(next, q, scope);
          }}
        >
          Carregar mais
        </Button>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Componentes                                                         */
/* ------------------------------------------------------------------ */

function ComponentsPanel({ store, actions, onDone }: PanelProps) {
  const doc = useEditor(store, (s) => s.doc);
  const selection = useEditor(store, (s) => s.selection);
  const usage = (id: string) => {
    let n = 0;
    const walk = (list: import("@/lib/design-doc").DesignObject[]) =>
      list.forEach((o) => {
        if (o.type === "instance" && o.componentId === id) n++;
        if (o.type === "group") walk(o.children);
      });
    doc.pages.forEach((p) => walk(p.objects));
    return n;
  };
  return (
    <div className="grid gap-3">
      <p className="text-xs text-fg-muted">
        Componentes são elementos reutilizáveis desta arte (logo com assinatura, selo, botão). Alterar o componente muda
        todas as cópias.
      </p>
      <Button size="sm" variant="secondary" disabled={!selection.length} onClick={actions.createComponent}>
        <Component /> Criar componente da seleção
      </Button>
      {doc.components.length === 0 ? (
        <p className="text-sm text-fg-muted">Nenhum componente ainda.</p>
      ) : (
        <ul className="grid gap-1.5">
          {doc.components.map((c) => {
            const n = usage(c.id);
            return (
              <li key={c.id} className="rounded-md border border-border p-2">
                <div className="flex items-center gap-2">
                  <Component className="size-4 shrink-0 text-accent-text" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{c.name}</span>
                  <span className="text-[11px] text-fg-subtle">{n} uso(s)</span>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  <Button
                    size="xs"
                    variant="secondary"
                    onClick={() => {
                      actions.insertComponent(c.id);
                      onDone?.();
                    }}
                  >
                    <Plus /> Inserir
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={!selection.length}
                    onClick={() => actions.updateComponentFromSelection(c.id)}
                  >
                    Atualizar com a seleção
                  </Button>
                  <Button
                    size="xs"
                    variant="danger-ghost"
                    disabled={n > 0}
                    onClick={() =>
                      store.dispatch([{ op: "removeComponent", id: c.id }], { label: "Excluir componente" })
                    }
                    aria-label={`Excluir componente ${c.name}`}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Modelos                                                             */
/* ------------------------------------------------------------------ */

type TemplateRow = {
  id: string;
  name: string;
  width: number;
  height: number;
  thumbnail: string | null;
  clientName: string | null;
};

function TemplatesPanel({ store, design, canManageTemplates, onDone }: PanelProps) {
  const { orgSlug } = useWorkspace();
  const [rows, setRows] = useState<TemplateRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    designTemplatesAction(orgSlug, { designId: design.id })
      .catch(() => null)
      .then((res) => {
        if (cancelled) return;
        if (res?.ok) setRows(res.data);
        else setError(res && !res.ok ? res.error : "Não foi possível carregar os modelos.");
      });
    return () => {
      cancelled = true;
    };
  }, [design.id, orgSlug]);
  const insert = async (t: TemplateRow) => {
    setBusy(t.id);
    const res = await templatePagesAction(orgSlug, { designId: design.id, templateId: t.id }).catch(() => null);
    setBusy(null);
    if (!res?.ok) return toast.error(res && !res.ok ? res.error : "Não foi possível inserir o modelo.");
    const at = store.doc.pages.findIndex((p) => p.id === store.activePageId) + 1;
    const ops = pagesFromTemplate(store.doc, res.data, at);
    const r = store.dispatch(ops, { label: "Inserir modelo" });
    const firstPage = ops.find((o) => o.op === "addPage");
    if (r && firstPage?.op === "addPage") store.setActivePage(firstPage.page.id);
    if (r) toast.success(`Páginas de "${t.name}" inseridas.`);
    onDone?.();
  };
  const saveAsTemplate = async () => {
    const res = await duplicateDesignAction(orgSlug, { id: design.id, asTemplate: true }).catch(() => null);
    if (res?.ok) toast.success("Template criado a partir desta arte (estado salvo no servidor).");
    else toast.error(res && !res.ok ? res.error : "Não foi possível salvar como template.");
  };
  return (
    <div className="grid gap-3">
      {canManageTemplates && !design.isTemplate ? (
        <Button size="sm" variant="secondary" onClick={() => void saveAsTemplate()}>
          <LayoutTemplate /> Salvar esta arte como template
        </Button>
      ) : null}
      <p className="text-xs text-fg-muted">
        Insere as páginas de um template da agência (ou do mesmo cliente) depois da página atual.
      </p>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {rows === null && !error ? <p className="text-sm text-fg-muted">Carregando…</p> : null}
      {rows?.length === 0 ? <p className="text-sm text-fg-muted">Nenhum template disponível para esta arte.</p> : null}
      <ul className="grid grid-cols-2 gap-2">
        {rows?.map((t) => (
          <li key={t.id}>
            <button
              type="button"
              disabled={busy === t.id}
              onClick={() => void insert(t)}
              title={t.name}
              aria-label={`Inserir modelo ${t.name}`}
              className="relative block w-full overflow-hidden rounded-md border border-border bg-surface-2 hover:border-accent disabled:opacity-60"
            >
              {t.thumbnail ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={t.thumbnail} alt="" className="aspect-square w-full object-contain" />
              ) : (
                <span className="flex aspect-square items-center justify-center p-2 text-[11px] text-fg-muted">
                  {t.name}
                </span>
              )}
              <span className="absolute inset-x-0 bottom-0 truncate bg-black/55 px-1.5 py-0.5 text-left text-[10px] text-white">
                {t.name}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
