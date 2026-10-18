/*
 * Radar de Marca (diagnóstico do Instagram). Vocabulário, metodologia de
 * pontuação e regras objetivas, compartilhados entre servidor e interface.
 *
 * Princípios:
 *  - cada dado guarda a fonte e a data da coleta;
 *  - métricas só vêm de fonte real (API oficial conectada); nada é estimado;
 *  - a IA produz AVALIAÇÕES (hipóteses), separadas do que foi observado;
 *  - dimensões sem dados suficientes ficam fora da nota e aparecem como
 *    "não avaliada" — a nota é a média ponderada só do que foi avaliado.
 */

/** Versão da metodologia. Mudou critério ou peso padrão? Suba a versão (comparações avisam). */
export const BRAND_METHODOLOGY_VERSION = "1";

/** Limite atual da bio do Instagram (configurável por organização). */
export const DEFAULT_BIO_LIMIT = 150;

export type DimensionKind = "objective" | "ai";
export type DimensionStatus = "objective" | "ai" | "not_evaluated";
export type Basis = "observed" | "hypothesis" | "insufficient";

/** O que cada dimensão precisa para ser avaliada. */
export type Requirement = "profile_text" | "highlights" | "posts" | "visual" | "niche" | "metrics";

export const BRAND_DIMENSIONS = {
  positioning: {
    label: "Clareza do posicionamento",
    kind: "ai",
    weight: 12,
    requires: ["profile_text"],
    criteria:
      "Em poucos segundos dá para entender o que a marca faz, para quem e por que escolhê-la (bio, nome, categoria e destaques informados).",
  },
  bio: {
    label: "Qualidade da biografia",
    kind: "ai",
    weight: 12,
    requires: ["profile_text"],
    criteria:
      "Bio clara sobre o que a marca faz, público, benefício/diferencial, prova de confiança e chamada para ação, dentro do limite de caracteres.",
  },
  completeness: {
    label: "Completude do perfil",
    kind: "objective",
    weight: 6,
    requires: ["profile_text"],
    criteria:
      "Regra objetiva: bio preenchida, dentro do limite, com chamada para ação, link, categoria/nome e destaques. Cada item vale a mesma parte.",
  },
  visual: {
    label: "Identidade visual",
    kind: "ai",
    weight: 12,
    requires: ["visual"],
    criteria:
      "Consistência de cores, tipografia, hierarquia e legibilidade nas imagens enviadas. Só é avaliada com capturas de tela e um modelo que lê imagens.",
  },
  highlights: {
    label: "Organização dos destaques",
    kind: "ai",
    weight: 8,
    requires: ["highlights"],
    criteria: "Destaques que respondem às dúvidas da jornada de compra do público, em ordem lógica e com nomes claros.",
  },
  content: {
    label: "Qualidade e consistência do conteúdo",
    kind: "ai",
    weight: 12,
    requires: ["posts"],
    criteria:
      "Equilíbrio entre autoridade, educação, prova social, relacionamento e conversão nas publicações informadas.",
  },
  cta: {
    label: "Clareza das chamadas para ação",
    kind: "ai",
    weight: 8,
    requires: ["profile_text"],
    criteria: "Próximo passo claro para o público (bio, link e publicações informadas).",
  },
  audience: {
    label: "Adequação ao público e ao nicho",
    kind: "ai",
    weight: 10,
    requires: ["niche"],
    criteria: "Linguagem, temas e oferta coerentes com o público e o nicho cadastrados para o cliente.",
  },
  formats: {
    label: "Uso estratégico dos formatos",
    kind: "objective",
    weight: 6,
    requires: ["posts"],
    criteria:
      "Regra objetiva sobre as publicações com formato conhecido: variedade de formatos (imagem, carrossel, vídeo/Reels) e nenhum formato acima de 70% do total.",
  },
  consistency: {
    label: "Consistência da comunicação",
    kind: "ai",
    weight: 8,
    requires: ["posts"],
    criteria: "Tom de voz e mensagem coerentes entre bio, destaques e publicações.",
  },
  performance: {
    label: "Desempenho",
    kind: "objective",
    weight: 6,
    requires: ["metrics"],
    criteria:
      "Regra objetiva, só com métricas reais da conta conectada: média de interações (curtidas + comentários) por publicação em relação aos seguidores. Sem métricas reais, não é avaliada.",
  },
} as const satisfies Record<
  string,
  { label: string; kind: DimensionKind; weight: number; requires: Requirement[]; criteria: string }
>;
export type DimensionKey = keyof typeof BRAND_DIMENSIONS;
export const DIMENSION_KEYS = Object.keys(BRAND_DIMENSIONS) as DimensionKey[];

export const BASIS_LABEL: Record<Basis, string> = {
  observed: "Observado",
  hypothesis: "Avaliação da IA",
  insufficient: "Informação insuficiente",
};

export const RECOMMENDATION_CATEGORIES = {
  fix_now: "Corrigir agora",
  improve_soon: "Melhorar em breve",
  strategic: "Oportunidade estratégica",
  monitor: "Monitorar",
  insufficient: "Informação insuficiente",
} as const;
export type RecommendationCategory = keyof typeof RECOMMENDATION_CATEGORIES;

export const RECOMMENDATION_STATUS = {
  open: "Aberta",
  in_progress: "Em andamento",
  done: "Concluída",
  dismissed: "Descartada",
} as const;
export type RecommendationStatus = keyof typeof RECOMMENDATION_STATUS;

export const LEVEL3 = { alto: "Alto", medio: "Médio", baixo: "Baixo" } as const;
export type Level3 = keyof typeof LEVEL3;

export const RECOMMENDATION_AREAS = {
  bio: "Biografia",
  highlights: "Destaques",
  visual: "Identidade visual",
  content: "Conteúdo",
  niche: "Nicho e concorrentes",
  cta: "Chamadas para ação",
  profile: "Perfil",
} as const;
export type RecommendationArea = keyof typeof RECOMMENDATION_AREAS;

export const CONTENT_CATEGORIES = {
  authority: "Autoridade",
  education: "Educação",
  social_proof: "Prova social",
  behind_scenes: "Bastidores",
  relationship: "Relacionamento",
  conversion: "Conversão",
  institutional: "Institucional",
  entertainment: "Entretenimento",
  positioning: "Posicionamento de marca",
} as const;
export type ContentCategory = keyof typeof CONTENT_CATEGORIES;

export const PRESENCE = {
  present: "Presente",
  low: "Pouco explorada",
  absent: "Ausente",
  unknown: "Não dá para avaliar",
} as const;
export type Presence = keyof typeof PRESENCE;

export const BIO_STYLES = {
  direct: "Direta e comercial",
  strategic: "Estratégica e orientada ao posicionamento",
  creative: "Criativa e diferenciada",
  custom: "Versão editada",
} as const;
export type BioStyle = keyof typeof BIO_STYLES;

export const POST_FORMATS = { image: "Imagem", carousel: "Carrossel", video: "Vídeo / Reels" } as const;
export type PostFormat = keyof typeof POST_FORMATS;

export const SCREENSHOT_KINDS = {
  profile: "Perfil e bio",
  grid: "Grade de publicações",
  highlights: "Destaques",
  metrics: "Métricas",
  other: "Outra",
} as const;
export type ScreenshotKind = keyof typeof SCREENSHOT_KINDS;

export const DIAGNOSIS_KINDS = {
  full: "Diagnóstico completo",
  bio: "Reescrita da bio",
  niche: "Nicho e concorrentes",
} as const;
export type DiagnosisKind = keyof typeof DIAGNOSIS_KINDS;

/* ------------------------------------------------------------------ */
/* Dados de entrada                                                    */
/* ------------------------------------------------------------------ */

export type SourceKind = "manual" | "screenshot" | "instagram_api" | "client_record";
export const SOURCE_LABEL: Record<SourceKind, string> = {
  manual: "Informado pela equipe",
  screenshot: "Captura de tela enviada",
  instagram_api: "Instagram (API oficial)",
  client_record: "Cadastro do cliente",
};

/** Um valor com origem e data (nada aparece sem dizer de onde veio). */
export type Sourced<T> = { value: T; source: SourceKind; collectedAt: string };

export type ManualPost = { format: PostFormat | null; text: string };
export type ApiPost = {
  id: string;
  format: PostFormat;
  caption: string;
  timestamp: string | null;
  likes: number | null;
  comments: number | null;
  permalink: string | null;
};
export type Screenshot = { fileId: string; versionId: string; kind: ScreenshotKind; name: string };

/** Rascunho dos dados manuais (guardado no perfil até a próxima análise). */
export type ManualInputs = {
  displayName: string;
  category: string;
  bio: string;
  link: string;
  /** Seguidores informados pela equipe (dado informado, não verificado). */
  followers: number | null;
  highlights: string[];
  posts: ManualPost[];
  goals: string;
  notes: string;
  screenshots: Screenshot[];
  updatedAt: string | null;
};

export const EMPTY_MANUAL: ManualInputs = {
  displayName: "",
  category: "",
  bio: "",
  link: "",
  followers: null,
  highlights: [],
  posts: [],
  goals: "",
  notes: "",
  screenshots: [],
  updatedAt: null,
};

/** Fotografia dos dados usados em uma análise (gravada junto com o diagnóstico). */
export type DiagnosisInputs = {
  handle: string;
  profileUrl: string;
  sources: { kind: SourceKind; label: string; collectedAt: string }[];
  profile: {
    displayName: Sourced<string> | null;
    category: Sourced<string> | null;
    bio: Sourced<string> | null;
    link: Sourced<string> | null;
    followers: Sourced<number> | null;
    following: Sourced<number> | null;
    postsCount: Sourced<number> | null;
  };
  highlights: Sourced<string[]> | null;
  posts: { items: (ManualPost | ApiPost)[]; source: SourceKind; collectedAt: string } | null;
  screenshots: Screenshot[];
  brand: {
    audience: string | null;
    positioning: string | null;
    toneOfVoice: string | null;
    objectives: string | null;
    industry: string | null;
  } | null;
  niche: { niche: string | null; market: string | null; region: string | null };
  goals: string;
  notes: string;
  competitors: { handle: string; notes: string; bio: string }[];
  missing: string[];
};

/* ------------------------------------------------------------------ */
/* Regras objetivas e pontuação                                        */
/* ------------------------------------------------------------------ */

/** Aceita @usuario, usuario ou URL do perfil. Devolve o @ sem o símbolo, ou null. */
export function normalizeHandle(input: string): string | null {
  let v = input.trim();
  const m = /instagram\.com\/([^/?#\s]+)/i.exec(v);
  if (m) v = m[1]!;
  v = v.replace(/^@/, "").replace(/\/+$/, "").toLowerCase();
  if (!/^[a-z0-9._]{1,30}$/.test(v) || v.startsWith(".") || v.endsWith(".") || v.includes("..")) return null;
  return v;
}

export const profileUrlOf = (handle: string) => `https://www.instagram.com/${handle}/`;

/** Contagem como o público vê (emoji e acentos contam como um caractere). */
export function countChars(text: string): number {
  return [...text].length;
}

const CTA_RE =
  /(clique|toque|acesse|agende|agendar|fale|chame|peça|pedir|compre|comprar|reserve|reservar|saiba|baixe|inscreva|link|whats|direct|dm|contato|orçamento|👇|⬇)/i;

export function hasCallToAction(text: string): boolean {
  return CTA_RE.test(text);
}

/** Números presentes nos dados de entrada (a IA não pode afirmar outros). */
export function numbersIn(text: string): Set<string> {
  return new Set((text.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => n.replace(",", ".")));
}

export type ObjectiveResult = { score: number | null; checks: { label: string; ok: boolean | null }[]; note: string };

export function completenessScore(i: DiagnosisInputs, bioLimit: number): ObjectiveResult {
  const bio = i.profile.bio?.value ?? "";
  const checks = [
    { label: "Bio preenchida", ok: bio.trim().length > 0 },
    { label: `Bio dentro do limite (${bioLimit} caracteres)`, ok: bio ? countChars(bio) <= bioLimit : false },
    { label: "Chamada para ação na bio", ok: bio ? hasCallToAction(bio) : false },
    { label: "Link no perfil", ok: !!i.profile.link?.value.trim() },
    {
      label: "Nome de exibição ou categoria",
      ok: !!(i.profile.displayName?.value.trim() || i.profile.category?.value.trim()),
    },
    { label: "Destaques", ok: i.highlights ? i.highlights.value.length > 0 : null },
  ];
  const known = checks.filter((c) => c.ok !== null);
  if (!i.profile.bio && !i.profile.displayName && !i.profile.link) {
    return { score: null, checks, note: "Sem dados do perfil para conferir." };
  }
  const score = Math.round((known.filter((c) => c.ok).length / known.length) * 100);
  return {
    score,
    checks,
    note: checks.some((c) => c.ok === null)
      ? "Destaques não informados: ficaram fora da conta."
      : "Conferência automática dos itens básicos do perfil.",
  };
}

export function formatsScore(i: DiagnosisInputs): ObjectiveResult {
  const formats = (i.posts?.items ?? []).map((p) => p.format).filter((f): f is PostFormat => !!f);
  if (formats.length < 3) {
    return { score: null, checks: [], note: "Menos de 3 publicações com formato conhecido: não avaliada." };
  }
  const counts = new Map<PostFormat, number>();
  for (const f of formats) counts.set(f, (counts.get(f) ?? 0) + 1);
  const distinct = counts.size;
  const top = Math.max(...counts.values()) / formats.length;
  const checks = [
    { label: "Usa 2 formatos ou mais", ok: distinct >= 2 },
    { label: "Usa os 3 formatos (imagem, carrossel e vídeo/Reels)", ok: distinct >= 3 },
    { label: "Nenhum formato acima de 70% das publicações", ok: top <= 0.7 },
  ];
  const score = Math.round((checks.filter((c) => c.ok).length / checks.length) * 100);
  const parts = [...counts.entries()].map(([f, n]) => `${POST_FORMATS[f]}: ${n}`).join(", ");
  return { score, checks, note: `Publicações analisadas: ${formats.length} (${parts}).` };
}

/**
 * Desempenho só com métricas reais da API: média de (curtidas + comentários)
 * por publicação dividida pelos seguidores. Faixas da metodologia v1:
 * ≥ 3% → 100; 1–3% → 70; 0,5–1% → 45; < 0,5% → 25. É uma referência interna,
 * não um padrão oficial do Instagram.
 */
export function performanceScore(i: DiagnosisInputs): ObjectiveResult & { rate: number | null } {
  const followers = i.profile.followers?.source === "instagram_api" ? i.profile.followers.value : null;
  const posts = i.posts?.source === "instagram_api" ? (i.posts.items as ApiPost[]) : [];
  const measured = posts.filter((p) => p.likes !== null || p.comments !== null);
  if (!followers || measured.length < 3) {
    return {
      score: null,
      rate: null,
      checks: [],
      note: "Sem métricas reais da conta conectada (seguidores e interações por publicação): não avaliada.",
    };
  }
  const avg = measured.reduce((n, p) => n + (p.likes ?? 0) + (p.comments ?? 0), 0) / measured.length;
  const rate = avg / followers;
  const score = rate >= 0.03 ? 100 : rate >= 0.01 ? 70 : rate >= 0.005 ? 45 : 25;
  return {
    score,
    rate,
    checks: [],
    note: `Média de ${Math.round(avg)} interações por publicação em ${measured.length} publicações, ${followers} seguidores (API oficial).`,
  };
}

/** Quais requisitos os dados atendem. `vision`: o modelo escolhido lê imagens. */
export function availableRequirements(i: DiagnosisInputs, vision: boolean): Set<Requirement> {
  const out = new Set<Requirement>();
  if (i.profile.bio?.value.trim() || i.profile.displayName?.value.trim() || i.profile.category?.value.trim())
    out.add("profile_text");
  if (i.highlights?.value.length || (vision && i.screenshots.some((s) => s.kind === "highlights")))
    out.add("highlights");
  if (i.posts?.items.length || (vision && i.screenshots.some((s) => s.kind === "grid"))) out.add("posts");
  if (vision && i.screenshots.length) out.add("visual");
  if (i.niche.niche || i.brand?.audience || i.brand?.positioning || i.brand?.industry) out.add("niche");
  if (i.profile.followers?.source === "instagram_api" && i.posts?.source === "instagram_api") out.add("metrics");
  return out;
}

export type DimensionResult = {
  key: DimensionKey;
  score: number | null;
  status: DimensionStatus;
  rationale: string;
  evidence: string;
};

export function normalizeWeights(custom: Partial<Record<string, number>> | undefined): Record<DimensionKey, number> {
  const out = {} as Record<DimensionKey, number>;
  for (const k of DIMENSION_KEYS) {
    const v = custom?.[k];
    out[k] = typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : BRAND_DIMENSIONS[k].weight;
  }
  return out;
}

/** Média ponderada só das dimensões avaliadas. Sem nenhuma avaliada → null. */
export function overallScore(dims: DimensionResult[], weights: Record<DimensionKey, number>) {
  let total = 0;
  let weight = 0;
  for (const d of dims) {
    if (d.score === null || d.status === "not_evaluated") continue;
    const w = weights[d.key] ?? 0;
    total += d.score * w;
    weight += w;
  }
  const allWeight = DIMENSION_KEYS.reduce((n, k) => n + (weights[k] ?? 0), 0);
  return {
    score: weight > 0 ? Math.round(total / weight) : null,
    evaluatedWeight: weight,
    totalWeight: allWeight,
  };
}

export function scoreTone(score: number | null): "success" | "warning" | "danger" | "neutral" {
  if (score === null) return "neutral";
  return score >= 75 ? "success" : score >= 50 ? "warning" : "danger";
}

/* ------------------------------------------------------------------ */
/* Resultado do diagnóstico (gravado em jsonb)                          */
/* ------------------------------------------------------------------ */

export type Finding = { text: string; basis: Basis; evidence: string };

export type BioVersionDraft = {
  style: Exclude<BioStyle, "custom">;
  text: string;
  objective: string;
  strengths: string[];
  cta: string;
  warnings: string[];
  chars: number;
  overLimit: boolean;
};

export type HighlightPlan = {
  name: string;
  objective: string;
  order: number;
  storyIdeas: string[];
  coverDirection: string;
  coverPrompt: string;
};

export type DiagnosisResult = {
  demo: boolean;
  summary: string;
  strengths: Finding[];
  problems: Finding[];
  opportunities: Finding[];
  dimensions: DimensionResult[];
  objective: { completeness: ObjectiveResult; formats: ObjectiveResult; performance: ObjectiveResult };
  bio: {
    current: string | null;
    chars: number | null;
    limit: number;
    audit: { criterion: string; assessment: "ok" | "improve" | "missing" | "not_evaluated"; note: string }[];
    versions: BioVersionDraft[];
  } | null;
  highlights: { current: string[]; assessment: string; basis: Basis; recommended: HighlightPlan[] } | null;
  visual: {
    evaluated: boolean;
    note: string;
    items: { criterion: string; assessment: string; basis: Basis }[];
  } | null;
  content: {
    categories: { key: ContentCategory; presence: Presence; note: string }[];
    recommendations: { idea: string; hypothesis: string; howToTest: string }[];
  } | null;
  niche: {
    summary: string;
    facts: string[];
    hypotheses: string[];
    opportunities: string[];
    competitors: { handle: string; positioning: string; differences: string; basis: Basis }[];
  } | null;
  plan30: { week: number; focus: string; actions: string[] }[];
  /** Regras aplicadas depois da resposta da IA (transparência). */
  guardrails: string[];
};

/** Resultado de "Reescrever minha bio" (diagnóstico do tipo bio). */
export type BioRewriteResult = {
  demo: boolean;
  summary: string;
  bio: NonNullable<DiagnosisResult["bio"]>;
  guardrails: string[];
};

/** Resultado de "Encontrar oportunidades no meu nicho" / "Comparar com concorrentes". */
export type NicheResult = {
  demo: boolean;
  summary: string;
  niche: NonNullable<DiagnosisResult["niche"]>;
  guardrails: string[];
};

/** Recomendação devolvida pela IA, já validada pelas regras do sistema. */
export type RecommendationDraft = {
  area: RecommendationArea;
  category: RecommendationCategory;
  title: string;
  problem: string;
  evidence: string;
  evidenceSource: string;
  basis: Basis;
  impact: Level3;
  effort: Level3;
  priority: number;
  confidence: Level3;
  nextAction: string;
  howToTest: string;
};

/** Ações de IA do painel (todas usam o seletor universal de modelos). */
export const BRAND_AI_ACTIONS = {
  analyze: { label: "Analisar meu perfil", kind: "full", focus: null },
  bio: { label: "Reescrever minha bio", kind: "bio", focus: null },
  highlights: { label: "Planejar meus destaques", kind: "full", focus: "destaques (nomes, ordem, Stories e capas)" },
  visual: { label: "Melhorar a identidade visual", kind: "full", focus: "identidade visual e grade" },
  niche: { label: "Encontrar oportunidades no meu nicho", kind: "niche", focus: "oportunidades do nicho" },
  competitors: {
    label: "Comparar com concorrentes",
    kind: "niche",
    focus: "comparação com os concorrentes cadastrados",
  },
  plan: { label: "Montar plano de ação de 30 dias", kind: "full", focus: "plano de ação de 30 dias" },
  reassess: { label: "Reavaliar depois das mudanças", kind: "full", focus: "o que mudou desde o diagnóstico anterior" },
} as const satisfies Record<string, { label: string; kind: DiagnosisKind; focus: string | null }>;
export type BrandAiAction = keyof typeof BRAND_AI_ACTIONS;
