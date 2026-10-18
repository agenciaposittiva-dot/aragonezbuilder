/*
 * Ajuste de texto sem navegador: estima a largura média dos caracteres pela
 * família da fonte e quebra as linhas por palavra, como o editor faz. A
 * estimativa é conservadora (prefere sobrar espaço) porque o editor mede de
 * novo ao abrir e o texto cresce para baixo.
 */

/** Fator de altura de linha do Fabric (`_fontSizeMult`). */
export const FONT_SIZE_MULT = 1.13;

const CONDENSED = ["oswald", "anton", "bebas neue", "league gothic", "barlow condensed"];
const WIDE = ["montserrat", "poppins", "archivo black", "space grotesk", "raleway", "work sans", "manrope"];
const SERIF = ["playfair display", "dm serif display", "merriweather", "lora", "georgia"];

/** Largura média de um caractere em "em" para a fonte e o peso. */
export function charWidth(family: string, weight: number, uppercase = false) {
  const f = family.toLowerCase();
  let w = CONDENSED.includes(f) ? 0.44 : WIDE.includes(f) ? 0.6 : SERIF.includes(f) ? 0.55 : 0.56;
  if (weight >= 700) w *= 1.07;
  if (weight >= 800) w *= 1.03;
  if (uppercase) w *= 1.14;
  return w;
}

/** Quebra o texto em linhas pela largura disponível (por palavra). */
export function wrapLines(text: string, maxChars: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) {
      out.push("");
      continue;
    }
    let line = "";
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (next.length <= maxChars || !line) line = next;
      else {
        out.push(line);
        line = w;
      }
      // Palavra maior que a linha: quebra no meio (como o editor).
      while (line.length > maxChars && maxChars > 4) {
        out.push(line.slice(0, maxChars));
        line = line.slice(maxChars);
      }
    }
    out.push(line);
  }
  return out;
}

export type TextBox = {
  text: string;
  width: number;
  fontFamily: string;
  fontWeight: number;
  lineHeight: number;
  uppercase?: boolean;
  letterSpacing?: number;
};

export function measure(t: TextBox, fontSize: number) {
  const spacing = 1 + (t.letterSpacing ?? 0) / 1000;
  const per = fontSize * charWidth(t.fontFamily, t.fontWeight, t.uppercase) * spacing;
  const maxChars = Math.max(1, Math.floor(t.width / per));
  const lines = wrapLines(t.uppercase ? t.text.toUpperCase() : t.text, maxChars);
  // Mesma conta do Fabric (editor): cada linha ocupa corpo × 1,13 × entrelinha; a última, sem a entrelinha.
  const n = lines.length;
  return { lines: n, height: Math.ceil(fontSize * FONT_SIZE_MULT * (t.lineHeight * (n - 1) + 1) + 2) };
}

/**
 * Maior corpo (entre min e max) em que o texto cabe na altura. Se nem o
 * mínimo couber, devolve o mínimo e `overflow: true` (o chamador encurta o texto).
 */
export function fitText(t: TextBox, maxHeight: number, maxSize: number, minSize: number) {
  for (let size = Math.round(maxSize); size >= minSize; size -= size > 80 ? 4 : 2) {
    const m = measure(t, size);
    if (m.height <= maxHeight) return { fontSize: size, height: m.height, lines: m.lines, overflow: false };
  }
  const m = measure(t, minSize);
  return { fontSize: minSize, height: m.height, lines: m.lines, overflow: m.height > maxHeight };
}

/** Encurta na última frase/palavra inteira que caiba no limite de caracteres. */
export function shorten(text: string, max: number) {
  const t = text.trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const sentence = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  if (sentence > max * 0.5) return cut.slice(0, sentence + 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[,;:.\s-]+$/, "")}…`;
}
