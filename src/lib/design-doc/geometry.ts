import type { DesignObject, GroupObject } from "./schema";

export type Point = { x: number; y: number };
export type Box = { x: number; y: number; width: number; height: number };

export const rad = (deg: number) => (deg * Math.PI) / 180;
export const deg = (r: number) => (r * 180) / Math.PI;

/** Rotação normalizada para (-180, 180]. */
export function normalizeRotation(d: number) {
  let r = d % 360;
  if (r > 180) r -= 360;
  if (r <= -180) r += 360;
  return Math.abs(r) < 1e-9 ? 0 : r;
}

export function rotatePoint(p: Point, center: Point, degrees: number): Point {
  if (!degrees) return { ...p };
  const a = rad(degrees);
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  return { x: center.x + dx * cos - dy * sin, y: center.y + dx * sin + dy * cos };
}

export const centerOf = (b: Box): Point => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

/** Os quatro cantos da caixa girada (sentido horário a partir do superior esquerdo). */
export function cornersOf(o: Box & { rotation?: number }): Point[] {
  const c = centerOf(o);
  const pts = [
    { x: o.x, y: o.y },
    { x: o.x + o.width, y: o.y },
    { x: o.x + o.width, y: o.y + o.height },
    { x: o.x, y: o.y + o.height },
  ];
  return o.rotation ? pts.map((p) => rotatePoint(p, c, o.rotation!)) : pts;
}

export function boxOfPoints(points: Point[]): Box {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 0, height: 0 };
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function unionBoxes(boxes: Box[]): Box {
  return boxOfPoints(
    boxes.flatMap((b) => [
      { x: b.x, y: b.y },
      { x: b.x + b.width, y: b.y + b.height },
    ]),
  );
}

/** Caixa alinhada aos eixos que envolve o objeto (grupos: a união dos filhos). */
export function aabbOf(o: DesignObject): Box {
  if (o.type === "group") return o.children.length ? unionBoxes(o.children.map(aabbOf)) : boxOf(o);
  return boxOfPoints(cornersOf(o));
}

export const boxOf = (o: Box): Box => ({ x: o.x, y: o.y, width: o.width, height: o.height });

export function intersects(a: Box, b: Box) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/** Recalcula a caixa do grupo a partir dos filhos (grupos não têm transformação própria). */
export function withGroupBox<T extends GroupObject>(g: T): T {
  if (!g.children.length) return g;
  const b = unionBoxes(g.children.map(aabbOf));
  if (g.x === b.x && g.y === b.y && g.width === b.width && g.height === b.height && g.rotation === 0) return g;
  return { ...g, x: round(b.x), y: round(b.y), width: round(b.width), height: round(b.height), rotation: 0 };
}

/** Desloca o objeto (e os filhos, se for grupo). */
export function translateObject<T extends DesignObject>(o: T, dx: number, dy: number): T {
  if (!dx && !dy) return o;
  if (o.type === "group") {
    return withGroupBox({
      ...o,
      x: o.x + dx,
      y: o.y + dy,
      children: o.children.map((c) => translateObject(c, dx, dy)),
    }) as T;
  }
  return { ...o, x: round(o.x + dx), y: round(o.y + dy) };
}

/**
 * Escala o objeto em relação a um ponto fixo, incorporando a escala nas
 * medidas (largura, altura, tamanho da fonte, raio) — o documento nunca guarda
 * fatores de escala. Escala não uniforme em objeto girado é aproximada nos
 * eixos do próprio objeto.
 */
export function scaleObject<T extends DesignObject>(o: T, sx: number, sy: number, origin: Point): T {
  if (sx === 1 && sy === 1) return o;
  const uniform = Math.abs(sx - sy) < 1e-6;
  if (o.type === "group") {
    return withGroupBox({ ...o, children: o.children.map((c) => scaleObject(c, sx, sy, origin)) }) as T;
  }
  const c = centerOf(o);
  const nc = { x: origin.x + (c.x - origin.x) * sx, y: origin.y + (c.y - origin.y) * sy };
  const a = rad(o.rotation);
  // Fatores ao longo dos eixos do objeto girado.
  const lx = Math.hypot(sx * Math.cos(a), sy * Math.sin(a));
  const ly = Math.hypot(sx * Math.sin(a), sy * Math.cos(a));
  const width = o.width * lx;
  const height = o.type === "line" ? o.height : o.height * ly;
  const next = {
    ...o,
    width: round(width),
    height: round(height),
    x: round(nc.x - width / 2),
    y: round(nc.y - height / 2),
  };
  if (next.type === "text" && uniform) {
    next.fontSize = round(next.fontSize * sx);
  }
  if ((next.type === "rect" || next.type === "image") && next.radius && uniform) next.radius = round(next.radius * sx);
  return next as T;
}

/** Gira o objeto em torno de um ponto (grupos: cada filho gira em torno do mesmo ponto). */
export function rotateObject<T extends DesignObject>(o: T, degrees: number, pivot: Point): T {
  if (!degrees) return o;
  if (o.type === "group") {
    return withGroupBox({ ...o, children: o.children.map((c) => rotateObject(c, degrees, pivot)) }) as T;
  }
  const c = rotatePoint(centerOf(o), pivot, degrees);
  return {
    ...o,
    x: round(c.x - o.width / 2),
    y: round(c.y - o.height / 2),
    rotation: round(normalizeRotation(o.rotation + degrees)),
  };
}

/**
 * Leva o objeto para uma nova caixa (posição/tamanho/rotação). Em grupos o
 * movimento, o redimensionamento e a rotação são aplicados aos filhos.
 */
export function setObjectBox<T extends DesignObject>(o: T, next: Partial<Box> & { rotation?: number }): T {
  if (o.type !== "group") {
    const out = { ...o } as T;
    if (next.x !== undefined) out.x = next.x;
    if (next.y !== undefined) out.y = next.y;
    if (next.width !== undefined) out.width = Math.max(0, next.width);
    if (next.height !== undefined) out.height = Math.max(0, next.height);
    if (next.rotation !== undefined) out.rotation = normalizeRotation(next.rotation);
    return out;
  }
  let g: DesignObject = o;
  const cur = boxOf(g);
  if (next.width !== undefined || next.height !== undefined) {
    const sx = next.width !== undefined && cur.width > 0 ? next.width / cur.width : 1;
    const sy = next.height !== undefined && cur.height > 0 ? next.height / cur.height : 1;
    g = scaleObject(g, sx, sy, { x: cur.x, y: cur.y });
  }
  if (next.rotation !== undefined && next.rotation !== 0) g = rotateObject(g, next.rotation, centerOf(boxOf(g)));
  const moved = boxOf(g);
  const dx = next.x !== undefined ? next.x - moved.x : 0;
  const dy = next.y !== undefined ? next.y - moved.y : 0;
  return translateObject(g, dx, dy) as T;
}
