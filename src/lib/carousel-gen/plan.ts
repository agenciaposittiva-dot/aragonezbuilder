import { z } from "zod";
import {
  SLIDE_ROLES,
  type GeneratorInput,
  type GeneratorSlide,
  type SlideRole,
  type VisualKind,
} from "@/lib/design-doc/generator";
import { shorten } from "./fit";
import { iconForText, isIconName } from "./icons";

/*
 * Plano devolvido pela IA (roteiro + direção sugerida) e as regras aplicadas
 * depois da resposta: quantidade de slides, capa e chamada final, limites de
 * texto, e a regra principal — nenhum número entra como dado sem estar nas
 * referências enviadas pela equipe; números citados viram "dados a confirmar".
 */

const str = (n: number) => z.string().max(n).catch("");

const aiSlide = z.object({
  role: z.string().max(40).catch("insight"),
  kicker: str(200).default(""),
  title: z.string().max(600),
  body: str(2000).default(""),
  bullets: z.array(z.string().max(500)).max(10).catch([]).default([]),
  columns: z
    .array(z.object({ label: z.string().max(200), items: z.array(z.string().max(400)).max(8) }))
    .max(3)
    .catch([])
    .default([]),
  stat: z
    .object({ value: str(60).default(""), label: str(400).default(""), source: str(500).default("") })
    .nullable()
    .catch(null)
    .default(null),
  chart: z
    .object({
      unit: str(30).default(""),
      source: str(500).default(""),
      items: z
        .array(z.object({ label: z.string().max(120), value: z.number().finite() }))
        .max(10)
        .catch([])
        .default([]),
    })
    .nullable()
    .catch(null)
    .default(null),
  visual: z
    .object({ kind: str(40).default("icon"), prompt: str(2000).default(""), icon: str(40).default("") })
    .catch({ kind: "icon", prompt: "", icon: "" })
    .default({ kind: "icon", prompt: "", icon: "" }),
});

export const aiPlanSchema = z.object({
  title: z.string().max(400),
  angle: str(1200).default(""),
  objective: str(1200).default(""),
  audience: str(1200).default(""),
  narrative: str(2400).default(""),
  caption: str(4000).default(""),
  hashtags: z.array(z.string().max(80)).max(30).catch([]).default([]),
  cta: str(300).default(""),
  slides: z.array(aiSlide).min(2).max(14),
  claims: z
    .array(
      z.object({
        text: z.string().max(600),
        slide: z.number().int().catch(0).default(0),
        reason: str(600).default(""),
      }),
    )
    .max(30)
    .catch([])
    .default([]),
  direction: z
    .object({
      style: str(40).default(""),
      mood: str(400).default(""),
      palette: z.array(z.string().max(20)).max(8).catch([]).default([]),
    })
    .catch({ style: "", mood: "", palette: [] })
    .default({ style: "", mood: "", palette: [] }),
});
export type AiPlan = z.infer<typeof aiPlanSchema>;
export const aiSlideSchema = aiSlide;
export type AiSlide = z.infer<typeof aiSlide>;

const S = { type: "string" };
const SLIDE_JSON = {
  type: "object",
  properties: {
    role: { type: "string", enum: [...SLIDE_ROLES] },
    kicker: S,
    title: S,
    body: S,
    bullets: { type: "array", items: S },
    columns: {
      type: "array",
      items: {
        type: "object",
        properties: { label: S, items: { type: "array", items: S } },
        required: ["label", "items"],
        additionalProperties: false,
      },
    },
    stat: {
      type: "object",
      properties: { value: S, label: S, source: S },
      required: ["value", "label", "source"],
      additionalProperties: false,
    },
    chart: {
      type: "object",
      properties: {
        unit: S,
        source: S,
        items: {
          type: "array",
          items: {
            type: "object",
            properties: { label: S, value: { type: "number" } },
            required: ["label", "value"],
            additionalProperties: false,
          },
        },
      },
      required: ["unit", "source", "items"],
      additionalProperties: false,
    },
    visual: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["image", "icon", "chart", "diagram", "typographic"] },
        prompt: S,
        icon: S,
      },
      required: ["kind", "prompt", "icon"],
      additionalProperties: false,
    },
  },
  required: ["role", "kicker", "title", "body", "bullets", "columns", "stat", "chart", "visual"],
  additionalProperties: false,
};

export const PLAN_JSON_SCHEMA = {
  type: "object",
  properties: {
    title: S,
    angle: S,
    objective: S,
    audience: S,
    narrative: S,
    caption: S,
    hashtags: { type: "array", items: S },
    cta: S,
    slides: { type: "array", items: SLIDE_JSON },
    claims: {
      type: "array",
      items: {
        type: "object",
        properties: { text: S, slide: { type: "integer" }, reason: S },
        required: ["text", "slide", "reason"],
        additionalProperties: false,
      },
    },
    direction: {
      type: "object",
      properties: { style: S, mood: S, palette: { type: "array", items: S } },
      required: ["style", "mood", "palette"],
      additionalProperties: false,
    },
  },
  required: [
    "title",
    "angle",
    "objective",
    "audience",
    "narrative",
    "caption",
    "hashtags",
    "cta",
    "slides",
    "claims",
    "direction",
  ],
  additionalProperties: false,
};

export const SLIDE_JSON_SCHEMA = {
  type: "object",
  properties: { slide: SLIDE_JSON, claims: PLAN_JSON_SCHEMA.properties.claims },
  required: ["slide", "claims"],
  additionalProperties: false,
};
export const slideResponseSchema = z.object({
  slide: aiSlide,
  claims: aiPlanSchema.shape.claims,
});

/* ------------------------------------------------------------------ */
/* Números: só os que a equipe informou                                 */
/* ------------------------------------------------------------------ */

const NUMBER = /\d+(?:[.,]\d+)*/g;

/** Números presentes no texto (normalizados, sem separador de milhar). */
export function numbersIn(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.match(NUMBER) ?? []) {
    const n = m.replace(/\.(?=\d{3}\b)/g, "").replace(",", ".");
    out.add(String(Number(n)));
  }
  return out;
}

const hasUnlistedNumber = (text: string, allowed: Set<string>) => [...numbersIn(text)].some((n) => !allowed.has(n));
/** Em textos, contagens pequenas ("5 dicas", "3 passos") são estrutura, não dado. */
const citesUnlistedNumber = (text: string, allowed: Set<string>) =>
  [...numbersIn(text)].some((n) => !allowed.has(n) && !(Number.isInteger(Number(n)) && Number(n) <= 12));

/* ------------------------------------------------------------------ */
/* Normalização                                                        */
/* ------------------------------------------------------------------ */

export type Claim = { text: string; slideKey: string; reason: string };

const LIMITS = {
  kicker: 40,
  title: { cover: 90, cta: 80, other: 110 },
  body: { cover: 150, other: 280 },
  bullet: 110,
  bullets: 5,
  columnItem: 90,
};

function role(r: string): SlideRole {
  const k = r.trim().toLowerCase();
  return (SLIDE_ROLES as readonly string[]).includes(k) ? (k as SlideRole) : "insight";
}

/**
 * Converte um slide da IA em slide do gerador aplicando limites e a regra de
 * números. Devolve também as afirmações a confirmar e os avisos.
 */
export function normalizeSlide(
  s: AiSlide,
  o: {
    key: string;
    pageId: string;
    allowed: Set<string>;
    imagesAvailable: boolean;
    topic: string;
    forceRole?: SlideRole;
  },
): { slide: GeneratorSlide; claims: Claim[]; warnings: string[] } {
  const claims: Claim[] = [];
  const warnings: string[] = [];
  let r = o.forceRole ?? role(s.role);
  const titleMax = r === "cover" ? LIMITS.title.cover : r === "cta" ? LIMITS.title.cta : LIMITS.title.other;
  const title = shorten(s.title || o.topic, titleMax);
  const body = shorten(s.body, r === "cover" ? LIMITS.body.cover : LIMITS.body.other);
  const bullets = s.bullets
    .map((b) => shorten(b, LIMITS.bullet))
    .filter(Boolean)
    .slice(0, LIMITS.bullets);
  const columns =
    s.columns.length >= 2
      ? s.columns.slice(0, 2).map((c) => ({
          label: shorten(c.label, 28),
          items: c.items
            .map((i) => shorten(i, LIMITS.columnItem))
            .filter(Boolean)
            .slice(0, 4),
        }))
      : [];

  let stat: GeneratorSlide["stat"] = null;
  if (s.stat?.value.trim()) {
    const value = s.stat.value.trim().slice(0, 24);
    if (!hasUnlistedNumber(value, o.allowed)) {
      stat = { value, label: shorten(s.stat.label, 160), source: shorten(s.stat.source, 200) };
      if (!stat.source)
        claims.push({
          text: `${value} — ${stat.label}`.slice(0, 380),
          slideKey: o.key,
          reason: "Número das referências: informe a fonte antes de publicar.",
        });
    } else if (s.stat.source.trim()) {
      stat = { value, label: shorten(s.stat.label, 160), source: shorten(s.stat.source, 200) };
      claims.push({
        text: `${value} — ${stat.label}`.slice(0, 380),
        slideKey: o.key,
        reason: `Número citado pela IA (fonte indicada: ${stat.source}). Confirme na fonte original.`,
      });
    } else {
      warnings.push(`Slide "${title}": o número "${value}" não estava nas referências e foi retirado.`);
    }
  }
  let chart: GeneratorSlide["chart"] = null;
  if (s.chart && s.chart.items.length >= 2) {
    const items = s.chart.items.slice(0, 6).map((i) => ({ label: shorten(i.label, 24), value: i.value }));
    const invented = items.some((i) => !o.allowed.has(String(i.value)));
    if (!invented) chart = { unit: s.chart.unit.slice(0, 12), items, source: shorten(s.chart.source, 200) };
    else warnings.push(`Slide "${title}": o gráfico usava valores que não estavam nas referências e foi retirado.`);
  }
  if (r === "data" && !stat && !chart) r = "insight";
  if (r === "comparison" && columns.length < 2) r = bullets.length ? "list" : "insight";
  if ((r === "list" || r === "steps" || r === "summary") && !bullets.length && body) {
    // Lista sem itens: o texto vira itens por frase.
    bullets.push(
      ...body
        .split(/(?<=[.!?])\s+/)
        .map((x) => shorten(x, LIMITS.bullet))
        .filter(Boolean)
        .slice(0, LIMITS.bullets),
    );
  }

  for (const [field, text] of [
    ["título", title],
    ["texto", body],
    ...bullets.map((b) => ["item", b] as const),
  ] as const) {
    if (citesUnlistedNumber(text, o.allowed))
      claims.push({
        text: text.slice(0, 380),
        slideKey: o.key,
        reason: `O ${field} cita número que não estava nas referências: confirme ou retire.`,
      });
  }

  let kind = (["image", "icon", "chart", "diagram", "typographic"] as const).find((k) => k === s.visual.kind) ?? "icon";
  if (kind === "image" && !o.imagesAvailable) kind = "icon";
  if (kind === "chart" && !chart) kind = "icon";
  const icon = isIconName(s.visual.icon) ? s.visual.icon : (iconForText(`${title} ${body}`) ?? "");
  return {
    slide: {
      key: o.key,
      pageId: o.pageId,
      role: r,
      kicker: shorten(s.kicker, LIMITS.kicker),
      title,
      body,
      bullets,
      columns,
      stat,
      chart,
      visual: { kind: kind as VisualKind, prompt: s.visual.prompt.slice(0, 800), icon, image: null },
      layout: "",
    },
    claims,
    warnings,
  };
}

/** Escolhe quais slides mantêm quando a IA devolve mais do que o pedido (capa e fim ficam). */
function trimSlides<T>(list: T[], n: number): T[] {
  if (list.length <= n) return list;
  const first = list[0]!;
  const last = list.at(-1)!;
  return [first, ...list.slice(1, n - 1), last];
}

export function normalizePlan(
  ai: AiPlan,
  input: GeneratorInput,
  o: { imagesAvailable: boolean; newKey: (i: number) => string; newPageId: () => string; brandText?: string },
) {
  const allowed = numbersIn([input.topic, input.objective, input.audience, input.tone, input.references].join("\n"));
  const target = input.slides ?? Math.min(8, Math.max(5, ai.slides.length));
  const raw = trimSlides(ai.slides, target);
  const warnings: string[] = [];
  if (input.slides && raw.length < input.slides)
    warnings.push(
      `A IA devolveu ${raw.length} slides em vez de ${input.slides}. Regenere ou adicione páginas no editor.`,
    );
  const claims: Claim[] = [];
  const slides = raw.map((s, i) => {
    const forceRole =
      i === 0
        ? "cover"
        : i === raw.length - 1 && raw.length >= 4 && role(s.role) !== "summary"
          ? "cta"
          : role(s.role) === "cover"
            ? "insight"
            : undefined;
    const r = normalizeSlide(s, {
      key: o.newKey(i),
      pageId: o.newPageId(),
      allowed,
      imagesAvailable: o.imagesAvailable,
      topic: input.topic,
      forceRole,
    });
    claims.push(...r.claims);
    warnings.push(...r.warnings);
    return r.slide;
  });
  // Afirmações apontadas pela própria IA.
  for (const c of ai.claims) {
    const slide = slides[c.slide - 1];
    claims.push({
      text: shorten(c.text, 380),
      slideKey: slide?.key ?? "",
      reason: shorten(c.reason || "Afirmação que precisa de fonte.", 380),
    });
  }
  return {
    slides,
    claims: dedupeClaims(claims).slice(0, 20),
    warnings: [...new Set(warnings)].slice(0, 20),
    plan: {
      title: shorten(ai.title || input.topic, 200),
      angle: shorten(ai.angle, 600),
      objective: shorten(ai.objective || input.objective, 600),
      audience: shorten(ai.audience || input.audience, 600),
      narrative: shorten(ai.narrative, 1200),
      caption: ai.caption.slice(0, 2200),
      hashtags: ai.hashtags
        .map((h) => `#${h.replace(/^#+/, "").replace(/\s+/g, "")}`.slice(0, 60))
        .filter((h) => h.length > 1)
        .slice(0, 15),
      cta: shorten(ai.cta, 60),
    },
    suggestion: { style: ai.direction.style, palette: ai.direction.palette },
  };
}

function dedupeClaims(list: Claim[]) {
  const seen = new Set<string>();
  return list.filter((c) => {
    const k = `${c.slideKey}|${c.text}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
