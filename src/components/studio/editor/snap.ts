/*
 * Alinhamento magnético (cálculo puro, sem Fabric): aproxima a caixa que está
 * sendo movida das bordas e centros da página, de outros objetos, das guias e
 * da grade, e devolve as linhas a desenhar.
 */

export type SnapBox = { x: number; y: number; width: number; height: number };
export type SnapTarget = { value: number; from: SnapBox | null; kind: "edge" | "center" | "guide" | "grid" };
export type SnapLine = { axis: "x" | "y"; at: number; start: number; end: number };

export type SnapResult = { dx: number; dy: number; lines: SnapLine[] };

/** Linhas de referência a partir de caixas (bordas e centro) e guias. */
export function snapTargets(boxes: SnapBox[], guides: { v: number[]; h: number[] } = { v: [], h: [] }) {
  const x: SnapTarget[] = [];
  const y: SnapTarget[] = [];
  for (const b of boxes) {
    x.push(
      { value: b.x, from: b, kind: "edge" },
      { value: b.x + b.width / 2, from: b, kind: "center" },
      { value: b.x + b.width, from: b, kind: "edge" },
    );
    y.push(
      { value: b.y, from: b, kind: "edge" },
      { value: b.y + b.height / 2, from: b, kind: "center" },
      { value: b.y + b.height, from: b, kind: "edge" },
    );
  }
  for (const g of guides.v) x.push({ value: g, from: null, kind: "guide" });
  for (const g of guides.h) y.push({ value: g, from: null, kind: "guide" });
  return { x, y };
}

function bestOnAxis(edges: number[], targets: SnapTarget[], threshold: number) {
  let best: { delta: number; target: SnapTarget } | null = null;
  for (const t of targets) {
    for (const e of edges) {
      const d = t.value - e;
      if (Math.abs(d) <= threshold && (!best || Math.abs(d) < Math.abs(best.delta))) best = { delta: d, target: t };
    }
  }
  return best;
}

/**
 * Melhor ajuste em cada eixo (bordas e centro da caixa contra as referências),
 * dentro do limite (em unidades da página). `grid` > 0 também atrai para a grade.
 */
export function computeSnap(
  box: SnapBox,
  targets: { x: SnapTarget[]; y: SnapTarget[] },
  threshold: number,
  grid = 0,
  origin = { x: 0, y: 0 },
): SnapResult {
  const xs = [box.x, box.x + box.width / 2, box.x + box.width];
  const ys = [box.y, box.y + box.height / 2, box.y + box.height];
  const gx: SnapTarget[] = [];
  const gy: SnapTarget[] = [];
  if (grid > 0) {
    for (const e of [box.x, box.x + box.width])
      gx.push({ value: origin.x + Math.round((e - origin.x) / grid) * grid, from: null, kind: "grid" });
    for (const e of [box.y, box.y + box.height])
      gy.push({ value: origin.y + Math.round((e - origin.y) / grid) * grid, from: null, kind: "grid" });
  }
  const bx = bestOnAxis(xs, [...targets.x, ...gx], threshold);
  const by = bestOnAxis(ys, [...targets.y, ...gy], threshold);
  const dx = bx?.delta ?? 0;
  const dy = by?.delta ?? 0;
  const moved = { ...box, x: box.x + dx, y: box.y + dy };
  const lines: SnapLine[] = [];
  const pushLines = (axis: "x" | "y", hit: { target: SnapTarget } | null, all: SnapTarget[]) => {
    if (!hit || hit.target.kind === "grid") return;
    const at = hit.target.value;
    // Todas as referências na mesma coordenada entram na linha (fica claro o que alinhou).
    const same = all.filter((t) => Math.abs(t.value - at) < 0.01);
    let start = axis === "x" ? moved.y : moved.x;
    let end = axis === "x" ? moved.y + moved.height : moved.x + moved.width;
    for (const t of same) {
      if (!t.from) continue;
      start = Math.min(start, axis === "x" ? t.from.y : t.from.x);
      end = Math.max(end, axis === "x" ? t.from.y + t.from.height : t.from.x + t.from.width);
    }
    lines.push({ axis, at, start, end });
  };
  pushLines("x", bx, targets.x);
  pushLines("y", by, targets.y);
  return { dx, dy, lines };
}
