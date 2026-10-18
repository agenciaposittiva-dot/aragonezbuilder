/**
 * Identificação do tipo real do arquivo pelos primeiros bytes ("magic bytes").
 * O tipo informado pelo navegador NÃO é confiável e nunca é usado sozinho.
 */

export type Sniffed = { mime: string; ext: string };

function startsWith(buf: Buffer, bytes: number[], offset = 0) {
  if (buf.length < offset + bytes.length) return false;
  return bytes.every((b, i) => buf[offset + i] === b);
}

function ascii(buf: Buffer, start: number, end: number) {
  return buf.subarray(start, Math.min(end, buf.length)).toString("latin1");
}

/** Arquivos ZIP podem ser documentos do Office (docx/xlsx/pptx). */
function sniffZip(buf: Buffer, name: string): Sniffed {
  const lower = name.toLowerCase();
  const head = ascii(buf, 0, Math.min(buf.length, 4096));
  const officeHint =
    head.includes("[Content_Types].xml") || head.includes("word/") || head.includes("xl/") || head.includes("ppt/");
  if (officeHint || /\.(docx|xlsx|pptx)$/.test(lower)) {
    if (lower.endsWith(".docx") || head.includes("word/"))
      return { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ext: "docx" };
    if (lower.endsWith(".xlsx") || head.includes("xl/"))
      return { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ext: "xlsx" };
    if (lower.endsWith(".pptx") || head.includes("ppt/"))
      return { mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", ext: "pptx" };
  }
  return { mime: "application/zip", ext: "zip" };
}

function isProbablyText(buf: Buffer) {
  const sample = buf.subarray(0, Math.min(buf.length, 4096));
  if (sample.includes(0)) return false;
  // Decodificável como UTF-8 sem caracteres de controle (exceto tab/quebras).
  const text = sample.toString("utf8");
  if (text.includes("�") && sample.length > 16) return false;
  return !/[\x00-\x08\x0E-\x1F]/.test(text);
}

export function sniffFileType(buf: Buffer, name = ""): Sniffed | null {
  const lower = name.toLowerCase();
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { mime: "image/png", ext: "png" };
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return { mime: "image/jpeg", ext: "jpg" };
  if (ascii(buf, 0, 6) === "GIF87a" || ascii(buf, 0, 6) === "GIF89a") return { mime: "image/gif", ext: "gif" };
  if (ascii(buf, 0, 4) === "RIFF" && ascii(buf, 8, 12) === "WEBP") return { mime: "image/webp", ext: "webp" };
  if (ascii(buf, 0, 4) === "RIFF" && ascii(buf, 8, 12) === "WAVE") return { mime: "audio/wav", ext: "wav" };
  if (ascii(buf, 0, 4) === "RIFF" && ascii(buf, 8, 12) === "AVI ") return { mime: "video/x-msvideo", ext: "avi" };
  if (ascii(buf, 4, 8) === "ftyp") {
    const brand = ascii(buf, 8, 12);
    if (brand === "avif" || brand === "avis") return { mime: "image/avif", ext: "avif" };
    if (brand === "heic" || brand === "heix" || brand === "mif1") return { mime: "image/heic", ext: "heic" };
    if (brand === "qt  ") return { mime: "video/quicktime", ext: "mov" };
    if (brand.startsWith("M4A")) return { mime: "audio/mp4", ext: "m4a" };
    return { mime: "video/mp4", ext: "mp4" };
  }
  if (startsWith(buf, [0x1a, 0x45, 0xdf, 0xa3])) return { mime: "video/webm", ext: "webm" };
  if (
    ascii(buf, 0, 3) === "ID3" ||
    startsWith(buf, [0xff, 0xfb]) ||
    startsWith(buf, [0xff, 0xf3]) ||
    startsWith(buf, [0xff, 0xf2])
  )
    return { mime: "audio/mpeg", ext: "mp3" };
  if (ascii(buf, 0, 4) === "OggS") return { mime: "audio/ogg", ext: "ogg" };
  if (ascii(buf, 0, 5) === "%PDF-") {
    // Arquivos .ai modernos são PDFs internamente.
    if (lower.endsWith(".ai")) return { mime: "application/postscript", ext: "ai" };
    return { mime: "application/pdf", ext: "pdf" };
  }
  if (ascii(buf, 0, 4) === "%!PS") return { mime: "application/postscript", ext: lower.endsWith(".ai") ? "ai" : "eps" };
  if (startsWith(buf, [0xc5, 0xd0, 0xd3, 0xc6])) return { mime: "application/postscript", ext: "eps" };
  if (ascii(buf, 0, 4) === "8BPS") return { mime: "image/vnd.adobe.photoshop", ext: "psd" };
  if (startsWith(buf, [0x50, 0x4b, 0x03, 0x04]) || startsWith(buf, [0x50, 0x4b, 0x05, 0x06]))
    return sniffZip(buf, name);
  if (startsWith(buf, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    if (lower.endsWith(".xls")) return { mime: "application/vnd.ms-excel", ext: "xls" };
    if (lower.endsWith(".ppt")) return { mime: "application/vnd.ms-powerpoint", ext: "ppt" };
    return { mime: "application/msword", ext: "doc" };
  }
  if (ascii(buf, 0, 4) === "wOFF") return { mime: "font/woff", ext: "woff" };
  if (ascii(buf, 0, 4) === "wOF2") return { mime: "font/woff2", ext: "woff2" };
  if (startsWith(buf, [0x00, 0x01, 0x00, 0x00]) && /\.ttf$/.test(lower)) return { mime: "font/ttf", ext: "ttf" };
  if (ascii(buf, 0, 4) === "OTTO") return { mime: "font/otf", ext: "otf" };

  if (isProbablyText(buf)) {
    const head = buf.subarray(0, 2048).toString("utf8").trimStart().toLowerCase();
    if (head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg")))
      return { mime: "image/svg+xml", ext: "svg" };
    if (head.startsWith("<!doctype html") || head.startsWith("<html")) return { mime: "text/html", ext: "html" };
    if (lower.endsWith(".csv")) return { mime: "text/csv", ext: "csv" };
    if (lower.endsWith(".md")) return { mime: "text/markdown", ext: "md" };
    return { mime: "text/plain", ext: "txt" };
  }
  return null;
}

/** Confere se o tipo está entre os prefixos permitidos pela organização. */
export function isAllowedType(mime: string, allowed: string[]): boolean {
  return allowed.some((rule) => (rule.endsWith("/") || rule.endsWith(".") ? mime.startsWith(rule) : mime === rule));
}

/** Tipos que nunca são exibidos inline (podem conter scripts). */
export function mustDownload(mime: string): boolean {
  return mime === "image/svg+xml" || mime === "text/html" || mime === "application/xhtml+xml";
}

export function isImage(mime: string) {
  return mime.startsWith("image/") && mime !== "image/svg+xml" && mime !== "image/vnd.adobe.photoshop";
}
