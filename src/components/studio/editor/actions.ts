"use client";

import { toast } from "sonner";
import {
  aabbOf,
  createPage,
  ellipseObject,
  fileSrc,
  imageObject,
  lineObject,
  locate,
  newId,
  pathObject,
  polygonObject,
  rectObject,
  textObject,
  triangleObject,
  unionBoxes,
  type DesignObject,
  type DesignOp,
  type Paint,
  type StylePatch,
} from "@/lib/design-doc";
import { componentsToBring, reidentify, svgToPathData } from "./clone";
import { ensureFont } from "./fonts";
import { dataUrlToBlob, fileToDataUrl, loadImage, uploadToFiles } from "./media";
import type { Scene } from "./scene";
import type { EditorStore } from "./store";

/*
 * Ações do editor (painéis, atalhos, menu de contexto): todas viram operações
 * no store — o desfazer, o salvamento automático e o chat futuro usam o mesmo caminho.
 */

export type EditorBrand = { colors: { name: string; hex: string }[]; fonts: { name: string }[] } | null;
export type EditorContext = {
  store: EditorStore;
  scene: () => Scene | null;
  orgSlug: string;
  design: { id: string; name: string; clientId: string | null; projectId: string | null; taskId: string | null };
  brand: EditorBrand;
};

const CLIPBOARD_PREFIX = "aragonez-design:";
let memoryClipboard: { objects: DesignObject[]; components: import("@/lib/design-doc").DesignComponent[] } | null =
  null;

const round = (n: number) => Math.round(n * 100) / 100;

export type TextKind = "title" | "subtitle" | "body";
export type ShapeKind = "rect" | "rounded" | "ellipse" | "triangle" | "polygon" | "star" | "line";

export function createActions(ctx: EditorContext) {
  const { store } = ctx;
  const brandInk = () => ctx.brand?.colors[0]?.hex ?? "#121110";
  const brandAccent = () => ctx.brand?.colors[1]?.hex ?? ctx.brand?.colors[0]?.hex ?? "#F4BF2F";
  const brandFont = () => ctx.brand?.fonts[0]?.name || "Inter";
  const page = () => store.activePage;

  /** Adiciona na página ativa e seleciona. */
  const add = (objects: DesignObject[], label?: string, extra: DesignOp[] = []) => {
    const p = page();
    const ops: DesignOp[] = [...extra, ...objects.map((object) => ({ op: "add" as const, pageId: p.id, object }))];
    const r = store.dispatch(ops, { select: objects.map((o) => o.id), label });
    ctx.scene()?.revealPage(p.id);
    return r;
  };

  const selected = () => store.selection.filter((id) => locate(store.doc, id));

  const actions = {
    store,

    addText(kind: TextKind) {
      const p = page();
      const size = Math.round({ title: 0.085, subtitle: 0.05, body: 0.032 }[kind] * p.width);
      const width = Math.round(p.width * (kind === "body" ? 0.6 : 0.75));
      const font = brandFont();
      const t = textObject({
        name: kind === "title" ? "Título" : kind === "subtitle" ? "Subtítulo" : "Texto",
        text:
          kind === "title"
            ? "Seu título aqui"
            : kind === "subtitle"
              ? "Subtítulo"
              : "Texto de apoio com a mensagem da peça.",
        width,
        fontSize: size,
        fontFamily: font,
        fontWeight: kind === "title" ? 700 : 400,
        color: brandInk(),
        textAlign: "center",
        lineHeight: 1.15,
      });
      t.x = round((p.width - width) / 2);
      t.y = round((p.height - t.height) / 2);
      add([t], "Adicionar texto");
      // A fonte carrega em paralelo; o texto é medido de novo quando ela chega.
      void ensureFont(font).then(() => ctx.scene()?.refreshFonts([font]));
    },

    addShape(kind: ShapeKind) {
      const p = page();
      const s = Math.round(Math.min(p.width, p.height) * 0.3);
      const fill = brandAccent();
      const base = { x: round((p.width - s) / 2), y: round((p.height - s) / 2), width: s, height: s, fill };
      let o: DesignObject;
      switch (kind) {
        case "rect":
          o = rectObject({ ...base, width: Math.round(s * 1.4), x: round((p.width - s * 1.4) / 2) });
          break;
        case "rounded":
          o = rectObject({
            ...base,
            width: Math.round(s * 1.4),
            x: round((p.width - s * 1.4) / 2),
            radius: Math.round(s / 8),
            name: "Retângulo arredondado",
          });
          break;
        case "ellipse":
          o = ellipseObject({ ...base, name: "Círculo" });
          break;
        case "triangle":
          o = triangleObject(base);
          break;
        case "polygon":
          o = polygonObject({ ...base, sides: 6, name: "Hexágono" });
          break;
        case "star":
          o = polygonObject({ ...base, sides: 5, innerRatio: 0.45, name: "Estrela" });
          break;
        case "line":
          o = lineObject({
            x: round((p.width - s * 1.5) / 2),
            y: round(p.height / 2),
            width: Math.round(s * 1.5),
            stroke: brandInk(),
            strokeWidth: Math.max(4, Math.round(s / 30)),
          });
          break;
      }
      add([o], "Adicionar forma");
    },

    /** Ícone (SVG de traços) vira um caminho editável na cor da marca. */
    addIcon(svg: SVGSVGElement, name: string) {
      const scene = ctx.scene();
      if (!scene) return;
      const d = svgToPathData(svg);
      if (!d) return;
      const tmp = new scene.fabric.Path(d) as unknown as {
        width: number;
        height: number;
        pathOffset: { x: number; y: number };
      };
      const w = Math.max(1, tmp.width);
      const h = Math.max(1, tmp.height);
      const p = page();
      const size = Math.round(Math.min(p.width, p.height) * 0.18);
      const k = size / Math.max(w, h);
      const o = pathObject({
        name,
        d,
        viewBox: [round(tmp.pathOffset.x - w / 2), round(tmp.pathOffset.y - h / 2), round(w), round(h)],
        width: round(w * k),
        height: round(h * k),
        x: round((p.width - w * k) / 2),
        y: round((p.height - h * k) / 2),
        fill: null,
        stroke: brandInk(),
        strokeWidth: round(2 * (size / 24)),
        lineCap: "round",
        lineJoin: "round",
      });
      add([o], "Adicionar ícone");
    },

    /**
     * A imagem vai para a nuvem (Arquivos, com o cliente e o projeto da arte) e
     * o documento guarda só a referência /api/files/<versão>.
     */
    async uploadImage(file: File): Promise<{ src: string; width: number; height: number } | null> {
      if (!file.type.startsWith("image/")) {
        toast.error("Escolha um arquivo de imagem.");
        return null;
      }
      if (file.size > 25 * 1024 * 1024) {
        toast.error("Imagem muito grande (máx. 25 MB).");
        return null;
      }
      const sending = toast.loading("Enviando imagem para a nuvem…");
      try {
        const reduced = await fileToDataUrl(file);
        const blob = dataUrlToBlob(reduced);
        const up = await uploadToFiles(new File([blob], file.name, { type: blob.type }), {
          orgSlug: ctx.orgSlug,
          category: "general",
          tags: "estudio",
          note: `Imagem usada na arte "${ctx.design.name}"`,
          clientId: ctx.design.clientId,
          projectId: ctx.design.projectId,
        });
        const src = fileSrc(up.versionId);
        const img = await loadImage(src);
        toast.dismiss(sending);
        return { src, width: img.el.naturalWidth, height: img.el.naturalHeight };
      } catch (err) {
        toast.error((err as Error).message, { id: sending });
        return null;
      }
    },

    async addImageFromFile(file: File) {
      const up = await actions.uploadImage(file);
      if (up) actions.placeImage(up.src, up.width, up.height, file.name.slice(0, 60));
    },

    async addImageFromLibrary(row: { versionId: string; name: string; width: number | null; height: number | null }) {
      const src = fileSrc(row.versionId);
      const img = await loadImage(src);
      if (img.missing) {
        toast.error("Não foi possível carregar esta imagem.");
        return;
      }
      actions.placeImage(src, img.el.naturalWidth, img.el.naturalHeight, row.name.slice(0, 60));
    },

    placeImage(src: string, naturalWidth: number, naturalHeight: number, name: string) {
      const p = page();
      const sel = selected();
      const target = sel.length === 1 ? locate(store.doc, sel[0]!)?.object : null;
      // Com uma imagem selecionada, troca a imagem mantendo o enquadramento.
      if (target?.type === "image") {
        store.dispatch([{ op: "replaceImage", id: target.id, src, naturalWidth, naturalHeight, fit: "fill" }], {
          label: "Trocar imagem",
        });
        return;
      }
      const img = imageObject({
        src,
        naturalWidth,
        naturalHeight,
        name,
        fitWithin: { width: p.width * 0.6, height: p.height * 0.6 },
      });
      img.x = round((p.width - img.width) / 2);
      img.y = round((p.height - img.height) / 2);
      add([img], "Adicionar imagem");
    },

    remove() {
      const ids = selected().filter((id) => !locate(store.doc, id)?.object.locked);
      if (ids.length) store.dispatch([{ op: "remove", ids }], { select: [] });
    },

    duplicate() {
      const ids = selected();
      if (!ids.length) return;
      const r = store.dispatch([{ op: "duplicate", ids }]);
      const applied = r?.applied[0];
      if (applied?.op === "duplicate" && applied.idMap)
        store.setSelection(ids.map((id) => applied.idMap![id]!).filter(Boolean));
    },

    async copy(cut = false) {
      const ids = selected();
      if (!ids.length) return;
      const objects = ids.map((id) => locate(store.doc, id)!.object);
      memoryClipboard = { objects, components: store.doc.components };
      try {
        await navigator.clipboard?.writeText(CLIPBOARD_PREFIX + JSON.stringify(memoryClipboard));
      } catch {
        /* sem permissão para a área de transferência do sistema: fica a cópia interna */
      }
      if (cut) actions.remove();
    },

    /** Cola elementos copiados (desta ou de outra arte), texto ou imagens da área de transferência. */
    async paste(data?: DataTransfer | null) {
      const file = data ? Array.from(data.files).find((f) => f.type.startsWith("image/")) : null;
      if (file) return actions.addImageFromFile(file);
      let text = data?.getData("text/plain") ?? null;
      if (text === null) {
        try {
          text = (await navigator.clipboard?.readText()) ?? null;
        } catch {
          text = null;
        }
      }
      let clip = memoryClipboard;
      if (text?.startsWith(CLIPBOARD_PREFIX)) {
        try {
          clip = JSON.parse(text.slice(CLIPBOARD_PREFIX.length));
        } catch {
          clip = memoryClipboard;
        }
      } else if (text && text.trim()) {
        const p = page();
        const t = textObject({
          text: text.trim().slice(0, 5000),
          width: Math.round(p.width * 0.6),
          fontSize: Math.round(p.width * 0.035),
          fontFamily: brandFont(),
          color: brandInk(),
        });
        t.x = round((p.width - t.width) / 2);
        t.y = round((p.height - t.height) / 2);
        return void add([t], "Colar texto");
      }
      if (!clip?.objects.length) return;
      const { ops, map } = componentsToBring(store.doc, clip.objects, clip.components);
      const idMap = new Map<string, string>();
      const p = page();
      // Mesma posição; se o original ainda está nesta página, desloca um pouco.
      const onPage = clip.objects.some((o) => locate(store.doc, o.id)?.pageId === p.id);
      const shift = onPage ? 24 : 0;
      const objects = clip.objects.map((o) => {
        const c = reidentify(o, idMap, map);
        return shift ? moveDeep(c, shift) : c;
      });
      add(objects, "Colar", ops);
    },

    selectAll() {
      const p = page();
      store.setSelection(p.objects.filter((o) => !o.locked && !o.hidden).map((o) => o.id));
    },

    group() {
      const ids = selected();
      if (ids.length < 2) return;
      const r = store.dispatch([{ op: "group", ids }]);
      const applied = r?.applied[0];
      if (applied?.op === "group" && applied.groupId) store.setSelection([applied.groupId]);
    },

    ungroup() {
      const ids = selected();
      const groups = ids.map((id) => locate(store.doc, id)?.object).filter((o) => o?.type === "group") as Extract<
        DesignObject,
        { type: "group" }
      >[];
      if (!groups.length) return;
      const children = groups.flatMap((g) => g.children.map((c) => c.id));
      store.dispatch(
        groups.map((g) => ({ op: "ungroup" as const, id: g.id })),
        { select: children },
      );
    },

    createComponent() {
      const ids = selected();
      if (!ids.length) return;
      const r = store.dispatch([{ op: "createComponent", ids }], { label: "Criar componente" });
      const applied = r?.applied[0];
      if (applied?.op === "createComponent") {
        store.setSelection([applied.instanceId!]);
        toast.success("Componente criado. Use-o de novo pelo painel Componentes.");
      }
    },

    insertComponent(componentId: string) {
      const comp = store.doc.components.find((c) => c.id === componentId);
      if (!comp) return;
      const p = page();
      const scale = Math.min(1, (p.width * 0.8) / comp.width, (p.height * 0.8) / comp.height);
      const w = round(comp.width * scale);
      const h = round(comp.height * scale);
      add(
        [
          {
            id: newId(),
            type: "instance",
            name: comp.name,
            componentId,
            x: round((p.width - w) / 2),
            y: round((p.height - h) / 2),
            width: w,
            height: h,
            rotation: 0,
            opacity: 1,
          },
        ],
        "Inserir componente",
      );
    },

    /** Redefine o componente a partir da instância desvinculada/selecionada (todas as instâncias mudam). */
    updateComponentFromSelection(componentId: string) {
      const ids = selected();
      const comp = store.doc.components.find((c) => c.id === componentId);
      if (!comp || !ids.length) return;
      const objects = ids.map((id) => locate(store.doc, id)!.object);
      const box = unionBoxes(objects.map(aabbOf));
      const map = new Map<string, string>();
      const children = objects.map((o) => moveDeep(reidentify(o, map, new Map()), -box.x, -box.y));
      store.dispatch(
        [
          {
            op: "replaceComponent",
            component: { ...comp, width: round(box.width), height: round(box.height), objects: children },
          },
        ],
        { label: "Atualizar componente" },
      );
      toast.success("Componente atualizado em todas as instâncias.");
    },

    detach() {
      const ids = selected().filter((id) => locate(store.doc, id)?.object.type === "instance");
      if (ids.length)
        store.dispatch(
          ids.map((id) => ({ op: "detachInstance" as const, id })),
          { label: "Desvincular componente" },
        );
    },

    reorder(to: "front" | "back" | "forward" | "backward") {
      const ids = selected();
      if (!ids.length) return;
      const ordered = to === "front" || to === "backward" ? ids : [...ids].reverse();
      store.dispatch(
        ordered.map((id) => ({ op: "reorder" as const, id, to })),
        { label: "Ordem das camadas" },
      );
    },

    align(edge: "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom") {
      const ids = selected();
      if (ids.length) store.dispatch([{ op: "align", ids, edge, to: ids.length === 1 ? "page" : "selection" }]);
    },

    distribute(axis: "horizontal" | "vertical") {
      const ids = selected();
      if (ids.length >= 3) store.dispatch([{ op: "distribute", ids, axis }]);
    },

    nudge(dx: number, dy: number) {
      const ids = selected().filter((id) => !locate(store.doc, id)?.object.locked);
      if (ids.length)
        store.dispatch([{ op: "move", ids, dx, dy }], { coalesce: `nudge:${ids.join(",")}`, label: "Mover" });
    },

    toggleHidden(id: string) {
      const o = locate(store.doc, id)?.object;
      if (!o) return;
      store.dispatch(
        [o.hidden ? { op: "update", id, set: {}, unset: ["hidden"] } : { op: "update", id, set: { hidden: true } }],
        {
          label: o.hidden ? "Mostrar" : "Ocultar",
          select: o.hidden ? store.selection : store.selection.filter((s) => s !== id),
        },
      );
    },

    toggleLocked(id: string) {
      const o = locate(store.doc, id)?.object;
      if (!o) return;
      store.dispatch(
        [o.locked ? { op: "update", id, set: {}, unset: ["locked"] } : { op: "update", id, set: { locked: true } }],
        {
          label: o.locked ? "Desbloquear" : "Bloquear",
        },
      );
    },

    rename(id: string, name: string) {
      const o = locate(store.doc, id)?.object;
      if (o && name.trim() && name !== o.name)
        store.dispatch([{ op: "update", id, set: { name: name.trim().slice(0, 120) } }], { label: "Renomear" });
    },

    setStyle(style: StylePatch, coalesce?: string) {
      const ids = selected();
      if (ids.length) store.dispatch([{ op: "setStyle", ids, style }], { coalesce, label: "Estilo" });
    },

    update(id: string, set: Record<string, unknown>, coalesce?: string, unset?: string[]) {
      store.dispatch([{ op: "update", id, set, unset }], { coalesce });
    },

    /** Cor da marca: no elemento selecionado (texto, forma ou linha) ou no fundo da página. */
    applyColor(hex: string) {
      if (selected().length) actions.setStyle({ fill: hex });
      else store.dispatch([{ op: "updatePage", id: page().id, set: { background: hex } }], { label: "Fundo" });
    },

    setBackground(paint: Paint, coalesce?: string) {
      store.dispatch([{ op: "updatePage", id: page().id, set: { background: paint } }], { coalesce, label: "Fundo" });
    },

    /* Páginas -------------------------------------------------------- */

    addPage(afterId?: string) {
      const doc = store.doc;
      const ref = doc.pages.find((p) => p.id === (afterId ?? store.activePageId)) ?? doc.pages[0]!;
      const index = doc.pages.indexOf(ref) + 1;
      const pg = createPage({
        width: ref.width,
        height: ref.height,
        name: `Página ${doc.pages.length + 1}`,
        background: ref.background,
      });
      store.dispatch([{ op: "addPage", page: pg, index }], { label: "Nova página" });
      store.setActivePage(pg.id);
      ctx.scene()?.revealPage(pg.id);
    },

    duplicatePage(id: string) {
      const r = store.dispatch([{ op: "duplicatePage", id }]);
      const applied = r?.applied[0];
      if (applied?.op === "duplicatePage" && applied.newPageId) {
        store.setActivePage(applied.newPageId);
        ctx.scene()?.revealPage(applied.newPageId);
      }
    },

    removePage(id: string) {
      if (store.doc.pages.length <= 1) return toast.error("A arte precisa de pelo menos uma página.");
      store.dispatch([{ op: "removePage", id }], { select: [] });
    },

    movePage(id: string, delta: number) {
      const i = store.doc.pages.findIndex((p) => p.id === id);
      const to = i + delta;
      if (i < 0 || to < 0 || to >= store.doc.pages.length) return;
      store.dispatch([{ op: "reorderPage", id, index: to }], { label: "Reordenar páginas" });
      ctx.scene()?.revealPage(id);
    },

    renamePage(id: string, name: string) {
      const p = store.doc.pages.find((x) => x.id === id);
      if (p && name.trim() && name !== p.name)
        store.dispatch([{ op: "updatePage", id, set: { name: name.trim().slice(0, 80) } }], {
          label: "Renomear página",
        });
    },

    /** Tamanho da página; no carrossel todas as páginas mudam juntas. */
    setPageSize(width: number, height: number) {
      const w = Math.round(Math.min(10_000, Math.max(16, width)));
      const h = Math.round(Math.min(10_000, Math.max(16, height)));
      const targets = store.doc.meta?.carousel ? store.doc.pages : [page()];
      store.dispatch(
        targets.map((p) => ({ op: "updatePage" as const, id: p.id, set: { width: w, height: h } })),
        { label: "Tamanho da página" },
      );
    },

    setCarousel(on: boolean) {
      const doc = store.doc;
      const first = doc.pages[0]!;
      const ops: DesignOp[] = [];
      if (on) {
        for (const p of doc.pages.slice(1)) {
          if (p.width !== first.width || p.height !== first.height)
            ops.push({ op: "updatePage", id: p.id, set: { width: first.width, height: first.height } });
        }
      }
      ops.push({ op: "setMeta", set: { carousel: on } });
      store.dispatch(ops, { label: on ? "Páginas conectadas" : "Páginas separadas" });
      ctx.scene()?.fit("all");
    },

    addGuide(axis: "v" | "h") {
      const p = page();
      const guides = { v: [...(p.guides?.v ?? [])], h: [...(p.guides?.h ?? [])] };
      guides[axis].push(axis === "v" ? Math.round(p.width / 2) : Math.round(p.height / 2));
      store.dispatch([{ op: "updatePage", id: p.id, set: { guides } }], { label: "Guias" });
    },

    setGuides(guides: { v: number[]; h: number[] }) {
      store.dispatch([{ op: "updatePage", id: page().id, set: { guides } }], { label: "Guias" });
    },

    changePalette(from: string, to: string, allPages: boolean) {
      if (from.toLowerCase() === to.toLowerCase()) return;
      const r = store.dispatch(
        [{ op: "changePalette", map: [{ from, to }], ...(allPages ? {} : { pageId: page().id }) }],
        { label: "Trocar cor" },
      );
      if (r) toast.success(r.diffs[0]!.summary);
    },
  };
  return actions;
}

export type EditorActions = ReturnType<typeof createActions>;

function moveDeep(o: DesignObject, dx: number, dy = dx): DesignObject {
  if (o.type === "group")
    return { ...o, x: o.x + dx, y: o.y + dy, children: o.children.map((c) => moveDeep(c, dx, dy)) };
  return { ...o, x: round(o.x + dx), y: round(o.y + dy) };
}
