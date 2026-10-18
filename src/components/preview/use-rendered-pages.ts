"use client";

import { useEffect, useState } from "react";
import { assetsOf, fontsOf, type DesignDocument } from "@/lib/design-doc";
import type { PreviewDesign } from "@/lib/preview-data";

/*
 * Desenha as páginas das artes salvas com o mesmo motor do editor (Scene),
 * numa área escondida e só para leitura. Assim a prévia mostra exatamente o
 * último salvamento — sem depender de uma exportação feita antes e sem criar
 * arquivos novos. Cada página vira uma imagem (blob) mantida em memória.
 */

export type RenderedPage = { url: string; blob: Blob; width: number; height: number };
export type RenderState = {
  pages: Map<string, RenderedPage>;
  loading: boolean;
  error: string | null;
  missingImages: number;
};

const MAX_SIDE = 1440;

const canvasBlob = (c: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error("Falha ao desenhar a página."))), "image/png"),
  );

function hasLegacy(doc: DesignDocument) {
  const walk = (list: DesignDocument["pages"][number]["objects"]): boolean =>
    list.some((o) => o.type === "fabric" || (o.type === "group" && walk(o.children)));
  return doc.pages.some((p) => walk(p.objects));
}

async function renderDesign(design: PreviewDesign, signal: { cancelled: boolean }) {
  const [fabric, { Scene }, { EditorStore }, { ensureFonts }, { loadImage }] = await Promise.all([
    import("fabric"),
    import("@/components/studio/editor/scene"),
    import("@/components/studio/editor/store"),
    import("@/components/studio/editor/fonts"),
    import("@/components/studio/editor/media"),
  ]);
  const doc = design.document;
  const [, images] = await Promise.all([
    ensureFonts(fontsOf(doc)),
    Promise.all(assetsOf(doc).map((a) => loadImage(a.src))),
  ]);
  const holder = document.createElement("div");
  holder.setAttribute("aria-hidden", "true");
  holder.style.cssText =
    "position:fixed;left:-10000px;top:0;width:800px;height:600px;overflow:hidden;visibility:hidden;";
  const el = document.createElement("canvas");
  holder.appendChild(el);
  document.body.appendChild(holder);
  const store = new EditorStore(doc);
  const scene = new Scene(el, fabric, store, { canWrite: false });
  const out = new Map<string, RenderedPage>();
  try {
    scene.setSize(800, 600);
    scene.sync();
    scene.refreshFonts(fontsOf(doc));
    // Objetos do formato antigo carregam de forma assíncrona: espera um pouco por eles.
    if (hasLegacy(doc)) {
      const until = Date.now() + 3000;
      while (Date.now() < until && !signal.cancelled) {
        const pending = scene.canvas.getObjects().some((o) => (o as unknown as { __pending?: boolean }).__pending);
        if (!pending) break;
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    for (const page of doc.pages) {
      if (signal.cancelled) break;
      const scale = Math.min(1, MAX_SIDE / Math.max(page.width, page.height));
      const c = scene.renderPage(page.id, scale, { background: "#ffffff" });
      const blob = await canvasBlob(c);
      out.set(`${design.id}:${page.id}`, {
        url: URL.createObjectURL(blob),
        blob,
        width: page.width,
        height: page.height,
      });
    }
  } finally {
    scene.dispose();
    holder.remove();
  }
  return { pages: out, missing: images.filter((i) => i.missing).length };
}

const EMPTY: RenderState = { pages: new Map(), loading: false, error: null, missingImages: 0 };
/** Imagens antigas continuam na tela até as novas ficarem prontas; depois são liberadas. */
const REVOKE_AFTER_MS = 60_000;

/** Imagens das páginas das artes (recalcula quando a arte salva muda). */
export function useRenderedPages(designs: PreviewDesign[]): RenderState {
  // A versão salva (id + data) decide quando desenhar de novo.
  const key = designs.map((d) => `${d.id}@${d.updatedAt}`).join("|");
  const [state, setState] = useState<RenderState & { key: string }>({ ...EMPTY, key: "" });

  useEffect(() => {
    if (!designs.length) return;
    const signal = { cancelled: false };
    const created: string[] = [];
    void (async () => {
      const all = new Map<string, RenderedPage>();
      let missing = 0;
      try {
        for (const d of designs) {
          const r = await renderDesign(d, signal);
          for (const [k, v] of r.pages) {
            all.set(k, v);
            created.push(v.url);
          }
          missing += r.missing;
          if (signal.cancelled) return;
          // Mostra as primeiras artes enquanto as seguintes ainda desenham (carrosséis longos).
          setState({ key, pages: new Map(all), loading: true, error: null, missingImages: missing });
        }
        if (!signal.cancelled) setState({ key, pages: all, loading: false, error: null, missingImages: missing });
      } catch (err) {
        console.error("[prévia] falha ao desenhar", err);
        if (!signal.cancelled) {
          setState({
            key,
            pages: all,
            loading: false,
            error: "Não foi possível desenhar a prévia desta arte. Abra no editor para conferir.",
            missingImages: missing,
          });
        }
      }
    })();
    return () => {
      signal.cancelled = true;
      setTimeout(() => created.forEach((u) => URL.revokeObjectURL(u)), REVOKE_AFTER_MS);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!designs.length) return EMPTY;
  // Desenho da versão anterior: continua visível, marcado como carregando.
  if (state.key !== key) return { pages: state.pages, loading: true, error: null, missingImages: state.missingImages };
  return state;
}
