/*
 * Cores e contraste (WCAG 2.1). Tudo em #rrggbb: as cores da marca chegam em
 * formatos variados e são normalizadas antes de entrar na direção de arte.
 */

export type Rgb = { r: number; g: number; b: number };

export function parseHex(input: string): Rgb | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(input.trim());
  if (!m) return null;
  let h = m[1]!;
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function normalizeHex(input: string | null | undefined): string | null {
  const c = input ? parseHex(input) : null;
  return c ? toHex(c) : null;
}

export function toHex({ r, g, b }: Rgb) {
  const p = (v: number) =>
    Math.round(Math.min(255, Math.max(0, v)))
      .toString(16)
      .padStart(2, "0");
  return `#${p(r)}${p(g)}${p(b)}`.toUpperCase();
}

function channel(v: number) {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex: string) {
  const c = parseHex(hex) ?? { r: 0, g: 0, b: 0 };
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

/** Razão de contraste WCAG (1 a 21). */
export function contrast(a: string, b: string) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Mistura `a` com `b` (t = 0 → a, 1 → b). */
export function mix(a: string, b: string, t: number) {
  const x = parseHex(a) ?? { r: 0, g: 0, b: 0 };
  const y = parseHex(b) ?? { r: 0, g: 0, b: 0 };
  return toHex({ r: x.r + (y.r - x.r) * t, g: x.g + (y.g - x.g) * t, b: x.b + (y.b - x.b) * t });
}

export const isDark = (hex: string) => luminance(hex) < 0.22;

/** Texto: grande (≥ 24 px normal ou ≥ 18,66 px negrito) pede 3:1; o resto, 4,5:1 (AA). */
export const minContrast = (fontSize: number, weight: number) =>
  fontSize >= 24 || (fontSize >= 18.66 && weight >= 700) ? 3 : 4.5;

/**
 * Primeira cor da lista com contraste suficiente sobre o fundo; se nenhuma
 * passar, escurece/clareia a preferida até passar (último recurso: preto ou branco).
 */
export function readable(bg: string, preferred: string[], min = 4.5): string {
  for (const c of preferred) if (contrast(c, bg) >= min) return c.toUpperCase();
  const base = preferred[0] ?? "#111111";
  const target = isDark(bg) ? "#FFFFFF" : "#000000";
  for (let t = 0.1; t <= 1.0001; t += 0.1) {
    const c = mix(base, target, t);
    if (contrast(c, bg) >= min) return c;
  }
  return target;
}

/** Variação de uma cor (mais clara em fundo escuro e vice-versa). */
export function shade(hex: string, amount: number) {
  return mix(hex, amount >= 0 ? "#FFFFFF" : "#000000", Math.abs(amount));
}

/** Saturação aproximada (0–1), para escolher a cor de destaque entre as da marca. */
export function saturation(hex: string) {
  const c = parseHex(hex) ?? { r: 0, g: 0, b: 0 };
  const max = Math.max(c.r, c.g, c.b) / 255;
  const min = Math.min(c.r, c.g, c.b) / 255;
  if (max === 0) return 0;
  return (max - min) / max;
}
