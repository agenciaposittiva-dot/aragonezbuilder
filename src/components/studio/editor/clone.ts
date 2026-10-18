import {
  newId,
  type DesignComponent,
  type DesignDocument,
  type DesignObject,
  type DesignOp,
  type DesignPage,
} from "@/lib/design-doc";

/*
 * Cópias com ids novos (colar, inserir template, inserir componente) e a
 * conversão dos ícones (SVG) em caminhos editáveis.
 */

export function reidentify(o: DesignObject, map: Map<string, string>, componentMap: Map<string, string>): DesignObject {
  const id = newId();
  map.set(o.id, id);
  if (o.type === "group") return { ...o, id, children: o.children.map((c) => reidentify(c, map, componentMap)) };
  if (o.type === "instance") return { ...o, id, componentId: componentMap.get(o.componentId) ?? o.componentId };
  return { ...o, id };
}

/**
 * Componentes usados pelos objetos copiados que ainda não existem no
 * documento de destino: operações para criá-los (com ids novos se o id já
 * estiver em uso por outro componente).
 */
export function componentsToBring(
  target: DesignDocument,
  objects: DesignObject[],
  available: DesignComponent[],
): { ops: DesignOp[]; map: Map<string, string> } {
  const used = new Set<string>();
  const walk = (list: DesignObject[]) => {
    for (const o of list) {
      if (o.type === "instance") {
        used.add(o.componentId);
        const comp = available.find((c) => c.id === o.componentId);
        if (comp) walk(comp.objects);
      }
      if (o.type === "group") walk(o.children);
    }
  };
  walk(objects);
  const map = new Map<string, string>();
  const ops: DesignOp[] = [];
  for (const id of used) {
    const comp = available.find((c) => c.id === id);
    const existing = target.components.find((c) => c.id === id);
    if (!comp) continue;
    if (existing && JSON.stringify(existing) === JSON.stringify(comp)) continue;
    const nextId = existing ? newId() : id;
    map.set(id, nextId);
  }
  for (const id of used) {
    const comp = available.find((c) => c.id === id);
    if (!comp || !map.has(id)) continue;
    const objectsMap = new Map<string, string>();
    ops.push({
      op: "addComponent",
      component: { ...comp, id: map.get(id)!, objects: comp.objects.map((o) => reidentify(o, objectsMap, map)) },
    });
  }
  return { ops, map };
}

/** Páginas de um template com ids novos, prontas para entrar na arte. */
export function pagesFromTemplate(
  target: DesignDocument,
  tpl: { pages: DesignPage[]; components: DesignComponent[] },
  at: number,
): DesignOp[] {
  const allObjects = tpl.pages.flatMap((p) => p.objects);
  const { ops, map } = componentsToBring(target, allObjects, tpl.components);
  const carousel = target.meta?.carousel ? target.pages[0] : null;
  const pages: DesignOp[] = tpl.pages.map((p, i) => {
    const idMap = new Map<string, string>();
    return {
      op: "addPage",
      index: at + i,
      page: {
        ...p,
        id: newId(),
        name: p.name,
        // Carrossel: as páginas novas seguem o tamanho das demais.
        ...(carousel ? { width: carousel.width, height: carousel.height } : {}),
        objects: p.objects.map((o) => reidentify(o, idMap, map)),
      },
    };
  });
  return [...ops, ...pages];
}

/* ------------------------------------------------------------------ */
/* Ícones                                                              */
/* ------------------------------------------------------------------ */

const n = (el: Element, a: string) => Number(el.getAttribute(a) ?? 0);

/** Converte os elementos de um SVG de ícone (traços) num único caminho. */
export function svgToPathData(svg: SVGSVGElement): string {
  const parts: string[] = [];
  const visit = (el: Element) => {
    switch (el.tagName.toLowerCase()) {
      case "path":
        parts.push(el.getAttribute("d") ?? "");
        break;
      case "line":
        parts.push(`M ${n(el, "x1")} ${n(el, "y1")} L ${n(el, "x2")} ${n(el, "y2")}`);
        break;
      case "polyline":
      case "polygon": {
        const pts = (el.getAttribute("points") ?? "")
          .trim()
          .split(/[\s,]+/)
          .map(Number);
        const seg: string[] = [];
        for (let i = 0; i + 1 < pts.length; i += 2) seg.push(`${i ? "L" : "M"} ${pts[i]} ${pts[i + 1]}`);
        if (el.tagName.toLowerCase() === "polygon") seg.push("Z");
        parts.push(seg.join(" "));
        break;
      }
      case "circle": {
        const cx = n(el, "cx");
        const cy = n(el, "cy");
        const r = n(el, "r");
        parts.push(`M ${cx - r} ${cy} A ${r} ${r} 0 1 0 ${cx + r} ${cy} A ${r} ${r} 0 1 0 ${cx - r} ${cy} Z`);
        break;
      }
      case "ellipse": {
        const cx = n(el, "cx");
        const cy = n(el, "cy");
        const rx = n(el, "rx");
        const ry = n(el, "ry");
        parts.push(`M ${cx - rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx + rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx - rx} ${cy} Z`);
        break;
      }
      case "rect": {
        const x = n(el, "x");
        const y = n(el, "y");
        const w = n(el, "width");
        const h = n(el, "height");
        const r = Math.min(n(el, "rx") || n(el, "ry"), w / 2, h / 2);
        parts.push(
          r
            ? `M ${x + r} ${y} L ${x + w - r} ${y} A ${r} ${r} 0 0 1 ${x + w} ${y + r} L ${x + w} ${y + h - r} A ${r} ${r} 0 0 1 ${x + w - r} ${y + h} L ${x + r} ${y + h} A ${r} ${r} 0 0 1 ${x} ${y + h - r} L ${x} ${y + r} A ${r} ${r} 0 0 1 ${x + r} ${y} Z`
            : `M ${x} ${y} L ${x + w} ${y} L ${x + w} ${y + h} L ${x} ${y + h} Z`,
        );
        break;
      }
      default:
        for (const c of Array.from(el.children)) visit(c);
    }
  };
  for (const c of Array.from(svg.children)) visit(c);
  return parts.filter(Boolean).join(" ");
}
