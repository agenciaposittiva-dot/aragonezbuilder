import { and, desc, eq, ilike, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  ANGLE_TYPES,
  angleSchema,
  chosenAngle,
  emptyMachineState,
  MACHINE_OBJECTIVES,
  machineStateSchema,
  reachableStep,
  type Angle,
  type MachineSource,
  type MachineState,
  type Opportunity,
} from "@/lib/content-machine";
import { readDesignDocument } from "@/lib/design-doc";
import {
  assertCan,
  assertClientAccess,
  assertFileAccess,
  assertInternal,
  can,
  clientScope,
  inOrg,
  type Actor,
  type Scope,
} from "@/server/authz";
import {
  brandProfiles,
  clients,
  contentItemAssets,
  contentItems,
  contentMachineProjects,
  designs,
  files,
  fileVersions,
  projects,
  trendObservations,
  trends,
  trendSources,
} from "@/server/db/schema";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { getStorage } from "@/server/storage";
import { ConnectorError, fetchText } from "@/server/trends/connectors";
import { aiSelectionInput } from "./ai-models";
import { callStructured, prepareStructured, recordStructuredSuccess, modelNotice } from "./ai-structured";
import { carouselGenerateInput, type CarouselGenerateInput } from "./carousel-generator";
import { createContent, updateContent } from "./content";
import { createTask } from "./tasks";
import { stripUnsupportedNumbers } from "./trends-ai";

/*
 * Máquina de Conteúdo: assistente guiado que liga os módulos existentes —
 * cliente e perfil da marca, Radar de Tendências, seletor universal de IA,
 * gerador de carrosséis, editor, prévia, calendário e tarefas. O projeto guarda
 * as decisões; a arte e a peça de conteúdo são as de sempre (sem cópia).
 * Regras de verdade: fonte, link e data vêm dos dados coletados; "em alta"
 * só com observações reais do Radar; números sem respaldo na fonte são
 * removidos dos textos da IA.
 */

const MODULE = "machine";
const str = (n: number) => z.string().trim().max(n);

function readAccess(s: Scope) {
  assertInternal(s.actor);
  assertCan(s.actor, "content.read");
}

function writeAccess(s: Scope) {
  assertInternal(s.actor);
  assertCan(s.actor, "content.write");
}

/* ------------------------------------------------------------------ */
/* Projetos                                                            */
/* ------------------------------------------------------------------ */

export const machineCreateInput = z.object({
  clientId: z.uuid(),
  title: str(160).optional(),
  /** Começar a partir de um tema do Radar de Tendências. */
  trendId: z.uuid().optional(),
});

export async function createMachineProject(s: Scope, raw: z.input<typeof machineCreateInput>) {
  writeAccess(s);
  const data = machineCreateInput.parse(raw);
  await assertClientAccess(s, data.clientId);
  const state = emptyMachineState();
  if (data.trendId) state.source = await trendSource(s, data.trendId);
  const [row] = await s.db
    .insert(contentMachineProjects)
    .values({
      organizationId: s.actor.orgId,
      clientId: data.clientId,
      trendId: data.trendId ?? null,
      title: data.title || state.source?.title || "Novo conteúdo",
      // O cliente já vem escolhido: o assistente começa no assunto.
      step: 2,
      state,
      createdByUserId: s.actor.userId,
      updatedByUserId: s.actor.userId,
    })
    .returning({ id: contentMachineProjects.id });
  return { id: row!.id };
}

/** Projetos visíveis: só de clientes no escopo de quem pede. */
function projectScope(s: Scope) {
  return inArray(
    contentMachineProjects.clientId,
    s.db.select({ id: clients.id }).from(clients).where(clientScope(s.actor)),
  );
}

export async function listMachineProjects(s: Scope, opts: { clientId?: string; q?: string; archived?: boolean } = {}) {
  readAccess(s);
  const rows = await s.db
    .select({
      id: contentMachineProjects.id,
      title: contentMachineProjects.title,
      status: contentMachineProjects.status,
      step: contentMachineProjects.step,
      clientId: contentMachineProjects.clientId,
      clientName: clients.name,
      designId: contentMachineProjects.designId,
      contentItemId: contentMachineProjects.contentItemId,
      thumbnail: designs.thumbnail,
      updatedAt: contentMachineProjects.updatedAt,
      state: contentMachineProjects.state,
    })
    .from(contentMachineProjects)
    .innerJoin(clients, eq(clients.id, contentMachineProjects.clientId))
    .leftJoin(designs, and(eq(designs.id, contentMachineProjects.designId), isNull(designs.deletedAt)))
    .where(
      and(
        projectScope(s),
        opts.archived ? isNotNull(contentMachineProjects.archivedAt) : isNull(contentMachineProjects.archivedAt),
        opts.clientId ? eq(contentMachineProjects.clientId, opts.clientId) : undefined,
        opts.q ? ilike(contentMachineProjects.title, `%${opts.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`) : undefined,
      ),
    )
    .orderBy(desc(contentMachineProjects.updatedAt))
    .limit(100);
  return rows.map(({ state, ...r }) => {
    const st = machineStateSchema.safeParse(state);
    const angle = st.success ? chosenAngle(st.data) : null;
    return { ...r, angle: angle?.hook ?? null, sourceKind: st.success ? (st.data.source?.kind ?? null) : null };
  });
}
export type MachineProjectRow = Awaited<ReturnType<typeof listMachineProjects>>[number];

async function loadProject(s: Scope, id: string) {
  const [row] = await s.db
    .select()
    .from(contentMachineProjects)
    .where(and(eq(contentMachineProjects.id, id), projectScope(s)));
  if (!row) throw new NotFoundError("Projeto da Máquina não encontrado.");
  const state = machineStateSchema.parse(row.state ?? {});
  return { row, state };
}

/** O que falta no perfil da marca para a geração não ser provisória. */
async function brandInfo(s: Scope, clientId: string) {
  const [row] = await s.db
    .select({ client: clients, brand: brandProfiles })
    .from(clients)
    .leftJoin(brandProfiles, eq(brandProfiles.clientId, clients.id))
    .where(eq(clients.id, clientId));
  if (!row) throw new NotFoundError("Cliente não encontrado.");
  const b = row.brand;
  const missing = [
    !b?.positioning ? "posicionamento" : null,
    !b?.audience ? "público-alvo" : null,
    !b?.toneOfVoice ? "tom de voz" : null,
    !(b?.colors ?? []).length ? "cores" : null,
  ].filter((x): x is string => !!x);
  const context = [
    `Marca: ${row.client.name}`,
    row.client.industry ? `Segmento: ${row.client.industry}` : null,
    b?.audience ? `Público-alvo: ${b.audience}` : null,
    b?.toneOfVoice ? `Tom de voz: ${b.toneOfVoice}` : null,
    b?.positioning ? `Posicionamento: ${b.positioning}` : null,
    b?.objectives ? `Objetivos: ${b.objectives}` : null,
    b?.keywords?.length ? `Palavras-chave: ${b.keywords.join(", ")}` : null,
    b?.avoid ? `Evitar: ${b.avoid}` : null,
  ]
    .filter(Boolean)
    .join("\n");
  return {
    client: { id: row.client.id, name: row.client.name, industry: row.client.industry },
    missing,
    provisional: missing.filter((m) => m !== "cores").length >= 2,
    context,
    tone: b?.toneOfVoice ?? "",
    audience: b?.audience ?? "",
  };
}

export async function getMachineProject(s: Scope, id: string) {
  readAccess(s);
  const { row, state } = await loadProject(s, id);
  const brand = await brandInfo(s, row.clientId);
  const [design] = row.designId
    ? await s.db
        .select({
          id: designs.id,
          name: designs.name,
          thumbnail: designs.thumbnail,
          document: designs.document,
          width: designs.width,
          height: designs.height,
          revision: designs.revision,
          updatedAt: designs.updatedAt,
        })
        .from(designs)
        .where(and(eq(designs.id, row.designId), isNull(designs.deletedAt)))
    : [];
  const [content] = row.contentItemId
    ? await s.db
        .select({
          id: contentItems.id,
          title: contentItems.title,
          status: contentItems.status,
          plannedDate: contentItems.plannedDate,
          taskId: contentItems.taskId,
          projectId: contentItems.projectId,
        })
        .from(contentItems)
        .where(eq(contentItems.id, row.contentItemId))
    : [];
  let designInfo = null;
  if (design) {
    const { doc } = readDesignDocument(design.document, design);
    designInfo = {
      id: design.id,
      name: design.name,
      thumbnail: design.thumbnail,
      pages: doc.pages.length,
      direction: doc.meta?.generator?.direction?.name ?? null,
      revision: design.revision,
      updatedAt: design.updatedAt.toISOString(),
      // Documento para desenhar as páginas na tela (mesmo motor do editor, só leitura).
      document: doc,
      generated: !!doc.meta?.generator,
    };
  }
  const clientProjects = await s.db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(and(eq(projects.clientId, row.clientId), isNull(projects.deletedAt)))
    .orderBy(projects.name)
    .limit(100);
  return {
    project: {
      id: row.id,
      title: row.title,
      status: row.status,
      step: row.step,
      revision: row.revision,
      clientId: row.clientId,
      trendId: row.trendId,
      lastError: row.lastError,
      archived: !!row.archivedAt,
      updatedAt: row.updatedAt,
    },
    state,
    brand: { client: brand.client, missing: brand.missing, provisional: brand.provisional },
    design: designInfo,
    content: content ?? null,
    clientProjects,
    reachable: reachableStep(state, !!designInfo),
  };
}
export type MachineProjectView = Awaited<ReturnType<typeof getMachineProject>>;

export const machineSaveInput = z.object({
  id: z.uuid(),
  revision: z.number().int().min(1),
  title: str(160).min(1).optional(),
  step: z.number().int().min(1).max(9).optional(),
  clientId: z.uuid().optional(),
  state: machineStateSchema,
});

/**
 * Salvamento automático: grava o estado inteiro com controle de revisão. Trocar
 * de cliente antes de gerar descarta o que era específico da marca anterior
 * (oportunidade e ângulos) — informações de marcas diferentes não se misturam.
 */
export async function saveMachineProject(s: Scope, raw: z.input<typeof machineSaveInput>) {
  writeAccess(s);
  const data = machineSaveInput.parse(raw);
  const { row } = await loadProject(s, data.id);
  let state = data.state;
  let clientId = row.clientId;
  if (data.clientId && data.clientId !== row.clientId) {
    if (row.designId) throw new ValidationError("O conteúdo já foi gerado para este cliente. Crie um novo projeto.");
    await assertClientAccess(s, data.clientId);
    clientId = data.clientId;
    state = { ...state, opportunity: null, angles: [], angleId: null, generation: null };
  }
  // Ângulo escolhido precisa existir na lista.
  if (state.angleId && !state.angles.some((a) => a.id === state.angleId)) state = { ...state, angleId: null };
  const step = Math.min(data.step ?? row.step, reachableStep(state, !!row.designId));
  const updated = await s.db
    .update(contentMachineProjects)
    .set({
      title: data.title ?? row.title,
      step,
      clientId,
      state,
      revision: sql`${contentMachineProjects.revision} + 1`,
      updatedByUserId: s.actor.userId,
    })
    .where(and(eq(contentMachineProjects.id, data.id), eq(contentMachineProjects.revision, data.revision)))
    .returning({ revision: contentMachineProjects.revision });
  if (!updated.length) {
    throw new ConflictError("Este projeto foi alterado em outra aba ou por outra pessoa. Recarregue para continuar.");
  }
  return { revision: updated[0]!.revision, step, state, clientId };
}

export async function setMachineArchived(s: Scope, id: string, archived: boolean) {
  writeAccess(s);
  await loadProject(s, id);
  await s.db
    .update(contentMachineProjects)
    .set({ archivedAt: archived ? new Date() : null, updatedByUserId: s.actor.userId })
    .where(eq(contentMachineProjects.id, id));
}

/** Grava parte do estado pelo servidor (fontes, IA, geração), sem pedir revisão ao cliente. */
async function patchState(s: Scope, id: string, patch: (st: MachineState) => MachineState, extra = {}) {
  const { row, state } = await loadProject(s, id);
  const next = machineStateSchema.parse(patch(state));
  const [r] = await s.db
    .update(contentMachineProjects)
    .set({
      state: next,
      revision: sql`${contentMachineProjects.revision} + 1`,
      updatedByUserId: s.actor.userId,
      ...extra,
    })
    .where(eq(contentMachineProjects.id, row.id))
    .returning({ revision: contentMachineProjects.revision, step: contentMachineProjects.step });
  return { state: next, revision: r!.revision, step: r!.step };
}

/* ------------------------------------------------------------------ */
/* Fontes do assunto                                                   */
/* ------------------------------------------------------------------ */

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  laquo: "«",
  raquo: "»",
  ldquo: "“",
  rdquo: "”",
  lsquo: "‘",
  rsquo: "’",
};

function decode(text: string) {
  return text
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name: string) => ENTITIES[name.toLowerCase()] ?? m);
}

const clean = (t: string) =>
  decode(t.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();

function meta(html: string, ...names: string[]) {
  for (const name of names) {
    const re = new RegExp(
      `<meta[^>]+(?:property|name|itemprop)=["']${name}["'][^>]*content=["']([^"']*)["']|<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name|itemprop)=["']${name}["']`,
      "i",
    );
    const m = re.exec(html);
    const v = m?.[1] ?? m?.[2];
    if (v?.trim()) return clean(v);
  }
  return null;
}

/**
 * Texto público de uma página (título, site, data e parágrafos), sem scripts,
 * menus e rodapés. Não contorna login nem paywall: usa só o que a página entrega.
 */
export function extractArticle(html: string) {
  const title =
    meta(html, "og:title", "twitter:title") ?? clean(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "");
  const siteName = meta(html, "og:site_name", "application-name");
  const description = meta(html, "og:description", "description", "twitter:description");
  const jsonDate = /"datePublished"\s*:\s*"([^"]+)"/i.exec(html)?.[1] ?? null;
  const timeTag = /<time[^>]+datetime=["']([^"']+)["']/i.exec(html)?.[1] ?? null;
  const rawDate = meta(html, "article:published_time", "datePublished", "pubdate") ?? jsonDate ?? timeTag;
  const parsed = rawDate ? new Date(rawDate) : null;
  const publishedAt = parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : null;
  const body = html
    .replace(/<(script|style|noscript|svg|nav|header|footer|aside|form|iframe)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  const article = /<article[\s\S]*?<\/article>/i.exec(body)?.[0] ?? body;
  const paragraphs = [...article.matchAll(/<(p|h2|h3|li)[^>]*>([\s\S]*?)<\/\1>/gi)]
    .map((m) => clean(m[2]!))
    .filter((p) => p.length >= 40);
  let text = paragraphs.join("\n");
  if (!text && description) text = description;
  return {
    title: title.slice(0, 300),
    siteName: siteName?.slice(0, 160) ?? null,
    description,
    publishedAt,
    text: text.slice(0, 8000),
  };
}

export const linkSourceInput = z.object({ id: z.uuid(), url: z.string().trim().min(8).max(2000) });

/** Busca a página informada (sem rede interna, com tempo e tamanho limitados) e guarda o texto como fonte. */
export async function setLinkSource(s: Scope, raw: z.input<typeof linkSourceInput>) {
  writeAccess(s);
  const data = linkSourceInput.parse(raw);
  await loadProject(s, data.id);
  let html: string;
  try {
    html = await fetchText(data.url, { headers: { accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5" } });
  } catch (err) {
    throw new ValidationError(
      err instanceof ConnectorError ? `Não foi possível ler o link: ${err.message}` : "Não foi possível ler o link.",
    );
  }
  const a = extractArticle(html);
  if (!a.text && !a.title) throw new ValidationError("A página não tem texto público legível. Cole o texto do artigo.");
  const source: MachineSource = {
    kind: "link",
    text: a.text,
    title: a.title || data.url,
    url: data.url,
    siteName: a.siteName ?? new URL(data.url).hostname,
    trendId: null,
    fileId: null,
    publishedAt: a.publishedAt,
    collectedAt: new Date().toISOString(),
  };
  const res = await patchState(s, data.id, (st) => ({ ...st, source, opportunity: null }));
  return { source, revision: res.revision };
}

const TEXT_TYPES = ["text/plain", "text/markdown", "text/html", "text/csv", "application/json"];

export const fileSourceInput = z.object({ id: z.uuid(), fileId: z.uuid() });

/** Usa um arquivo de texto da Central de Arquivos (do mesmo cliente ou da agência) como fonte. */
export async function setFileSource(s: Scope, raw: z.input<typeof fileSourceInput>) {
  writeAccess(s);
  const data = fileSourceInput.parse(raw);
  const { row } = await loadProject(s, data.id);
  const f = await assertFileAccess(s, data.fileId);
  if (f.clientId && f.clientId !== row.clientId) throw new ValidationError("Este arquivo é de outro cliente.");
  const [v] = await s.db
    .select({
      name: files.name,
      key: fileVersions.storageKey,
      mime: fileVersions.mimeType,
      size: fileVersions.sizeBytes,
      createdAt: fileVersions.createdAt,
    })
    .from(files)
    .innerJoin(fileVersions, eq(fileVersions.id, files.currentVersionId))
    .where(eq(files.id, data.fileId));
  if (!v) throw new NotFoundError("Arquivo não encontrado.");
  if (!TEXT_TYPES.includes(v.mime.split(";")[0]!.trim())) {
    throw new ValidationError(
      "Por enquanto a Máquina lê arquivos de texto (.txt, .md, .html, .csv). Para PDF ou Word, cole o texto do documento.",
    );
  }
  if (v.size > 2 * 1024 * 1024) throw new ValidationError("Arquivo grande demais (máximo de 2 MB de texto).");
  const raw2 = (await getStorage().get(v.key)).toString("utf8");
  const text = v.mime.startsWith("text/html") ? extractArticle(raw2).text : raw2.replace(/\s+\n/g, "\n").trim();
  if (!text) throw new ValidationError("O arquivo está vazio.");
  const source: MachineSource = {
    kind: "file",
    text: text.slice(0, 8000),
    title: v.name.replace(/\.[a-z0-9]+$/i, "").slice(0, 300),
    url: null,
    siteName: null,
    trendId: null,
    fileId: data.fileId,
    publishedAt: null,
    collectedAt: v.createdAt.toISOString(),
  };
  const res = await patchState(s, data.id, (st) => ({ ...st, source, opportunity: null }));
  return { source, revision: res.revision };
}

/** Tema do Radar: título, resumo, link, fonte e a última observação real (data, posição, métricas). */
async function trendSource(s: Scope, trendId: string): Promise<MachineSource> {
  assertCan(s.actor, "trends.read");
  const [t] = await s.db
    .select({
      id: trends.id,
      title: trends.title,
      summary: trends.summary,
      url: trends.url,
      lastSeenAt: trends.lastSeenAt,
      publishedAt: trends.publishedAt,
      eventDate: trends.eventDate,
      sourceName: trendSources.name,
    })
    .from(trends)
    .innerJoin(trendSources, eq(trendSources.id, trends.sourceId))
    .where(eq(trends.id, trendId));
  if (!t) throw new NotFoundError("Tema do Radar não encontrado.");
  const obs = await latestObservation(s, trendId);
  const facts = [
    t.summary ? `Resumo da fonte: ${t.summary}` : null,
    t.eventDate ? `Data do evento: ${t.eventDate}` : null,
    obs ? `Observado em ${obs.observedOn} em ${t.sourceName}${obs.rank ? ` (posição ${obs.rank})` : ""}.` : null,
    ...(obs?.metrics ?? []).slice(0, 4).map((m) => `${m.label}: ${m.value}`),
  ].filter(Boolean);
  return {
    kind: "trend",
    text: facts.join("\n").slice(0, 8000),
    title: t.title.slice(0, 300),
    url: t.url ?? null,
    siteName: t.sourceName,
    trendId: t.id,
    fileId: null,
    publishedAt: t.publishedAt?.toISOString() ?? null,
    collectedAt: (obs ? new Date(`${obs.observedOn}T12:00:00Z`) : t.lastSeenAt).toISOString(),
  };
}

async function latestObservation(s: Scope, trendId: string) {
  const [o] = await s.db
    .select({
      observedOn: trendObservations.observedOn,
      rank: trendObservations.rank,
      metrics: trendObservations.metrics,
    })
    .from(trendObservations)
    .where(eq(trendObservations.trendId, trendId))
    .orderBy(desc(trendObservations.observedOn))
    .limit(1);
  return o
    ? {
        observedOn: o.observedOn,
        rank: o.rank,
        metrics: (o.metrics ?? []) as { label: string; value: string | number }[],
      }
    : null;
}

export const trendSourceInput = z.object({ id: z.uuid(), trendId: z.uuid() });

export async function setTrendSource(s: Scope, raw: z.input<typeof trendSourceInput>) {
  writeAccess(s);
  const data = trendSourceInput.parse(raw);
  await loadProject(s, data.id);
  const source = await trendSource(s, data.trendId);
  const res = await patchState(s, data.id, (st) => ({ ...st, source, opportunity: null }), {
    trendId: data.trendId,
  });
  return { source, revision: res.revision };
}

/** Temas recentes do Radar para escolher na etapa "Assunto" (com a evidência de cada um). */
export async function machineTrendOptions(s: Scope, q?: string) {
  readAccess(s);
  if (!can(s.actor, "trends.read")) return [];
  const rows = await s.db
    .select({
      id: trends.id,
      title: trends.title,
      summary: trends.summary,
      url: trends.url,
      lastSeenAt: trends.lastSeenAt,
      sourceName: trendSources.name,
      platform: trends.platform,
      observations: sql<number>`(select count(*)::int from ${trendObservations} o where o.trend_id = ${trends.id})`,
    })
    .from(trends)
    .innerJoin(trendSources, eq(trendSources.id, trends.sourceId))
    .where(q ? ilike(trends.title, `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`) : undefined)
    .orderBy(desc(trends.lastSeenAt))
    .limit(30);
  return rows;
}

/* ------------------------------------------------------------------ */
/* IA: oportunidade e ângulos                                          */
/* ------------------------------------------------------------------ */

const numbersOf = (text: string) => new Set((text.match(/\d[\d.,]*/g) ?? []).map((m) => m.replace(/[^\d]/g, "")));

function strip(text: string, allowed: Set<string>) {
  return stripUnsupportedNumbers(text, allowed).text;
}

const SOURCE_EXCERPT = 3500;

function sourceBlock(src: MachineSource) {
  return [
    `Origem: ${src.kind === "trend" ? "Radar de Tendências" : src.kind === "link" ? "link informado" : src.kind === "file" ? "arquivo informado" : src.kind === "text" ? "texto informado" : "ideia da equipe"}`,
    src.siteName ? `Fonte: ${src.siteName}` : null,
    src.text ? `Texto da fonte:\n${src.text.slice(0, SOURCE_EXCERPT)}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

const opportunityResponse = z.object({
  title: z.string().max(400).catch(""),
  summary: z.string().max(3000).catch(""),
  relevance: z.string().max(1500).catch(""),
  nicheRelation: z.string().max(1500).catch(""),
  angleHints: z.array(z.string().max(300)).max(10).catch([]),
  risks: z.array(z.string().max(400)).max(10).catch([]),
});
const OPPORTUNITY_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    summary: { type: "string" },
    relevance: { type: "string" },
    nicheRelation: { type: "string" },
    angleHints: { type: "array", items: { type: "string" } },
    risks: { type: "array", items: { type: "string" } },
  },
  required: ["title", "summary", "relevance", "nicheRelation", "angleHints", "risks"],
  additionalProperties: false,
};

const SYSTEM = [
  "Você é estrategista de conteúdo de uma agência brasileira. Trabalha só com o que está na fonte e no perfil da marca enviados.",
  "NUNCA invente fatos, números, métricas de popularidade, datas, fontes, citações ou casos. Se a fonte não sustenta uma afirmação, diga que precisa de confirmação.",
  "Não afirme que um assunto está em alta: isso é decidido pelos dados do Radar, não por você.",
  "Responda em português do Brasil, somente com o JSON pedido.",
].join(" ");

export const machineAiInput = z.object({
  id: z.uuid(),
  selection: aiSelectionInput.optional(),
  confirmCost: z.boolean().optional(),
});

/**
 * Resume a fonte como oportunidade de conteúdo. Fonte, link, data e evidência
 * de popularidade são preenchidos pelo servidor a partir dos dados coletados.
 */
export async function researchOpportunity(actor: Actor, raw: z.input<typeof machineAiInput>) {
  const data = machineAiInput.parse(raw);
  const pre = await inOrg(actor, async (s) => {
    writeAccess(s);
    assertCan(s.actor, "ai.use");
    const { row, state } = await loadProject(s, data.id);
    if (!state.source) throw new ValidationError("Escolha ou informe o assunto primeiro.");
    const brand = await brandInfo(s, row.clientId);
    const prep = await prepareStructured(s, { module: MODULE, task: "trend_analysis", selection: data.selection });
    const obs = state.source.trendId ? await latestObservation(s, state.source.trendId) : null;
    return { row, state, brand, prep, obs };
  });
  const { state, brand, prep, obs, row } = pre;
  const src = state.source!;
  const prompt = [
    "Formato da resposta: machine_opportunity",
    `Assunto: ${src.title || src.text.slice(0, 120)}`,
    brand.client.industry ? `Segmento: ${brand.client.industry}` : null,
    "",
    sourceBlock(src),
    "",
    prep.allowClientContext && brand.context
      ? `Perfil da marca:\n${brand.context}`
      : "Perfil da marca: não enviado (a organização não autorizou dados de clientes). Relacione com o segmento de forma geral.",
    "",
    "Devolva: título do assunto; resumo do que aconteceu ou está sendo discutido (só o que a fonte diz); por que pode ser relevante; relação com o nicho da marca; possíveis caminhos editoriais (curtos); riscos de abordagem e informações que precisam de confirmação.",
  ]
    .filter((l) => l !== null)
    .join("\n");
  const call = await callStructured(actor, prep, {
    operation: "machine_opportunity",
    system: SYSTEM,
    prompt,
    schema: OPPORTUNITY_SCHEMA,
    parse: opportunityResponse,
    clientId: row.clientId,
    maxTokens: 2000,
    confirmCost: data.confirmCost,
  });
  const allowed = numbersOf(`${src.text} ${src.title}`);
  const evidence = src.kind === "trend" && obs ? "trending" : "hypothesis";
  const opportunity: Opportunity = {
    title: strip(call.data.title || src.title || "Assunto", allowed).slice(0, 300),
    summary: strip(call.data.summary, allowed).slice(0, 1500),
    sourceName: src.siteName ?? (src.kind === "idea" || src.kind === "text" ? "Informado pela equipe" : null),
    sourceUrl: src.url,
    date: src.publishedAt ?? src.collectedAt,
    dateKind: src.publishedAt ? "published" : src.collectedAt ? "collected" : "none",
    evidence,
    evidenceNote:
      evidence === "trending"
        ? `Em alta em ${src.siteName ?? "fonte do Radar"}: observado em ${obs!.observedOn}${obs!.rank ? `, posição ${obs!.rank}` : ""}.`
        : src.kind === "trend"
          ? "Tema do Radar sem observações de popularidade: tratado como hipótese editorial."
          : "Sem dados de popularidade: é uma hipótese editorial, não um assunto comprovadamente em alta.",
    relevance: strip(call.data.relevance, allowed).slice(0, 800),
    nicheRelation: strip(call.data.nicheRelation, allowed).slice(0, 800),
    angleHints: call.data.angleHints.map((h) => strip(h, allowed).slice(0, 200)).slice(0, 8),
    risks: call.data.risks.map((r) => strip(r, allowed).slice(0, 300)).slice(0, 8),
    provisional: brand.provisional || !prep.allowClientContext,
    model: call.model,
    demo: prep.demo,
    at: new Date().toISOString(),
  };
  return inOrg(actor, async (s) => {
    await recordStructuredSuccess(s, call, {
      title: `Máquina: oportunidade — ${opportunity.title}`.slice(0, 120),
      input: { projectId: data.id, source: src.kind },
      clientId: row.clientId,
    });
    const res = await patchState(s, data.id, (st) => ({ ...st, opportunity }));
    return { opportunity, revision: res.revision, notice: modelNotice(prep, call.model), warnings: prep.warnings };
  });
}

const anglesResponse = z.object({
  angles: z
    .array(
      z.object({
        type: z.string().max(40).catch("practical"),
        hook: z.string().max(400),
        idea: z.string().max(1200),
        audience: z.string().max(600).catch(""),
        objective: z.string().max(600).catch(""),
        differential: z.string().max(800).catch(""),
        format: z.string().max(60).catch("carousel"),
        cta: z.string().max(400).catch(""),
        sourcesNeeded: z.array(z.string().max(400)).max(8).catch([]),
      }),
    )
    .min(1)
    .max(8),
});
const S = { type: "string" };
const ANGLES_SCHEMA = {
  type: "object",
  properties: {
    angles: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string", enum: Object.keys(ANGLE_TYPES) },
          hook: S,
          idea: S,
          audience: S,
          objective: S,
          differential: S,
          format: S,
          cta: S,
          sourcesNeeded: { type: "array", items: S },
        },
        required: ["type", "hook", "idea", "audience", "objective", "differential", "format", "cta", "sourcesNeeded"],
        additionalProperties: false,
      },
    },
  },
  required: ["angles"],
  additionalProperties: false,
};

export const anglesInput = machineAiInput.extend({ more: z.boolean().default(false) });

/** Abordagens originais para o assunto (ou mais alternativas, sem repetir os tipos já sugeridos). */
export async function generateAngles(actor: Actor, raw: z.input<typeof anglesInput>) {
  const data = anglesInput.parse(raw);
  const pre = await inOrg(actor, async (s) => {
    writeAccess(s);
    assertCan(s.actor, "ai.use");
    const { row, state } = await loadProject(s, data.id);
    if (!state.source) throw new ValidationError("Escolha ou informe o assunto primeiro.");
    const brand = await brandInfo(s, row.clientId);
    const prep = await prepareStructured(s, { module: MODULE, task: "planning", selection: data.selection });
    return { row, state, brand, prep };
  });
  const { row, state, brand, prep } = pre;
  const src = state.source!;
  const used = data.more ? [...new Set(state.angles.map((a) => a.type))] : [];
  const prompt = [
    "Formato da resposta: machine_angles",
    `Assunto: ${state.opportunity?.title || src.title || src.text.slice(0, 120)}`,
    brand.client.industry ? `Segmento: ${brand.client.industry}` : null,
    `Objetivo de marketing: ${MACHINE_OBJECTIVES[state.objective]}`,
    used.length ? `Tipos já sugeridos: ${used.join(", ")}` : null,
    used.length
      ? `Ganchos já sugeridos (não repita): ${state.angles
          .map((a) => a.hook)
          .join(" | ")
          .slice(0, 1200)}`
      : null,
    "",
    state.opportunity?.summary ? `Resumo do assunto: ${state.opportunity.summary}` : null,
    sourceBlock({ ...src, text: src.text.slice(0, 2500) }),
    "",
    prep.allowClientContext && brand.context ? `Perfil da marca:\n${brand.context}` : "Perfil da marca: não enviado.",
    "",
    `Tipos de ângulo possíveis: ${Object.entries(ANGLE_TYPES)
      .map(([k, v]) => `${k} (${v})`)
      .join("; ")}.`,
    `Crie ${data.more ? 4 : 5} abordagens ORIGINAIS e diferentes entre si (não reproduza o texto da fonte). Para cada uma: tipo, gancho, ideia central, público, objetivo estratégico, diferencial em relação às abordagens comuns, formato recomendado (carousel), CTA e as fontes necessárias para validar qualquer afirmação factual. "Antes e depois" só com evidência na fonte.`,
  ]
    .filter((l) => l !== null)
    .join("\n");
  const call = await callStructured(actor, prep, {
    operation: "machine_angles",
    system: SYSTEM,
    prompt,
    schema: ANGLES_SCHEMA,
    parse: anglesResponse,
    clientId: row.clientId,
    maxTokens: 3000,
    confirmCost: data.confirmCost,
  });
  const allowed = numbersOf(`${src.text} ${src.title}`);
  const fresh: Angle[] = call.data.angles.map((a) =>
    angleSchema.parse({
      id: randomUUID().slice(0, 8),
      type: a.type,
      hook: strip(a.hook, allowed).slice(0, 240),
      idea: strip(a.idea, allowed).slice(0, 600),
      audience: a.audience.slice(0, 300),
      objective: a.objective.slice(0, 300),
      differential: strip(a.differential, allowed).slice(0, 400),
      format: "carousel",
      cta: a.cta.slice(0, 200),
      sourcesNeeded: a.sourcesNeeded.map((x) => x.slice(0, 240)).slice(0, 6),
    }),
  );
  return inOrg(actor, async (s) => {
    await recordStructuredSuccess(s, call, {
      title: `Máquina: ângulos — ${src.title || "assunto"}`.slice(0, 120),
      input: { projectId: data.id, more: data.more },
      clientId: row.clientId,
    });
    const res = await patchState(s, data.id, (st) => {
      const angles = (data.more ? [...st.angles, ...fresh] : fresh).slice(-30);
      return { ...st, angles, angleId: angles.some((a) => a.id === st.angleId) ? st.angleId : null };
    });
    return {
      angles: res.state.angles,
      angleId: res.state.angleId,
      revision: res.revision,
      notice: modelNotice(prep, call.model),
      warnings: prep.warnings,
      demo: prep.demo,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Geração (gerador de carrosséis) e ligação com a peça de conteúdo     */
/* ------------------------------------------------------------------ */

/**
 * Pedido ao gerador de carrosséis a partir das decisões do projeto. Só o texto
 * da fonte (e os dados do Radar) entra como referência — o resumo escrito pela
 * IA não, para nenhum número sem respaldo virar "dado".
 */
export function carouselRequest(
  p: { title: string; clientId: string; projectId?: string | null },
  st: MachineState,
): CarouselGenerateInput {
  const angle = chosenAngle(st);
  if (!st.source) throw new ValidationError("Escolha ou informe o assunto primeiro.");
  if (!angle) throw new ValidationError("Escolha um ângulo antes de gerar.");
  const src = st.source;
  const direction = [
    `Direção editorial escolhida (não são dados): ${ANGLE_TYPES[angle.type]}. Ideia central: ${angle.idea}`,
    angle.differential ? `Diferencial: ${angle.differential}` : null,
    angle.cta ? `CTA sugerida: ${angle.cta}` : null,
  ]
    .filter(Boolean)
    .join("\n");
  const sourceRef = [
    src.kind === "idea" ? null : `Fonte: ${[src.title, src.siteName, src.url].filter(Boolean).join(" — ")}`,
    src.publishedAt ? `Publicado em ${src.publishedAt.slice(0, 10)}` : null,
    src.text ? (src.kind === "idea" ? `Ideia da equipe: ${src.text}` : src.text) : null,
  ]
    .filter(Boolean)
    .join("\n");
  const references = `${direction}\n\n${sourceRef}`.slice(0, 2000);
  return carouselGenerateInput.parse({
    mode: "full",
    topic: angle.hook.slice(0, 300),
    clientId: p.clientId,
    projectId: p.projectId ?? null,
    name: p.title.slice(0, 120),
    objective: `${MACHINE_OBJECTIVES[st.objective]}. ${angle.objective}`.slice(0, 500),
    audience: (st.audience || angle.audience).slice(0, 500) || undefined,
    tone: st.tone || undefined,
    references,
    slides: st.slides,
    format: st.aspect,
    useIdentity: true,
    images: st.images,
    maxImages: st.maxImages,
    selection: (st.ai.copy ?? undefined) as never,
    imageSelection: (st.ai.image ?? undefined) as never,
    nonce: randomUUID().slice(0, 8),
  });
}

export async function startMachineGeneration(s: Scope, id: string) {
  writeAccess(s);
  assertCan(s.actor, "designs.write");
  const { row, state } = await loadProject(s, id);
  const request = carouselRequest(row, state);
  await s.db
    .update(contentMachineProjects)
    .set({ status: "generating", step: 5, lastError: null, updatedByUserId: s.actor.userId })
    .where(eq(contentMachineProjects.id, id));
  return { request, project: row, state };
}

export async function failMachineGeneration(s: Scope, id: string, message: string) {
  await s.db
    .update(contentMachineProjects)
    .set({ status: "draft", lastError: message.slice(0, 500), updatedByUserId: s.actor.userId })
    .where(eq(contentMachineProjects.id, id));
}

/**
 * Depois de gerar: cria (ou atualiza) a peça de conteúdo com os textos do
 * roteiro e liga a arte nova. Regerar mantém a arte anterior no Estúdio
 * (versão preservada) e troca o vínculo da peça — sem registros duplicados.
 */
export async function finishMachineGeneration(s: Scope, id: string, designId: string) {
  writeAccess(s);
  const { row, state } = await loadProject(s, id);
  const angle = chosenAngle(state);
  const [d] = await s.db
    .select({ document: designs.document, width: designs.width, height: designs.height, name: designs.name })
    .from(designs)
    .where(eq(designs.id, designId));
  if (!d) throw new NotFoundError("Arte gerada não encontrada.");
  const { doc } = readDesignDocument(d.document, d);
  const gen = doc.meta?.generator;
  const texts = {
    title: (gen?.plan.title || row.title).slice(0, 200),
    concept: angle?.idea ?? null,
    strategy: angle
      ? [
          `Ângulo: ${ANGLE_TYPES[angle.type]}`,
          `Objetivo: ${MACHINE_OBJECTIVES[state.objective]}`,
          angle.differential ? `Diferencial: ${angle.differential}` : null,
          state.opportunity ? `Evidência: ${state.opportunity.evidenceNote}` : null,
          state.source?.url ? `Fonte: ${state.source.url}` : null,
        ]
          .filter(Boolean)
          .join("\n")
      : null,
    caption: gen?.plan.caption || null,
    cta: (gen?.plan.cta || angle?.cta || "").slice(0, 300) || null,
    visualDirection: gen?.direction ? `Direção visual: ${gen.direction.name}` : null,
    hashtags: (gen?.plan.hashtags ?? []).slice(0, 30),
    slides: (gen?.slides ?? []).slice(0, 10).map((sl) => ({
      title: (sl.title ?? "").slice(0, 200),
      text: (sl.body ?? "").slice(0, 1200),
    })),
  };
  let contentItemId = row.contentItemId;
  if (contentItemId) {
    await updateContent(s, { id: contentItemId, ...texts });
    await s.db.delete(contentItemAssets).where(eq(contentItemAssets.contentItemId, contentItemId));
  } else {
    ({ id: contentItemId } = await createContent(s, {
      clientId: row.clientId,
      projectId: row.projectId,
      campaignId: row.campaignId,
      format: "carousel",
      status: "draft",
      ...texts,
    }));
    if (row.trendId)
      await s.db.update(contentItems).set({ trendId: row.trendId }).where(eq(contentItems.id, contentItemId));
  }
  await s.db.insert(contentItemAssets).values({
    organizationId: s.actor.orgId,
    contentItemId,
    designId,
    role: "carousel",
    position: 0,
  });
  const generation = {
    at: new Date().toISOString(),
    model: gen?.ai.model ?? "",
    demo: gen?.ai.demo ?? false,
    slides: gen?.slides.length ?? doc.pages.length,
    warnings: gen?.warnings ?? [],
    claims: (gen?.claims ?? []).map((c) => ({ text: c.text, reason: c.reason })),
  };
  const res = await patchState(s, id, (st) => ({ ...st, generation }), {
    designId,
    contentItemId,
    status: "ready" as const,
    step: 6,
    lastError: null,
  });
  return { designId, contentItemId, revision: res.revision };
}

/* ------------------------------------------------------------------ */
/* Entrega: calendário e tarefa                                        */
/* ------------------------------------------------------------------ */

export const machinePlanInput = z.object({
  id: z.uuid(),
  plannedDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
});

/** Data planejada no calendário editorial (a peça de conteúdo é a mesma). */
export async function planMachineContent(s: Scope, raw: z.input<typeof machinePlanInput>) {
  writeAccess(s);
  const data = machinePlanInput.parse(raw);
  const { row } = await loadProject(s, data.id);
  if (!row.contentItemId) throw new ValidationError("Gere o conteúdo antes de planejar a publicação.");
  await updateContent(s, { id: row.contentItemId, plannedDate: data.plannedDate });
  return { plannedDate: data.plannedDate };
}

export const machineTaskInput = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
});

/** Tarefa de produção ligada à peça (uma por peça; a peça guarda o vínculo). */
export async function createMachineTask(s: Scope, raw: z.input<typeof machineTaskInput>) {
  writeAccess(s);
  assertCan(s.actor, "tasks.write");
  const data = machineTaskInput.parse(raw);
  const { row, state } = await loadProject(s, data.id);
  if (!row.contentItemId) throw new ValidationError("Gere o conteúdo antes de criar a tarefa.");
  const [c] = await s.db
    .select({ taskId: contentItems.taskId, title: contentItems.title })
    .from(contentItems)
    .where(eq(contentItems.id, row.contentItemId));
  if (c?.taskId) throw new ValidationError("Esta peça já tem uma tarefa.");
  const [p] = await s.db.select({ clientId: projects.clientId }).from(projects).where(eq(projects.id, data.projectId));
  if (!p || p.clientId !== row.clientId) throw new ValidationError("Escolha um projeto do mesmo cliente.");
  const angle = chosenAngle(state);
  const task = await createTask(s, {
    projectId: data.projectId,
    title: `Revisar e publicar: ${c?.title ?? row.title}`.slice(0, 300),
    description: [
      "Peça criada na Máquina de Conteúdo.",
      angle ? `Ângulo: ${ANGLE_TYPES[angle.type]} — ${angle.hook}` : null,
      state.generation?.claims.length
        ? `Dados a confirmar antes de publicar: ${state.generation.claims.length}.`
        : null,
    ]
      .filter(Boolean)
      .join("\n"),
    dueDate: data.dueDate ?? undefined,
  });
  await s.db
    .update(contentItems)
    .set({ taskId: task.id, projectId: data.projectId, updatedByUserId: s.actor.userId })
    .where(eq(contentItems.id, row.contentItemId));
  await s.db
    .update(contentMachineProjects)
    .set({ projectId: data.projectId, updatedByUserId: s.actor.userId })
    .where(eq(contentMachineProjects.id, row.id));
  return { taskId: task.id };
}
