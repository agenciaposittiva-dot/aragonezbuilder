/**
 * Validação e preparo de imagens no navegador, antes do envio (importar JPG/PNG
 * como modelo). Recusa cedo o que o servidor recusaria e explica o motivo; fotos
 * grandes são reduzidas para caber no limite de envio em vez de falharem.
 */

const FORMATS: Record<string, string> = { "image/jpeg": "JPG", "image/png": "PNG", "image/webp": "WebP" };
const EXTENSIONS = ["jpg", "jpeg", "png", "webp"];
/** Acima disso o navegador pode ficar sem memória só para abrir o arquivo. */
const MAX_OPEN_BYTES = 80 * 1024 * 1024;
/** Pixels (largura × altura) que ainda dá para redimensionar com segurança. */
const MAX_PIXELS = 120_000_000;

export class ImagePrepareError extends Error {}

export const formatMB = (bytes: number) =>
  `${(bytes / (1024 * 1024)).toLocaleString("pt-BR", { maximumFractionDigits: bytes < 10 * 1024 * 1024 ? 1 : 0 })} MB`;

function decode(file: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("decode"));
    img.src = url;
  }).finally(() => setTimeout(() => URL.revokeObjectURL(url), 0));
}

function encode(img: HTMLImageElement, scale: number, type: "image/jpeg" | "image/png", quality: number) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(img.naturalWidth * scale));
  c.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = c.getContext("2d");
  if (!ctx) throw new ImagePrepareError("O navegador não conseguiu preparar a imagem (memória insuficiente).");
  if (type === "image/jpeg") {
    // JPG não tem transparência: o fundo fica branco, como no modelo.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, c.width, c.height);
  }
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return new Promise<{ blob: Blob; width: number; height: number }>((resolve, reject) =>
    c.toBlob(
      (b) =>
        b
          ? resolve({ blob: b, width: c.width, height: c.height })
          : reject(new ImagePrepareError("O navegador não conseguiu preparar a imagem (memória insuficiente).")),
      type,
      quality,
    ),
  );
}

export type PreparedImage = {
  file: File;
  width: number;
  height: number;
  /** O que foi feito com a imagem (ex.: reduzida), para mostrar à pessoa. */
  note: string | null;
};

/**
 * Confere formato, leitura e dimensões; reduz para no máximo `maxSide` px e para
 * caber em `maxBytes`. Lança `ImagePrepareError` com a mensagem para a pessoa.
 */
export async function prepareImageForUpload(
  file: File,
  opts: { maxBytes: number; maxSide?: number },
): Promise<PreparedImage> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!(file.type in FORMATS) && !EXTENSIONS.includes(ext)) {
    throw new ImagePrepareError(
      `Formato não suportado (${file.type || ext || "desconhecido"}). Envie uma imagem JPG, PNG ou WebP.`,
    );
  }
  if (!file.size) throw new ImagePrepareError("O arquivo está vazio.");
  if (file.size > MAX_OPEN_BYTES) {
    throw new ImagePrepareError(
      `Arquivo grande demais para abrir no navegador (${formatMB(file.size)}). Exporte a imagem com até ${formatMB(MAX_OPEN_BYTES)}.`,
    );
  }
  const img = await decode(file).catch(() => null);
  if (!img || !img.naturalWidth || !img.naturalHeight) {
    throw new ImagePrepareError(
      "Não foi possível ler esta imagem. O arquivo pode estar corrompido ou não ser realmente JPG, PNG ou WebP.",
    );
  }
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (w * h > MAX_PIXELS) {
    throw new ImagePrepareError(
      `Dimensões grandes demais (${w} × ${h} px) para processar com segurança. Reduza para até 8000 px no maior lado.`,
    );
  }
  const maxSide = opts.maxSide ?? 4096;
  if (Math.max(w, h) <= maxSide && file.size <= opts.maxBytes) return { file, width: w, height: h, note: null };

  const base = file.name.replace(/\.[a-z0-9]+$/i, "") || "imagem";
  let scale = Math.min(1, maxSide / Math.max(w, h));
  const png = file.type === "image/png" || ext === "png";
  for (let round = 0; round < 4; round++) {
    const attempts: ["image/jpeg" | "image/png", number][] = [
      ...(png && round === 0 ? ([["image/png", 1]] as ["image/png", number][]) : []),
      ["image/jpeg", 0.9],
      ["image/jpeg", 0.8],
    ];
    for (const [type, quality] of attempts) {
      const out = await encode(img, scale, type, quality);
      if (out.blob.size <= opts.maxBytes) {
        const name = `${base}.${type === "image/png" ? "png" : "jpg"}`;
        const resized = out.width !== w || out.height !== h;
        return {
          file: new File([out.blob], name, { type }),
          width: out.width,
          height: out.height,
          note: resized
            ? `Imagem reduzida de ${w} × ${h} para ${out.width} × ${out.height} px (${formatMB(out.blob.size)}) para caber no limite de envio.`
            : `Imagem recomprimida para ${formatMB(out.blob.size)} para caber no limite de envio.`,
        };
      }
    }
    scale *= 0.75;
  }
  throw new ImagePrepareError(
    `Mesmo reduzida, a imagem passa do limite de envio de ${formatMB(opts.maxBytes)}. Exporte uma versão menor e tente de novo.`,
  );
}

/** Mensagem clara para respostas do envio que não vieram da aplicação (limite do provedor, tempo esgotado). */
export function uploadHttpError(status: number, maxBytes: number) {
  if (status === 413) return `A imagem passa do limite de envio do servidor (${formatMB(maxBytes)}).`;
  if (status === 408 || status === 502 || status === 504)
    return "O servidor demorou demais para responder. Nada foi criado; tente de novo (sem a reconstrução com IA, o envio é mais rápido).";
  if (status === 401 || status === 403) return "Sua sessão expirou ou você não tem permissão. Entre de novo e tente outra vez.";
  return `Não foi possível importar a imagem (erro ${status}). Nada foi criado; tente de novo.`;
}
