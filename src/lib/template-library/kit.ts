import {
  ellipseObject,
  imageObject,
  pathObject,
  rectObject,
  textObject,
  type DesignObject,
  type ImageObject,
  type PathObject,
  type RectObject,
  type TextObject,
} from "@/lib/design-doc";

/*
 * Peças para montar os modelos da biblioteca com as mesmas medidas do editor.
 * O Fabric (motor do editor) usa 1,13 × tamanho da fonte por linha; a linha de
 * base da primeira linha fica a 0,879 × tamanho do topo da caixa. Com isso,
 * textos de tamanhos diferentes na mesma linha ficam alinhados pela base.
 */

const MULT = 1.13;
const round = (n: number) => Math.round(n * 10) / 10;

/** Topo da caixa para a primeira linha cair na linha de base pedida. */
export const topFor = (baseline: number, fontSize: number) => round(baseline - fontSize * MULT * 0.778);
/** Entrelinha (do editor) para a distância pedida entre linhas de base. */
export const lineHeightFor = (fontSize: number, pitch: number) => Math.round((pitch / (MULT * fontSize)) * 1000) / 1000;
/** Altura que o editor mede para um texto de `lines` linhas. */
export const textHeight = (fontSize: number, lineHeight: number, lines: number) =>
  round(fontSize * MULT * (lineHeight * (lines - 1) + 1));

/** Imagem de exemplo gerada na instalação (trocada pela pessoa com "Trocar imagem"). */
export type PlaceholderKind = "photo-dusk" | "photo-night" | "photo-light" | "avatar" | "object" | "block";
export type PlaceholderSpec = { kind: PlaceholderKind; width: number; height: number };
/** Fonte das imagens no momento da montagem: chave → "/api/files/<versão>". */
export type Placeholders = Record<string, string>;

type TextInput = Omit<Parameters<typeof textObject>[0], "height"> & { baseline: number; lines?: number };

/** Texto posicionado pela linha de base da primeira linha. */
export function text(o: TextInput): TextObject {
  const { baseline, lines, ...rest } = o;
  const fontSize = rest.fontSize ?? 48;
  const lineHeight = rest.lineHeight ?? 1.2;
  const n = lines ?? rest.text.split("\n").length;
  return textObject({ ...rest, y: topFor(baseline, fontSize), height: textHeight(fontSize, lineHeight, n) });
}

export function rect(o: Parameters<typeof rectObject>[0]): RectObject {
  return rectObject(o);
}

export function circle(o: Parameters<typeof ellipseObject>[0]): DesignObject {
  return ellipseObject(o);
}

export function path(o: Parameters<typeof pathObject>[0]): PathObject {
  return pathObject(o);
}

/** Imagem de exemplo que ocupa exatamente a caixa pedida. */
export function photo(
  o: { id: string; name: string; src: string; x: number; y: number; width: number; height: number } & Partial<
    Pick<ImageObject, "radius" | "stroke" | "strokeWidth">
  >,
): ImageObject {
  return imageObject({ ...o, naturalWidth: o.width, naturalHeight: o.height });
}

/** Ícone de verificado (selo azul com visto). */
export const VERIFIED_D =
  "M12 1.5l2.4 1.7 2.9-.2 1.1 2.7 2.5 1.5-.5 2.9 1.3 2.6-2 2.1-.1 2.9-2.8.8-1.6 2.4-2.8-.8-2.6 1.3-2.2-1.9-2.9.2-.9-2.8-2.4-1.6.6-2.8L1.6 12l1.6-2.4-.2-2.9 2.7-1.1 1.5-2.5 2.9.5z";
export const CHECK_D = "M7.5 12.3l3 3 6-6.3";
/** Seta para a direita (pílula do topo). */
export const ARROW_D = "M3 12h17M14 6l6 6-6 6";
/** Avião de papel (enviar), traço. */
export const SEND_D = "M21.5 2.5L10.5 13.5M21.5 2.5l-7 19-3.5-8-8-3.5 18.5-7.5z";
/** Marcador (salvar post), traço. */
export const BOOKMARK_D = "M18 21l-6-4.5L6 21V4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5z";
