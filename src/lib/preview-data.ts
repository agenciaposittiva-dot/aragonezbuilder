import type { DesignDocument } from "@/lib/design-doc";
import type { CheckInput, CheckSlide } from "@/lib/preview-check";
import type { NetworkKey, PlacementKey } from "@/lib/social-specs";

/*
 * Dados da Central de pré-visualização, compartilhados entre o servidor
 * (src/server/services/content-preview.ts) e a tela.
 */

export type PreviewSlide =
  | {
      kind: "page";
      key: string;
      label: string;
      designId: string;
      pageId: string;
      pageIndex: number;
      width: number;
      height: number;
    }
  | {
      kind: "file";
      key: string;
      label: string;
      fileId: string;
      versionId: string;
      mimeType: string;
      width: number;
      height: number;
    };

export type FileSlide = Extract<PreviewSlide, { kind: "file" }>;

/** Status da última rodada de aprovação de uma etapa (null = nunca enviada). */
export type RoundStatus = "pending" | "approved" | "changes_requested" | "superseded" | "cancelled" | null;

export type PreviewOutput = {
  fileId: string;
  name: string;
  designId: string;
  pageId: string | null;
  versionId: string | null;
  versionNumber: number | null;
  versionCreatedAt: string | null;
  status: string;
  sharedWithClient: boolean;
  internal: RoundStatus;
  client: RoundStatus;
};

export type PreviewContent = {
  id: string;
  title: string;
  format: string;
  status: string;
  copy: string | null;
  caption: string | null;
  hashtags: string[];
  cta: string | null;
  script: string | null;
  slides: { title: string; text: string }[];
  plannedDate: string | null;
  campaignName: string | null;
  projectId: string | null;
  projectName: string | null;
  createdByName: string | null;
  network: string;
  placement: string | null;
};

export type PreviewDesign = {
  id: string;
  name: string;
  updatedAt: string;
  carousel: boolean;
  document: DesignDocument;
};

export type PreviewData = {
  source: "content" | "design";
  content: PreviewContent | null;
  design: { id: string; name: string } | null;
  client: { id: string; name: string; avatarUrl: string | null } | null;
  designs: PreviewDesign[];
  slides: PreviewSlide[];
  outputs: PreviewOutput[];
  exports: { stale: boolean; exported: number; total: number } | null;
  brandLogoVersionIds: string[];
  permissions: { writeContent: boolean; writeDesign: boolean; requestApproval: boolean; useAi: boolean };
};

export type PortalPreview = {
  content: {
    id: string;
    title: string;
    format: string;
    caption: string | null;
    hashtags: string[];
    cta: string | null;
    network: NetworkKey;
    placement: PlacementKey | null;
    plannedDate: string | null;
  };
  client: { name: string };
  slides: FileSlide[];
  /** Versão atual de cada arquivo (as aprovações são por versão). */
  versions: Record<string, { id: string; versionNumber: number }>;
};

/** Páginas no formato do verificador (camadas da arte salva ou arquivo de mídia). */
export function checkSlidesOf(designs: PreviewDesign[], slides: PreviewSlide[]): CheckSlide[] {
  const byId = new Map(designs.map((d) => [d.id, d]));
  return slides.map((s) => {
    if (s.kind === "file") {
      return { key: s.key, label: s.label, width: s.width, height: s.height, mimeType: s.mimeType };
    }
    const d = byId.get(s.designId);
    const page = d?.document.pages[s.pageIndex];
    const count = d?.document.pages.length ?? 1;
    return {
      key: s.key,
      label: s.label,
      width: s.width,
      height: s.height,
      objects: page?.objects ?? [],
      background: page?.background ?? null,
      designId: s.designId,
      pageId: s.pageId,
      connected: d?.carousel && count > 1 ? { first: s.pageIndex === 0, last: s.pageIndex === count - 1 } : undefined,
    };
  });
}

/** Entrada completa do verificador para a prévia (legenda pode vir editada na tela). */
export function checkInputOf(
  data: PreviewData,
  target: { network: NetworkKey; placement: PlacementKey },
  texts?: { caption?: string | null; hashtags?: string[]; cta?: string | null },
): CheckInput {
  return {
    network: target.network,
    placement: target.placement,
    slides: checkSlidesOf(data.designs, data.slides),
    caption: texts?.caption ?? data.content?.caption ?? null,
    hashtags: texts?.hashtags ?? data.content?.hashtags ?? [],
    cta: texts?.cta ?? data.content?.cta ?? null,
    hasCaption: !!data.content,
    exports: data.exports,
    brandLogoVersionIds: data.brandLogoVersionIds,
  };
}

/** Textos das camadas de cada página (para a revisão por IA e a conversão). */
export function pageTextsOf(designs: PreviewDesign[], slides: PreviewSlide[]) {
  const byId = new Map(designs.map((d) => [d.id, d]));
  return slides.flatMap((s) => {
    if (s.kind !== "page") return [];
    const page = byId.get(s.designId)?.document.pages[s.pageIndex];
    if (!page) return [];
    const texts: { id: string; text: string; fontSize: number }[] = [];
    const walk = (list: typeof page.objects) => {
      for (const o of list) {
        if (o.hidden) continue;
        if (o.type === "group") walk(o.children);
        else if (o.type === "text" && o.text.trim())
          texts.push({ id: o.id, text: o.text.trim(), fontSize: o.fontSize });
      }
    };
    walk(page.objects);
    // Do maior para o menor: o primeiro tende a ser o título da página.
    texts.sort((a, b) => b.fontSize - a.fontSize);
    return [{ key: s.key, label: s.label, texts }];
  });
}
