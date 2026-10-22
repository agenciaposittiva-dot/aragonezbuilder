/** Imagem no lugar de um arquivo que não está mais disponível (excluído ou sem acesso). */
export const MISSING_IMAGE =
  "data:image/svg+xml;charset=utf-8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="100%" height="100%" fill="#f1f0ec"/><text x="50%" y="50%" text-anchor="middle" font-family="sans-serif" font-size="18" fill="#8a877f">Imagem indisponível</text></svg>',
  );

export type LoadedImage = { el: HTMLImageElement; missing: boolean };
const cache = new Map<string, Promise<LoadedImage>>();
const ready = new Map<string, LoadedImage>();

function load(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    const timer = setTimeout(() => resolve(null), 15_000);
    img.onload = () => {
      clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      clearTimeout(timer);
      resolve(null);
    };
    img.src = src;
  });
}

/**
 * Carrega (uma vez) a imagem de um `src` do documento. Se não carregar, devolve
 * o aviso "Imagem indisponível" — a arte abre mesmo sem o arquivo, e a
 * referência original continua no documento.
 */
export function loadImage(src: string): Promise<LoadedImage> {
  const hit = cache.get(src);
  if (hit) return hit;
  const p = (async () => {
    const el = await load(src);
    const out = el ? { el, missing: false } : { el: (await load(MISSING_IMAGE))!, missing: true };
    ready.set(src, out);
    return out;
  })();
  cache.set(src, p);
  return p;
}

/** Imagem já carregada (síncrono), se houver. */
export const loadedImage = (src: string) => ready.get(src) ?? null;

export async function fileToDataUrl(file: Blob, maxSide = 2048): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      // O evento de erro não tem mensagem: sem isto o aviso aparecia vazio.
      el.onerror = () =>
        reject(new Error("Não foi possível ler esta imagem. O arquivo pode estar corrompido ou em formato não suportado."));
      el.src = url;
    });
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL(file.type === "image/png" || file.type === "image/webp" ? "image/png" : "image/jpeg", 0.9);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const [head, b64] = dataUrl.split(",");
  const mime = /data:([^;]+)/.exec(head!)?.[1] ?? "image/png";
  const bin = atob(b64!);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export type UploadMeta = {
  orgSlug: string;
  category: "general" | "deliverable";
  source?: "editor";
  note?: string;
  tags?: string;
  clientId?: string | null;
  projectId?: string | null;
  taskId?: string | null;
  /** Nova versão de um arquivo existente. */
  fileId?: string | null;
};

/** Envia um arquivo para Arquivos pelo fluxo da plataforma (/api/uploads). */
export async function uploadToFiles(file: File, meta: UploadMeta): Promise<{ fileId: string; versionId: string }> {
  const form = new FormData();
  form.set("orgSlug", meta.orgSlug);
  form.set("file", file);
  form.set("category", meta.category);
  form.set("source", meta.source ?? "editor");
  if (meta.tags) form.set("tags", meta.tags);
  if (meta.note) form.set("note", meta.note);
  if (meta.fileId) form.set("fileId", meta.fileId);
  if (meta.clientId) form.set("clientId", meta.clientId);
  if (meta.projectId) form.set("projectId", meta.projectId);
  if (meta.taskId) form.set("taskId", meta.taskId);
  const res = await fetch("/api/uploads", { method: "POST", body: form }).catch(() => null);
  if (!res) throw new Error("Sem conexão: o arquivo não foi enviado.");
  const data = (await res.json().catch(() => ({}))) as {
    error?: string;
    results?: { ok: boolean; fileId?: string; versionId?: string; error?: string }[];
  };
  const first = data.results?.[0];
  if (!res.ok || !first?.ok || !first.fileId || !first.versionId) {
    throw new Error(first?.error ?? data.error ?? "Não foi possível enviar para Arquivos.");
  }
  return { fileId: first.fileId, versionId: first.versionId };
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const safeFileName = (name: string) => name.replace(/[^\p{L}\p{N}\- ]/gu, "").trim() || "arte";
