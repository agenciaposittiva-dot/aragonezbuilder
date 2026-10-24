import { z } from "zod";

/*
 * Máquina de Conteúdo — vocabulário e estado do assistente (compartilhado entre
 * servidor e interface). O estado é salvo no projeto a cada mudança; os
 * resultados (arte, peça de conteúdo) ficam nos módulos de sempre e o projeto
 * só aponta para eles.
 */

export const MACHINE_STEPS = [
  { n: 1, key: "client", label: "Cliente", short: "Cliente" },
  { n: 2, key: "topic", label: "Assunto", short: "Assunto" },
  { n: 3, key: "angle", label: "Ângulo", short: "Ângulo" },
  { n: 4, key: "format", label: "Formato e objetivo", short: "Formato" },
  { n: 5, key: "generate", label: "Gerar conteúdo", short: "Gerar" },
  { n: 6, key: "visual", label: "Identidade visual", short: "Visual" },
  { n: 7, key: "editor", label: "Revisar no editor", short: "Editor" },
  { n: 8, key: "preview", label: "Visualizar", short: "Prévia" },
  { n: 9, key: "deliver", label: "Aprovar e planejar", short: "Aprovar" },
] as const;
export type MachineStepKey = (typeof MACHINE_STEPS)[number]["key"];
export const stepLabel = (n: number) => MACHINE_STEPS.find((s) => s.n === n)?.label ?? "";

export const SOURCE_KINDS = {
  idea: "Ideia própria",
  trend: "Tema do Radar de Tendências",
  link: "Link ou artigo",
  text: "Texto colado",
  file: "Arquivo de texto",
} as const;
export type SourceKind = keyof typeof SOURCE_KINDS;

export const ANGLE_TYPES = {
  belief: "Quebra de crença",
  mistakes: "Erros comuns",
  myths: "Mitos e verdades",
  steps: "Passo a passo",
  comparison: "Comparação",
  before_after: "Antes e depois (com evidência)",
  explained: "Tendência explicada",
  story: "História ou estudo de caso",
  problem_solution: "Problema e solução",
  opportunity: "Oportunidade de mercado",
  backstage: "Bastidores",
  opinion: "Opinião fundamentada",
  practical: "Aplicação prática ao nicho",
  commercial: "Comercial com abordagem educativa",
} as const;
export type AngleType = keyof typeof ANGLE_TYPES;

/** Formatos disponíveis nesta fase (só o que está implementado aparece na tela). */
export const MACHINE_FORMATS = {
  carousel: "Carrossel",
} as const;
export type MachineFormat = keyof typeof MACHINE_FORMATS;

export const MACHINE_OBJECTIVES = {
  educate: "Educar",
  engage: "Engajar e gerar conversa",
  authority: "Construir autoridade",
  convert: "Converter (venda ou contato)",
  institutional: "Institucional",
} as const;
export type MachineObjective = keyof typeof MACHINE_OBJECTIVES;

const str = (n: number) => z.string().trim().max(n);

export const machineSourceSchema = z.object({
  kind: z.enum(Object.keys(SOURCE_KINDS) as [SourceKind, ...SourceKind[]]),
  /** Ideia, texto colado ou o texto extraído do link/arquivo (usado como referência do roteiro). */
  text: str(8000).default(""),
  title: str(300).default(""),
  url: str(2000).nullable().default(null),
  siteName: str(160).nullable().default(null),
  trendId: z.uuid().nullable().default(null),
  fileId: z.uuid().nullable().default(null),
  /** Data da publicação (quando a fonte informa) ou da coleta, ISO. */
  publishedAt: str(40).nullable().default(null),
  collectedAt: str(40).nullable().default(null),
});
export type MachineSource = z.infer<typeof machineSourceSchema>;

export const opportunitySchema = z.object({
  title: str(300),
  summary: str(1500).default(""),
  /** Vêm dos dados coletados (nunca da IA). */
  sourceName: str(200).nullable().default(null),
  sourceUrl: str(2000).nullable().default(null),
  date: str(40).nullable().default(null),
  dateKind: z.enum(["published", "collected", "none"]).default("none"),
  /** "trending" só com observações reais do Radar; o resto é hipótese editorial. */
  evidence: z.enum(["trending", "hypothesis"]),
  evidenceNote: str(400).default(""),
  relevance: str(800).default(""),
  nicheRelation: str(800).default(""),
  angleHints: z.array(str(200)).max(8).default([]),
  risks: z.array(str(300)).max(8).default([]),
  /** Faltam informações da marca: proposta provisória. */
  provisional: z.boolean().default(false),
  model: str(160).nullable().default(null),
  demo: z.boolean().default(false),
  at: str(40).nullable().default(null),
});
export type Opportunity = z.infer<typeof opportunitySchema>;

export const angleSchema = z.object({
  id: str(40),
  type: z.enum(Object.keys(ANGLE_TYPES) as [AngleType, ...AngleType[]]).catch("practical"),
  hook: str(240),
  idea: str(600),
  audience: str(300).default(""),
  objective: str(300).default(""),
  differential: str(400).default(""),
  format: str(60).default("carousel"),
  cta: str(200).default(""),
  sourcesNeeded: z.array(str(240)).max(6).default([]),
});
export type Angle = z.infer<typeof angleSchema>;

const selection = z.record(z.string(), z.unknown()).nullable().default(null);

export const machineStateSchema = z.object({
  source: machineSourceSchema.nullable().default(null),
  opportunity: opportunitySchema.nullable().default(null),
  angles: z.array(angleSchema).max(30).default([]),
  angleId: str(40).nullable().default(null),
  format: z.enum(Object.keys(MACHINE_FORMATS) as [MachineFormat, ...MachineFormat[]]).default("carousel"),
  objective: z.enum(Object.keys(MACHINE_OBJECTIVES) as [MachineObjective, ...MachineObjective[]]).default("educate"),
  audience: str(500).default(""),
  tone: str(160).default(""),
  /** null = sugestão automática pelo assunto. */
  slides: z.number().int().min(3).max(10).nullable().default(null),
  aspect: z.enum(["portrait", "square"]).default("portrait"),
  images: z.enum(["auto", "none"]).default("auto"),
  maxImages: z.number().int().min(0).max(4).default(2),
  /** Escolha de IA por etapa (seletor universal). */
  ai: z
    .object({ research: selection, strategy: selection, copy: selection, image: selection })
    .default({ research: null, strategy: null, copy: null, image: null }),
  /** Resumo da última geração (avisos e dados a confirmar). */
  generation: z
    .object({
      at: str(40),
      model: str(160).default(""),
      demo: z.boolean().default(false),
      slides: z.number().int().min(0).max(20).default(0),
      warnings: z.array(str(400)).max(20).default([]),
      claims: z
        .array(z.object({ text: str(400), reason: str(400).default("") }))
        .max(20)
        .default([]),
    })
    .nullable()
    .default(null),
});
export type MachineState = z.infer<typeof machineStateSchema>;

export const emptyMachineState = (): MachineState => machineStateSchema.parse({});

/** Ângulo escolhido (com as edições da pessoa). */
export const chosenAngle = (s: MachineState) => s.angles.find((a) => a.id === s.angleId) ?? null;

/** Até onde a pessoa pode ir: cada etapa depende das anteriores. */
export function reachableStep(s: MachineState, hasResult: boolean): number {
  if (!s.source || !(s.source.text || s.source.title)) return 2;
  if (!chosenAngle(s)) return 3;
  if (!hasResult) return 5;
  return 9;
}
