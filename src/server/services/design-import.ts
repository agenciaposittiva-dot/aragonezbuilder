import sharp from "sharp";
import { z } from "zod";
import { normalizeHex } from "@/lib/carousel-gen/color";
import { fitText } from "@/lib/carousel-gen/fit";
import {
  createDocument,
  ellipseObject,
  FORMAT_PRESETS,
  imageObject,
  rectObject,
  textObject,
  type DesignObject,
} from "@/lib/design-doc";
import { assertCan, assertClientAccess, assertInternal, inOrg, type Actor } from "@/server/authz";
import { ValidationError } from "@/server/errors";
import { aiSelectionInput, ModelSelectionError } from "./ai-models";
import {
  assertCostConfirmed,
  callStructured,
  prepareStructured,
  recordStructuredSuccess,
  type PreparedStructured,
} from "./ai-structured";
import { createDesign } from "./designs";
import { storeUpload } from "./files";

/*
 * "Importar JPG/PNG como modelo": a imagem original vai para Arquivos (do
 * cliente, quando houver) e vira a camada de fundo, bloqueada, de um template
 * editável. Com um modelo que lê imagens (tarefa "Analisar referências"), a IA
 * propõe a reconstrução em camadas — textos editáveis com posição, tamanho e
 * cor aproximados e blocos de cor como formas — e a original fica oculta e
 * bloqueada (recuperável no painel de camadas). Sem modelo com leitura de
 * imagens, só a camada de fundo é criada, e a resposta diz isso.
 */

export const importTemplateInput = z.object({
  name: z.string().trim().max(120).optional(),
  clientId: z.uuid().nullable().optional(),
  asTemplate: z.boolean().default(true),
  reconstruct: z.boolean().default(false),
  selection: aiSelectionInput.optional(),
  confirmCost: z.boolean().optional(),
});

const MAX_SIDE = 2160;

/** Página no tamanho do formato equivalente (1:1, 4:5, 9:16…) ou proporcional à imagem. */
export function pageSizeFor(width: number, height: number) {
  const ratio = width / height;
  const preset = FORMAT_PRESETS.find(
    (p) => !p.carousel && p.width >= 1000 && Math.abs(p.width / p.height - ratio) < 0.012,
  );
  if (preset) return { width: preset.width, height: preset.height, preset: preset.key };
  const s = Math.min(1, MAX_SIDE / Math.max(width, height));
  return {
    width: Math.max(16, Math.round(width * s)),
    height: Math.max(16, Math.round(height * s)),
    preset: null as string | null,
  };
}

const frac = z.number().min(-0.2).max(1.2).catch(0);
const element = z.object({
  kind: z.enum(["text", "shape"]).catch("shape"),
  x: frac,
  y: frac,
  width: z.number().min(0).max(1.2).catch(0),
  height: z.number().min(0).max(1.2).catch(0),
  text: z.string().max(2000).catch("").default(""),
  fontSize: z.number().min(0).max(1).catch(0.04).default(0.04),
  fontWeight: z.number().int().min(100).max(1000).catch(400).default(400),
  font: z.enum(["sans", "serif", "display", "condensed", "script"]).catch("sans").default("sans"),
  align: z.enum(["left", "center", "right"]).catch("left").default("left"),
  color: z.string().max(20).catch("#111111").default("#111111"),
  shape: z.enum(["rect", "ellipse"]).catch("rect").default("rect"),
  fill: z.string().max(20).catch("").default(""),
  radius: z.number().min(0).max(0.5).catch(0).default(0),
});
export const reconstructionSchema = z.object({
  background: z.string().max(20).catch("#FFFFFF"),
  elements: z.array(element).max(60).catch([]),
  notes: z.string().max(1000).catch("").default(""),
});
export type Reconstruction = z.infer<typeof reconstructionSchema>;

const RECON_JSON = {
  type: "object",
  properties: {
    background: { type: "string" },
    notes: { type: "string" },
    elements: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["text", "shape"] },
          x: { type: "number" },
          y: { type: "number" },
          width: { type: "number" },
          height: { type: "number" },
          text: { type: "string" },
          fontSize: { type: "number" },
          fontWeight: { type: "integer" },
          font: { type: "string", enum: ["sans", "serif", "display", "condensed", "script"] },
          align: { type: "string", enum: ["left", "center", "right"] },
          color: { type: "string" },
          shape: { type: "string", enum: ["rect", "ellipse"] },
          fill: { type: "string" },
          radius: { type: "number" },
        },
        required: [
          "kind",
          "x",
          "y",
          "width",
          "height",
          "text",
          "fontSize",
          "fontWeight",
          "font",
          "align",
          "color",
          "shape",
          "fill",
          "radius",
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["background", "elements", "notes"],
  additionalProperties: false,
};

const SYSTEM = [
  "Você reconstrói artes gráficas em camadas editáveis para um editor de design.",
  "Analise a imagem e liste os blocos de cor/formas (retângulos e elipses) e TODOS os textos visíveis, na ordem de baixo para cima.",
  "Coordenadas e tamanhos em frações da largura (x, width) e da altura (y, height) da imagem, de 0 a 1, a partir do canto superior esquerdo.",
  "fontSize é a altura da letra maiúscula em fração da altura da imagem. Cores em #RRGGBB. Transcreva o texto exatamente como está, com as quebras de linha.",
  "Não descreva fotos nem ilustrações complexas como formas: elas continuam na imagem original. Responda somente com o JSON pedido.",
].join(" ");

const FONT: Record<string, { family: string; weight?: number }> = {
  sans: { family: "Inter" },
  serif: { family: "Playfair Display" },
  display: { family: "Montserrat", weight: 800 },
  condensed: { family: "Oswald" },
  script: { family: "Caveat" },
};

/** Camadas editáveis a partir da resposta do modelo (página W × H). */
export function reconstructionObjects(r: Reconstruction, W: number, H: number): DesignObject[] {
  const out: DesignObject[] = [];
  r.elements.forEach((e, i) => {
    const x = Math.round(e.x * W);
    const y = Math.round(e.y * H);
    const w = Math.max(4, Math.round(e.width * W));
    const h = Math.max(4, Math.round(e.height * H));
    if (e.kind === "shape") {
      const fill = normalizeHex(e.fill) ?? normalizeHex(e.color);
      if (!fill) return;
      const base = {
        id: `rc-${i}`,
        name: e.shape === "ellipse" ? "Forma (elipse)" : "Bloco de cor",
        x,
        y,
        width: w,
        height: h,
        fill,
      };
      out.push(
        e.shape === "ellipse"
          ? ellipseObject(base)
          : rectObject({ ...base, radius: Math.round(e.radius * Math.min(w, h) * 2) }),
      );
      return;
    }
    const text = e.text.trim();
    if (!text) return;
    const font = FONT[e.font] ?? FONT.sans!;
    const weight = font.weight ?? e.fontWeight;
    // Corpo pelo tamanho informado; reduz se o texto não couber na caixa detectada.
    const wanted = Math.max(10, Math.round((e.fontSize * H) / 0.72));
    const fit = fitText(
      { text, width: w, fontFamily: font.family, fontWeight: weight, lineHeight: 1.15 },
      Math.max(h * 1.25, wanted * 1.3),
      wanted,
      Math.max(8, Math.round(wanted * 0.6)),
    );
    out.push(
      textObject({
        id: `rc-${i}`,
        name: "Texto reconstruído",
        x,
        y,
        width: w,
        text,
        fontFamily: font.family,
        fontSize: fit.fontSize,
        fontWeight: weight,
        textAlign: e.align,
        lineHeight: 1.15,
        color: normalizeHex(e.color) ?? "#111111",
      }),
    );
  });
  return out;
}

export type ImportResult = {
  id: string;
  reconstructed: boolean;
  layers: number;
  /** Explica o que foi feito (ex.: "só a camada de fundo foi criada"). */
  message: string;
  fileId: string;
  model: string | null;
};

export async function importImageAsTemplate(
  actor: Actor,
  file: { buffer: Buffer; originalName: string },
  raw: z.input<typeof importTemplateInput>,
): Promise<ImportResult> {
  const data = importTemplateInput.parse(raw);
  const meta = await sharp(file.buffer, { failOn: "none" })
    .metadata()
    .catch(() => null);
  if (!meta || !["jpeg", "png", "webp"].includes(meta.format ?? "") || !meta.width || !meta.height)
    throw new ValidationError("Envie uma imagem JPG ou PNG.");
  const natural = { width: meta.width, height: meta.height };
  const size = pageSizeFor(natural.width, natural.height);
  const clientId = data.clientId ?? null;

  // 1. Permissões, modelo com leitura de imagens e custo ANTES de gravar qualquer coisa.
  const pre = await inOrg(actor, async (s) => {
    assertInternal(s.actor);
    assertCan(s.actor, "designs.write");
    assertCan(s.actor, "files.write");
    if (data.asTemplate) assertCan(s.actor, "templates.manage");
    if (clientId) await assertClientAccess(s, clientId);
    let prep: PreparedStructured | null = null;
    let visionMessage: string | null = null;
    if (data.reconstruct) {
      try {
        prep = await prepareStructured(s, { module: "editor", task: "reference_analysis", selection: data.selection });
        assertCostConfirmed(prep, {
          system: SYSTEM,
          prompt: "x".repeat(600),
          maxTokens: 6000,
          images: 1,
          confirmCost: data.confirmCost,
        });
      } catch (err) {
        if (err instanceof ModelSelectionError && data.selection?.mode !== "manual") {
          prep = null;
          visionMessage =
            "Nenhum modelo com leitura de imagens está configurado: só a camada de fundo foi criada (a imagem original, bloqueada).";
        } else throw err;
      }
    }
    // 2. Original em Arquivos (do cliente, quando houver).
    const stored = await storeUpload(s, file, {
      clientId,
      category: "reference",
      tags: ["modelo"],
      note: "Imagem original de um template importado no Estúdio.",
      source: "upload",
    });
    return { prep, visionMessage, stored };
  });

  // 3. Reconstrução (fora de transação) — falha nunca é escondida.
  let recon: Reconstruction | null = null;
  let call: Awaited<ReturnType<typeof callStructured<Reconstruction>>> | null = null;
  let message = pre.visionMessage ?? "Template criado com a imagem como camada de fundo (bloqueada).";
  if (pre.prep) {
    const small = await sharp(file.buffer, { failOn: "none" })
      .rotate()
      .resize({ width: 1280, height: 1280, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer();
    try {
      call = await callStructured(actor, pre.prep, {
        operation: "template_reconstruction",
        system: SYSTEM,
        prompt: [
          "Formato da resposta: template_reconstruction",
          `Imagem: ${natural.width} × ${natural.height} px.`,
          "Reconstrua a arte em camadas: blocos de cor e textos editáveis.",
        ].join("\n"),
        schema: RECON_JSON,
        parse: reconstructionSchema,
        clientId,
        maxTokens: 6000,
        images: [{ mime: "image/jpeg", data: small }],
        confirmCost: true,
      });
      recon = call.data;
    } catch (err) {
      message = `A reconstrução por IA falhou (${(err as Error).message}). Só a camada de fundo foi criada.`;
    }
  }

  // 4. Documento: original + camadas reconstruídas.
  const layers = recon ? reconstructionObjects(recon, size.width, size.height) : [];
  const reconstructed = layers.length > 0;
  if (recon && !reconstructed)
    message = "A IA não encontrou textos nem blocos de cor para reconstruir. Só a camada de fundo foi criada.";
  if (reconstructed)
    message = `Reconstrução por IA: ${layers.filter((l) => l.type === "text").length} texto(s) e ${layers.filter((l) => l.type !== "text").length} forma(s) editáveis. A imagem original ficou oculta e bloqueada na camada de baixo.`;
  const original = imageObject({
    id: "original",
    name: reconstructed ? "Imagem original (oculta)" : "Imagem original (fundo)",
    src: `/api/files/${pre.stored.versionId}`,
    naturalWidth: natural.width,
    naturalHeight: natural.height,
    x: 0,
    y: 0,
    width: size.width,
    height: size.height,
    locked: true,
    hidden: reconstructed,
  });
  const doc = createDocument({
    pages: [
      {
        width: size.width,
        height: size.height,
        name: "Página 1",
        background: (reconstructed && normalizeHex(recon!.background)) || "#FFFFFF",
        objects: [original, ...layers],
      },
    ],
    preset: size.preset,
  });
  doc.meta = {
    ...doc.meta,
    imported: {
      fileId: pre.stored.fileId,
      versionId: pre.stored.versionId,
      width: natural.width,
      height: natural.height,
      reconstructed,
      model: reconstructed && call ? call.model : null,
    },
  };
  const name = (data.name || file.originalName.replace(/\.[a-z0-9]+$/i, "") || "Template importado").slice(0, 120);
  const created = await inOrg(actor, async (s) => {
    const d = await createDesign(s, {
      name,
      width: size.width,
      height: size.height,
      clientId,
      isTemplate: data.asTemplate,
      templateCategory: data.asTemplate ? "Importados" : undefined,
      preset: size.preset,
      document: doc as unknown as Record<string, unknown>,
    });
    if (call)
      await recordStructuredSuccess(s, call, {
        title: `Template importado: ${name}`.slice(0, 120),
        input: { fileId: pre.stored.fileId, reconstruct: true },
        clientId,
      });
    return d;
  });
  return {
    id: created.id,
    reconstructed,
    layers: layers.length,
    message,
    fileId: pre.stored.fileId,
    model: reconstructed && call ? call.model : null,
  };
}
