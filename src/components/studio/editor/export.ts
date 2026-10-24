"use client";

import { fontsOf, fontWeightsOf } from "@/lib/design-doc";
import { buildPdf } from "@/lib/design-doc/pdf";
import { buildZip } from "@/lib/zip";
import { linkDesignOutputAction } from "@/server/actions/designs";
import { ensureFonts } from "./fonts";
import { downloadBlob, safeFileName, uploadToFiles } from "./media";
import type { Scene } from "./scene";
import type { EditorStore } from "./store";

/*
 * Exportação: PNG/JPEG (página atual ou todas) e PDF com várias páginas.
 * As fontes são carregadas antes. "Enviar para Arquivos" usa o fluxo de
 * envio da plataforma: cada página vira um arquivo (e as próximas
 * exportações, novas versões dos mesmos arquivos), pronto para aprovação.
 */

export type ExportFormat = "png" | "jpeg" | "pdf";
export type ExportOptions = { format: ExportFormat; pageIds: string[]; scale: number; quality: number };

type Ctx = {
  scene: Scene;
  store: EditorStore;
  orgSlug: string;
  design: {
    id: string;
    name: string;
    clientId: string | null;
    projectId: string | null;
    taskId: string | null;
    /** Arquivo da última exportação (artes de antes do formato novo guardavam só este). */
    outputFileId: string | null;
  };
};

const canvasBlob = (c: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob>((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error("Falha ao gerar a imagem."))), type, quality),
  );

async function prepare(ctx: Ctx) {
  await ensureFonts(fontsOf(ctx.store.doc), fontWeightsOf(ctx.store.doc));
  // Textos são medidos de novo com as fontes carregadas antes de desenhar.
  ctx.scene.refreshFonts(fontsOf(ctx.store.doc));
  await new Promise((r) => requestAnimationFrame(() => r(null)));
}

function pageLabel(ctx: Ctx, pageId: string) {
  const i = ctx.store.doc.pages.findIndex((p) => p.id === pageId);
  const p = ctx.store.doc.pages[i]!;
  return { index: i, name: p.name || `Página ${i + 1}` };
}

function fileName(ctx: Ctx, pageId: string | null, ext: string) {
  const base = safeFileName(ctx.design.name);
  if (!pageId || ctx.store.doc.pages.length === 1) return `${base}.${ext}`;
  const { index, name } = pageLabel(ctx, pageId);
  return `${base} - ${String(index + 1).padStart(2, "0")} ${safeFileName(name)}.${ext}`;
}

/** Arquivos gerados (em memória), um por página — ou um PDF com todas. */
export async function renderExport(
  ctx: Ctx,
  o: ExportOptions,
): Promise<{ name: string; blob: Blob; pageId: string | null }[]> {
  await prepare(ctx);
  const doc = ctx.store.doc;
  const ids = o.pageIds.filter((id) => doc.pages.some((p) => p.id === id));
  if (!ids.length) throw new Error("Escolha pelo menos uma página.");
  if (o.format === "pdf") {
    const pages = [];
    for (const id of ids) {
      const page = doc.pages.find((p) => p.id === id)!;
      const c = ctx.scene.renderPage(id, o.scale, { background: "#ffffff" });
      const blob = await canvasBlob(c, "image/jpeg", o.quality);
      pages.push({
        jpeg: new Uint8Array(await blob.arrayBuffer()),
        pixelWidth: c.width,
        pixelHeight: c.height,
        width: page.width,
        height: page.height,
      });
    }
    const pdf = buildPdf(pages, { title: ctx.design.name });
    return [
      {
        name: fileName(ctx, null, "pdf"),
        blob: new Blob([pdf as BlobPart], { type: "application/pdf" }),
        pageId: null,
      },
    ];
  }
  const out = [];
  for (const id of ids) {
    const c = ctx.scene.renderPage(id, o.scale, o.format === "jpeg" ? { background: "#ffffff" } : {});
    const blob = await canvasBlob(
      c,
      o.format === "png" ? "image/png" : "image/jpeg",
      o.format === "jpeg" ? o.quality : undefined,
    );
    out.push({ name: fileName(ctx, id, o.format === "png" ? "png" : "jpg"), blob, pageId: id });
  }
  return out;
}

export async function downloadExport(ctx: Ctx, o: ExportOptions) {
  const files = await renderExport(ctx, o);
  if (files.length === 1) return downloadBlob(files[0]!.blob, files[0]!.name);
  const zip = buildZip(
    await Promise.all(files.map(async (f) => ({ name: f.name, data: new Uint8Array(await f.blob.arrayBuffer()) }))),
  );
  downloadBlob(new Blob([zip as BlobPart], { type: "application/zip" }), `${safeFileName(ctx.design.name)}.zip`);
}

/**
 * Envia para Arquivos: cada página é um arquivo (nova versão quando já foi
 * exportada antes); o PDF é um arquivo só. Devolve o primeiro arquivo para o
 * atalho "Abrir".
 */
export async function sendExportToFiles(
  ctx: Ctx,
  o: ExportOptions,
): Promise<{
  fileId: string;
  count: number;
  newVersions: number;
  /** Versões criadas/atualizadas (para enviar também ao Google Drive). */
  versions: { fileId: string; versionId: string; name: string }[];
}> {
  const files = await renderExport(ctx, o);
  const doc = ctx.store.doc;
  const outputs = { ...(doc.meta?.outputs ?? {}) };
  let pdfOutput = doc.meta?.pdfOutputFileId ?? null;
  let first: string | null = null;
  let newVersions = 0;
  const versions: { fileId: string; versionId: string; name: string }[] = [];
  for (const f of files) {
    const isFirstPage = f.pageId === doc.pages[0]!.id;
    const previous = f.pageId ? (outputs[f.pageId] ?? (isFirstPage ? ctx.design.outputFileId : null)) : pdfOutput;
    const label = f.pageId && doc.pages.length > 1 ? pageLabel(ctx, f.pageId).name : f.pageId ? undefined : "PDF";
    const up = await uploadToFiles(new File([f.blob], f.name, { type: f.blob.type }), {
      orgSlug: ctx.orgSlug,
      category: "deliverable",
      note: label ? `Exportado do Estúdio (${label})` : "Exportado do Estúdio",
      fileId: previous,
      clientId: ctx.design.clientId,
      projectId: ctx.design.projectId,
      taskId: ctx.design.taskId,
    }).catch(async (err: Error) => {
      // Arquivo anterior excluído ou sem acesso: exporta como arquivo novo.
      if (!previous) throw err;
      return uploadToFiles(new File([f.blob], f.name, { type: f.blob.type }), {
        orgSlug: ctx.orgSlug,
        category: "deliverable",
        note: label ? `Exportado do Estúdio (${label})` : "Exportado do Estúdio",
        clientId: ctx.design.clientId,
        projectId: ctx.design.projectId,
        taskId: ctx.design.taskId,
      });
    });
    if (previous && up.fileId === previous) newVersions++;
    const linked = await linkDesignOutputAction(ctx.orgSlug, {
      designId: ctx.design.id,
      fileId: up.fileId,
      versionId: up.versionId,
      primary: isFirstPage,
      label,
    });
    if (!linked.ok) throw new Error(linked.error);
    if (f.pageId) outputs[f.pageId] = up.fileId;
    else pdfOutput = up.fileId;
    first ??= up.fileId;
    versions.push({ fileId: up.fileId, versionId: up.versionId, name: f.name });
  }
  // Guarda onde cada página foi parar (a próxima exportação vira nova versão). Não entra no desfazer.
  ctx.store.dispatch([{ op: "setMeta", set: { outputs, pdfOutputFileId: pdfOutput } }], {
    history: false,
    reason: "edit",
  });
  return { fileId: first!, count: files.length, newVersions, versions };
}
