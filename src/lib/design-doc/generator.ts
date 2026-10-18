import { z } from "zod";

/*
 * Metadados guardados no próprio documento (meta.generator / meta.imported):
 * o plano do gerador de carrosséis (entrada, roteiro, direção de arte, dados a
 * confirmar e versão) e a origem de templates importados de JPG/PNG. Ficam no
 * documento para que regenerar um slide, trocar a direção visual ou criar uma
 * segunda versão funcionem depois de reabrir — sem tabela nova.
 */

export const SLIDE_ROLES = [
  "cover",
  "problem",
  "context",
  "insight",
  "data",
  "list",
  "steps",
  "comparison",
  "quote",
  "summary",
  "cta",
] as const;
export type SlideRole = (typeof SLIDE_ROLES)[number];

export const SLIDE_ROLE_LABEL: Record<SlideRole, string> = {
  cover: "Capa",
  problem: "Problema",
  context: "Contexto",
  insight: "Ideia central",
  data: "Dado",
  list: "Lista",
  steps: "Passo a passo",
  comparison: "Comparação",
  quote: "Citação",
  summary: "Resumo",
  cta: "Chamada final",
};

export const VISUAL_KINDS = ["image", "icon", "chart", "diagram", "typographic"] as const;
export type VisualKind = (typeof VISUAL_KINDS)[number];

export const MOTIFS = ["ribbon", "orbit", "wave", "blocks", "dots"] as const;
export type Motif = (typeof MOTIFS)[number];

const s = (n: number) => z.string().max(n);
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Cor inválida");
const key = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/, "Identificador inválido");
const pageId = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/);

export const generatorSlideSchema = z.object({
  /** Identificador estável do slide: prefixo dos objetos gerados (`<key>-title`, …). */
  key,
  pageId,
  role: z.enum(SLIDE_ROLES),
  kicker: s(80).default(""),
  title: s(240),
  body: s(900).default(""),
  bullets: z.array(s(220)).max(6).default([]),
  /** Comparação (antes/depois, mito/verdade): duas colunas. */
  columns: z
    .array(z.object({ label: s(60), items: z.array(s(180)).max(4) }))
    .max(2)
    .default([]),
  stat: z
    .object({ value: s(24), label: s(200), source: s(300).default("") })
    .nullable()
    .default(null),
  chart: z
    .object({
      unit: s(20).default(""),
      items: z
        .array(z.object({ label: s(60), value: z.number().finite() }))
        .min(2)
        .max(6),
      source: s(300).default(""),
    })
    .nullable()
    .default(null),
  visual: z.object({
    kind: z.enum(VISUAL_KINDS),
    prompt: s(800).default(""),
    icon: s(40).default(""),
    /** Imagem usada no slide (gerada por IA ou escolhida em Arquivos). */
    image: z
      .object({
        fileId: z.uuid(),
        versionId: z.uuid(),
        width: z.number().int().min(1).max(20_000),
        height: z.number().int().min(1).max(20_000),
        origin: z.enum(["ai", "files"]),
      })
      .nullable()
      .default(null),
  }),
  /** Composição usada (variação do papel). */
  layout: s(40),
});
export type GeneratorSlide = z.infer<typeof generatorSlideSchema>;

export const generatorDirectionSchema = z.object({
  key: s(40),
  name: s(80),
  palette: z.object({
    bg: hex,
    bgAlt: hex,
    surface: hex,
    ink: hex,
    muted: hex,
    accent: hex,
    accent2: hex,
    onAccent: hex,
  }),
  fonts: z.object({ heading: s(80), body: s(80), headingWeight: z.number().int().min(100).max(1000) }),
  motif: z.enum(MOTIFS),
  radius: z.number().min(0).max(200),
  uppercase: z.boolean(),
  seed: z.number().int().min(0).max(2_147_483_647),
  /** Cores/fontes vieram da identidade do cliente. */
  fromIdentity: z.boolean(),
  /** Logo do cliente (nunca a da agência). */
  logo: z
    .object({
      fileId: z.uuid(),
      versionId: z.uuid(),
      width: z.number().int().min(1).max(20_000),
      height: z.number().int().min(1).max(20_000),
    })
    .nullable()
    .default(null),
  /** Nome exibido no rodapé quando não há logo (ex.: @perfil ou nome do cliente). */
  handle: s(80).default(""),
  notes: z.array(s(300)).max(10).default([]),
});
export type GeneratorDirection = z.infer<typeof generatorDirectionSchema>;

export const generatorInputSchema = z.object({
  topic: s(300),
  objective: s(500).default(""),
  audience: s(500).default(""),
  /** null = a IA decide (5 a 8). */
  slides: z.number().int().min(3).max(10).nullable().default(null),
  tone: s(160).default(""),
  format: z.enum(["portrait", "square"]).default("portrait"),
  clientId: z.uuid().nullable().default(null),
  useIdentity: z.boolean().default(true),
  references: s(2000).default(""),
  fileIds: z.array(z.uuid()).max(6).default([]),
  images: z.enum(["auto", "none"]).default("auto"),
});
export type GeneratorInput = z.infer<typeof generatorInputSchema>;

export const GENERATOR_ACTIONS = ["generated", "slide", "direction", "variant"] as const;

export const generatorMetaSchema = z.object({
  v: z.literal(1),
  mode: z.enum(["quick", "full"]),
  input: generatorInputSchema,
  plan: z.object({
    title: s(200),
    angle: s(600).default(""),
    objective: s(600).default(""),
    audience: s(600).default(""),
    narrative: s(1200).default(""),
    caption: s(2200).default(""),
    hashtags: z.array(s(60)).max(15).default([]),
    cta: s(240).default(""),
  }),
  slides: z.array(generatorSlideSchema).min(1).max(10),
  /** Afirmações que precisam de fonte antes de publicar. */
  claims: z
    .array(z.object({ text: s(400), slideKey: s(40).default(""), reason: s(400).default("") }))
    .max(20)
    .default([]),
  direction: generatorDirectionSchema,
  ai: z.object({
    provider: s(40),
    model: s(160),
    demo: z.boolean(),
    imageProvider: s(40).nullable().default(null),
    imageModel: s(160).nullable().default(null),
  }),
  /** "images": há imagens reais nos slides; "vector": só formas, ícones e tipografia. */
  visuals: z.enum(["images", "vector"]),
  warnings: z.array(s(400)).max(20).default([]),
  version: z.number().int().min(1).max(100_000),
  history: z
    .array(
      z.object({
        at: s(40),
        action: z.enum(GENERATOR_ACTIONS),
        slideKey: s(40).default(""),
        label: s(240),
      }),
    )
    .max(40)
    .default([]),
  /** Segunda versão: arte de origem. */
  variantOf: z.uuid().nullable().default(null),
  createdAt: s(40),
});
export type GeneratorMeta = z.infer<typeof generatorMetaSchema>;

export const importedMetaSchema = z.object({
  fileId: z.uuid(),
  versionId: z.uuid(),
  width: z.number().int().min(1).max(20_000),
  height: z.number().int().min(1).max(20_000),
  /** Camadas editáveis reconstruídas por um modelo com leitura de imagens. */
  reconstructed: z.boolean(),
  model: s(160).nullable().default(null),
});
export type ImportedMeta = z.infer<typeof importedMetaSchema>;
