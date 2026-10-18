import "server-only";
import { describeObject, locate, versionIdOfSrc, type DesignDocument } from "@/lib/design-doc";

/*
 * Ferramentas do chat de edição de artes. Além das OPERAÇÕES do documento
 * (lib/design-doc/ops), o modelo pode escolher AÇÕES de um registro: cada
 * ferramenta descreve ao modelo quando usá-la e valida os argumentos contra a
 * arte. A ação volta na proposta e é executada por uma rota/serviço próprio
 * (ex.: image_edit → /api/designs/ai/image), que devolve operações para a
 * mesma prévia/aplicação/desfazer. Para plugar uma ferramenta nova (ex.:
 * regenerar um slide do gerador de carrosséis): registerDesignAiTool(...) aqui
 * e uma vista em ACTION_VIEWS no componente do chat.
 */

export type DesignAiToolCtx = { doc: DesignDocument };

export type DesignAiAction = {
  /** Id da ferramenta no registro. */
  tool: string;
  /** Título curto para a interface. */
  label: string;
  /** Argumentos já validados (formato próprio de cada ferramenta). */
  args: Record<string, unknown>;
  /** false = a ação não pode ser executada nesta arte (o motivo vai em `note`). */
  available: boolean;
  note: string | null;
};

export type DesignAiTool = {
  id: string;
  label: string;
  /** Linha(s) do prompt do sistema: quando usar e quais argumentos (JSON). */
  prompt: string;
  /** Valida os argumentos sugeridos pelo modelo; null = descartar. */
  normalize: (ctx: DesignAiToolCtx, args: Record<string, unknown>) => DesignAiAction | null;
};

const REGISTRY = new Map<string, DesignAiTool>();

export function registerDesignAiTool(tool: DesignAiTool) {
  REGISTRY.set(tool.id, tool);
}

export function designAiTools(): DesignAiTool[] {
  return [...REGISTRY.values()];
}

/** Trecho do prompt do sistema com as ferramentas registradas. */
export function toolsPrompt() {
  const tools = designAiTools();
  if (!tools.length) return "";
  return [
    'Ferramentas (vão em "actions", além das operações; use só quando o pedido exigir):',
    ...tools.map((t) => `- ${t.id}: ${t.prompt}`),
  ].join("\n");
}

function parseList(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (typeof v === "string" && v.trim()) {
    try {
      const parsed = JSON.parse(v) as unknown;
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** Ações sugeridas pelo modelo → ações válidas (ferramenta conhecida e argumentos coerentes com a arte). */
export function normalizeActions(ctx: DesignAiToolCtx, raw: unknown): { actions: DesignAiAction[]; skipped: number } {
  const actions: DesignAiAction[] = [];
  let skipped = 0;
  for (const item of parseList(raw).slice(0, 10)) {
    const r = item && typeof item === "object" ? (item as Record<string, unknown>) : null;
    const tool = typeof r?.tool === "string" ? REGISTRY.get(r.tool) : undefined;
    const args = r?.args && typeof r.args === "object" ? (r.args as Record<string, unknown>) : {};
    const action = tool ? tool.normalize(ctx, args) : null;
    if (action) actions.push(action);
    else skipped++;
  }
  return { actions, skipped };
}

/* ------------------------------------------------------------------ */
/* Ferramentas desta versão                                            */
/* ------------------------------------------------------------------ */

export type ImageEditArgs = { targetId: string; instruction: string; src: string | null };

registerDesignAiTool({
  id: "image_edit",
  label: "Nova versão de imagem",
  prompt:
    'trocar, editar, recolorir ou criar variação de uma imagem EXISTENTE da arte (a original vai como referência a um modelo de imagem). Argumentos: {"targetId": ID_DA_IMAGEM, "instruction": "o que mudar na imagem"}.',
  normalize: (ctx, args) => {
    const targetId = typeof args.targetId === "string" ? args.targetId : "";
    const loc = targetId ? locate(ctx.doc, targetId) : null;
    if (loc?.object.type !== "image") return null;
    const fromFiles = !!versionIdOfSrc(loc.object.src);
    const instruction =
      typeof args.instruction === "string" && args.instruction.trim()
        ? args.instruction.trim().slice(0, 2000)
        : "Nova versão da imagem";
    return {
      tool: "image_edit",
      label: `Nova versão de “${describeObject(loc.object)}”`,
      args: { targetId, instruction, src: fromFiles ? loc.object.src : null } satisfies ImageEditArgs,
      available: fromFiles,
      note: fromFiles
        ? null
        : "Esta imagem está embutida na arte (não está em Arquivos). Envie a imagem para Arquivos e use-a na arte para editá-la com IA.",
    };
  },
});

/* ------------------------------------------------------------------ */
/* Gerador de carrosséis (artes com document.meta.generator)           */
/* ------------------------------------------------------------------ */

export type CarouselSlideArgs = { pageId: string; slide: number; instruction: string };

const NOT_GENERATED = "Esta arte não foi criada pelo gerador de carrosséis; use as operações de edição comuns.";

registerDesignAiTool({
  id: "carousel_slide",
  label: "Regenerar slide do carrossel",
  prompt:
    'SOMENTE se o contexto tiver "generator" (carrossel do gerador): reescrever/refazer UM slide inteiro (texto e composição, mantendo a continuidade), ex.: "reescreva o slide 3", "deixe a capa mais impactante". Argumentos: {"slide": NÚMERO_DO_SLIDE (1 = capa), "instruction": "o que mudar"}. Para trocar só uma palavra ou cor, prefira as operações.',
  normalize: (ctx, args) => {
    const meta = ctx.doc.meta?.generator;
    const n = Math.round(Number(args.slide));
    const page = Number.isFinite(n) ? ctx.doc.pages[n - 1] : undefined;
    const slide = page ? meta?.slides.find((s) => s.pageId === page.id) : undefined;
    if (meta && !slide) return null;
    const instruction =
      typeof args.instruction === "string" && args.instruction.trim() ? args.instruction.trim().slice(0, 500) : "";
    return {
      tool: "carousel_slide",
      label: `Regenerar o slide ${n || "?"}${slide?.role === "cover" ? " (capa)" : ""}`,
      args: { pageId: page?.id ?? "", slide: n, instruction } satisfies CarouselSlideArgs,
      available: !!slide,
      note: meta ? null : NOT_GENERATED,
    };
  },
});

registerDesignAiTool({
  id: "carousel_direction",
  label: "Nova direção visual",
  prompt:
    'SOMENTE com "generator" no contexto: trocar a direção visual do carrossel inteiro (estilo, tipografia, composição e elemento de continuidade) mantendo os textos e as imagens, ex.: "mude só a direção visual". Argumentos: {}.',
  normalize: (ctx) => {
    const meta = ctx.doc.meta?.generator;
    return {
      tool: "carousel_direction",
      label: "Nova direção visual (mantém os textos)",
      args: {},
      available: !!meta,
      note: meta ? null : NOT_GENERATED,
    };
  },
});

registerDesignAiTool({
  id: "carousel_variant",
  label: "Segunda versão do carrossel",
  prompt:
    'SOMENTE com "generator" no contexto: criar uma SEGUNDA VERSÃO do carrossel com outra composição em cada slide (arte nova; esta não muda), ex.: "gere uma segunda versão". Argumentos: {}.',
  normalize: (ctx) => {
    const meta = ctx.doc.meta?.generator;
    return {
      tool: "carousel_variant",
      label: "Segunda versão (arte nova com outra composição)",
      args: {},
      available: !!meta,
      note: meta ? null : NOT_GENERATED,
    };
  },
});
