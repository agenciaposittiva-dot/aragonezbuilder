import { and, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import {
  BIO_STYLES,
  BRAND_DIMENSIONS,
  CONTENT_CATEGORIES,
  countChars,
  DEFAULT_BIO_LIMIT,
  DIMENSION_KEYS,
  EMPTY_MANUAL,
  normalizeHandle,
  normalizeWeights,
  POST_FORMATS,
  profileUrlOf,
  RECOMMENDATION_CATEGORIES,
  RECOMMENDATION_STATUS,
  SCREENSHOT_KINDS,
  type ApiPost,
  type DiagnosisInputs,
  type DiagnosisResult,
  type HighlightPlan,
  type ManualInputs,
  type SourceKind,
} from "@/lib/brand-radar";
import { CONTENT_FORMAT_KEYS, CONTENT_FORMATS, type ContentFormat } from "@/lib/content";
import { createDocument, textObject, type DesignObject } from "@/lib/design-doc";
import {
  assertCan,
  assertClientAccess,
  assertInternal,
  assertProjectAccess,
  clientScope,
  type Scope,
} from "@/server/authz";
import {
  brandProfiles,
  brandRadarBioVersions,
  brandRadarConnections,
  brandRadarDiagnoses,
  brandRadarProfiles,
  brandRadarRecommendations,
  clients,
  designs,
  files,
  fileVersions,
  memberships,
  projects,
  tasks,
  user,
} from "@/server/db/schema";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { recordActivity } from "./activity";
import { requestApproval } from "./approvals";
import { createCampaign, createContent } from "./content";
import { createDesign } from "./designs";
import { storeUpload } from "./files";
import { getSettings, updateSettings } from "./organizations";
import { createProject } from "./projects";
import { createTask } from "./tasks";

/*
 * Radar de Marca — dados (perfis, informações fornecidas, diagnósticos,
 * recomendações e versões de bio) e integrações com os módulos existentes
 * (tarefas, artes, conteúdos, campanhas e aprovações). A IA fica em
 * brand-radar-ai.ts; a conexão oficial com o Instagram em instagram.ts.
 * Toda leitura respeita o escopo de clientes do ator (clientScope).
 */

export function assertBrandRead(s: Scope) {
  assertInternal(s.actor);
  assertCan(s.actor, "brand.read");
}

export function assertBrandManage(s: Scope) {
  assertInternal(s.actor);
  assertCan(s.actor, "brand.manage");
}

const uuid = z.uuid();

export async function loadProfile(s: Scope, profileId: string) {
  if (!uuid.safeParse(profileId).success) throw new NotFoundError("Perfil não encontrado.");
  const [row] = await s.db
    .select({ profile: brandRadarProfiles, clientName: clients.name, industry: clients.industry })
    .from(brandRadarProfiles)
    .innerJoin(clients, eq(clients.id, brandRadarProfiles.clientId))
    .where(and(eq(brandRadarProfiles.id, profileId), clientScope(s.actor)));
  if (!row) throw new NotFoundError("Perfil não encontrado.");
  return row;
}

/* ------------------------------------------------------------------ */
/* Configuração da metodologia                                          */
/* ------------------------------------------------------------------ */

export async function radarSettings(s: Scope) {
  const settings = await getSettings(s);
  return {
    bioLimit: settings.brandRadar?.bioLimit ?? DEFAULT_BIO_LIMIT,
    weights: normalizeWeights(settings.brandRadar?.weights),
  };
}

export const radarSettingsInput = z.object({
  bioLimit: z.coerce.number().int().min(30, "Mínimo de 30 caracteres").max(1000),
  weights: z.record(z.string(), z.coerce.number().int().min(0).max(100)),
});

/** Pesos e limite da bio (Configurações da organização). Diagnósticos antigos guardam os pesos que usaram. */
export async function updateRadarSettings(s: Scope, raw: z.input<typeof radarSettingsInput>) {
  assertBrandManage(s);
  const data = radarSettingsInput.parse(raw);
  const weights = Object.fromEntries(
    Object.entries(data.weights).filter(([k]) => (DIMENSION_KEYS as string[]).includes(k)),
  );
  if (!Object.values(normalizeWeights(weights)).some((w) => w > 0)) {
    throw new ValidationError("Ao menos uma dimensão precisa ter peso maior que zero.");
  }
  await updateSettings(s, "brandRadar", { bioLimit: data.bioLimit, weights });
  return radarSettings(s);
}

/* ------------------------------------------------------------------ */
/* Perfis                                                              */
/* ------------------------------------------------------------------ */

export const profileInput = z.object({
  clientId: z.uuid(),
  handle: z.string().trim().min(1, "Informe o @ ou o endereço do perfil").max(200),
  kind: z.enum(["own", "competitor"]).default("own"),
  niche: z.string().trim().max(200).optional().nullable(),
  market: z.string().trim().max(200).optional().nullable(),
  region: z.string().trim().max(200).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
});

export async function createRadarProfile(s: Scope, raw: z.input<typeof profileInput>) {
  assertBrandManage(s);
  const data = profileInput.parse(raw);
  await assertClientAccess(s, data.clientId);
  const handle = normalizeHandle(data.handle);
  if (!handle) {
    throw new ValidationError("Use o @ do perfil (letras, números, ponto e sublinhado) ou o endereço do Instagram.", {
      handle: ["@ inválido"],
    });
  }
  const [dup] = await s.db
    .select({ id: brandRadarProfiles.id, archivedAt: brandRadarProfiles.archivedAt })
    .from(brandRadarProfiles)
    .where(
      and(
        eq(brandRadarProfiles.clientId, data.clientId),
        eq(brandRadarProfiles.network, "instagram"),
        eq(brandRadarProfiles.handle, handle),
      ),
    );
  if (dup && !dup.archivedAt) throw new ConflictError("Este perfil já está no Radar deste cliente.");
  if (dup) {
    await s.db
      .update(brandRadarProfiles)
      .set({ archivedAt: null, kind: data.kind })
      .where(eq(brandRadarProfiles.id, dup.id));
    return { id: dup.id, handle };
  }
  const [row] = await s.db
    .insert(brandRadarProfiles)
    .values({
      organizationId: s.actor.orgId,
      clientId: data.clientId,
      kind: data.kind,
      handle,
      profileUrl: profileUrlOf(handle),
      niche: data.niche ?? null,
      market: data.market ?? null,
      region: data.region ?? null,
      notes: data.notes ?? null,
      manual: EMPTY_MANUAL,
      createdByUserId: s.actor.userId,
    })
    .returning({ id: brandRadarProfiles.id });
  await recordActivity(s, {
    action: "created",
    entityType: "brand_radar_profile",
    entityId: row!.id,
    summary: `Radar de Marca: @${handle} adicionado (${data.kind === "own" ? "perfil do cliente" : "concorrente"})`,
    event: false,
  });
  return { id: row!.id, handle };
}

export const profileUpdateInput = z.object({
  id: z.uuid(),
  niche: z.string().trim().max(200).optional().nullable(),
  market: z.string().trim().max(200).optional().nullable(),
  region: z.string().trim().max(200).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
});

export async function updateRadarProfile(s: Scope, raw: z.input<typeof profileUpdateInput>) {
  assertBrandManage(s);
  const data = profileUpdateInput.parse(raw);
  await loadProfile(s, data.id);
  await s.db
    .update(brandRadarProfiles)
    .set({
      ...(data.niche !== undefined ? { niche: data.niche || null } : {}),
      ...(data.market !== undefined ? { market: data.market || null } : {}),
      ...(data.region !== undefined ? { region: data.region || null } : {}),
      ...(data.notes !== undefined ? { notes: data.notes || null } : {}),
    })
    .where(eq(brandRadarProfiles.id, data.id));
}

/** Tira o perfil do Radar (os diagnósticos ficam guardados e voltam se o perfil for adicionado de novo). */
export async function archiveRadarProfile(s: Scope, profileId: string) {
  assertBrandManage(s);
  const { profile } = await loadProfile(s, profileId);
  await s.db.update(brandRadarProfiles).set({ archivedAt: new Date() }).where(eq(brandRadarProfiles.id, profile.id));
  await recordActivity(s, {
    action: "archived",
    entityType: "brand_radar_profile",
    entityId: profile.id,
    summary: `Radar de Marca: @${profile.handle} removido do Radar`,
    event: false,
  });
}

/** Visão geral: perfis próprios dos clientes visíveis, com a última nota e a situação da conexão. */
export async function listRadarProfiles(s: Scope, opts: { clientId?: string } = {}) {
  assertBrandRead(s);
  const last = s.db
    .select({
      profileId: brandRadarDiagnoses.profileId,
      score: brandRadarDiagnoses.overallScore,
      createdAt: brandRadarDiagnoses.createdAt,
      demo: brandRadarDiagnoses.demo,
      rn: sql<number>`row_number() over (partition by ${brandRadarDiagnoses.profileId} order by ${brandRadarDiagnoses.createdAt} desc)`.as(
        "rn",
      ),
    })
    .from(brandRadarDiagnoses)
    .where(eq(brandRadarDiagnoses.kind, "full"))
    .as("last");
  const rows = await s.db
    .select({
      id: brandRadarProfiles.id,
      handle: brandRadarProfiles.handle,
      kind: brandRadarProfiles.kind,
      clientId: brandRadarProfiles.clientId,
      clientName: clients.name,
      niche: brandRadarProfiles.niche,
      updatedAt: brandRadarProfiles.updatedAt,
      lastScore: last.score,
      lastAt: last.createdAt,
      lastDemo: last.demo,
      connection: brandRadarConnections.status,
      openRecommendations: sql<number>`(select count(*)::int from ${brandRadarRecommendations} r where r.profile_id = ${brandRadarProfiles.id} and r.status in ('open','in_progress'))`,
    })
    .from(brandRadarProfiles)
    .innerJoin(clients, eq(clients.id, brandRadarProfiles.clientId))
    .leftJoin(last, and(eq(last.profileId, brandRadarProfiles.id), eq(last.rn, 1)))
    .leftJoin(brandRadarConnections, eq(brandRadarConnections.profileId, brandRadarProfiles.id))
    .where(
      and(
        isNull(brandRadarProfiles.archivedAt),
        eq(brandRadarProfiles.kind, "own"),
        clientScope(s.actor),
        opts.clientId ? eq(brandRadarProfiles.clientId, opts.clientId) : undefined,
      ),
    )
    .orderBy(desc(brandRadarProfiles.updatedAt))
    .limit(300);
  return rows;
}

/* ------------------------------------------------------------------ */
/* Dados informados manualmente                                         */
/* ------------------------------------------------------------------ */

export const manualInput = z.object({
  profileId: z.uuid(),
  displayName: z.string().trim().max(120).default(""),
  category: z.string().trim().max(120).default(""),
  bio: z.string().max(2000).default(""),
  link: z.string().trim().max(500).default(""),
  followers: z.coerce.number().int().min(0).max(1_000_000_000).nullable().optional(),
  highlights: z.array(z.string().trim().min(1).max(60)).max(40).default([]),
  posts: z
    .array(
      z.object({
        format: z
          .enum(Object.keys(POST_FORMATS) as [keyof typeof POST_FORMATS])
          .nullable()
          .default(null),
        text: z.string().trim().min(1).max(1000),
      }),
    )
    .max(60)
    .default([]),
  goals: z.string().trim().max(2000).default(""),
  notes: z.string().trim().max(4000).default(""),
  screenshots: z
    .array(
      z.object({
        fileId: z.uuid(),
        kind: z.enum(Object.keys(SCREENSHOT_KINDS) as [keyof typeof SCREENSHOT_KINDS]).default("other"),
      }),
    )
    .max(12)
    .default([]),
});

/** Guarda os dados informados (as capturas precisam ser imagens do mesmo cliente, em Arquivos). */
export async function saveManualInputs(s: Scope, raw: z.input<typeof manualInput>) {
  assertBrandManage(s);
  const data = manualInput.parse(raw);
  const { profile } = await loadProfile(s, data.profileId);
  const shots = data.screenshots.length
    ? await s.db
        .select({
          id: files.id,
          name: files.name,
          clientId: files.clientId,
          versionId: files.currentVersionId,
          mime: fileVersions.mimeType,
        })
        .from(files)
        .innerJoin(fileVersions, eq(fileVersions.id, files.currentVersionId))
        .where(and(inArray(files.id, [...new Set(data.screenshots.map((x) => x.fileId))]), isNull(files.deletedAt)))
    : [];
  const screenshots: ManualInputs["screenshots"] = [];
  for (const sc of data.screenshots) {
    const f = shots.find((x) => x.id === sc.fileId);
    if (!f || f.clientId !== profile.clientId || !f.mime.startsWith("image/") || !f.versionId) {
      throw new ValidationError("Uma das capturas não é uma imagem deste cliente.");
    }
    if (!screenshots.some((x) => x.fileId === f.id))
      screenshots.push({ fileId: f.id, versionId: f.versionId, kind: sc.kind, name: f.name });
  }
  const manual: ManualInputs = {
    displayName: data.displayName,
    category: data.category,
    bio: data.bio.trim(),
    link: data.link,
    followers: data.followers ?? null,
    highlights: [...new Set(data.highlights)],
    posts: data.posts,
    goals: data.goals,
    notes: data.notes,
    screenshots,
    updatedAt: new Date().toISOString(),
  };
  await s.db.update(brandRadarProfiles).set({ manual }).where(eq(brandRadarProfiles.id, profile.id));
  return manual;
}

/* ------------------------------------------------------------------ */
/* Montagem dos dados de uma análise (com fonte e data)                 */
/* ------------------------------------------------------------------ */

type ApiSnapshot = {
  fetchedAt: string;
  profile?: {
    username?: string;
    name?: string | null;
    biography?: string | null;
    website?: string | null;
    followers_count?: number | null;
    follows_count?: number | null;
    media_count?: number | null;
  };
  media?: ApiPost[];
};

export async function buildInputs(s: Scope, profileId: string): Promise<DiagnosisInputs> {
  const { profile, industry } = await loadProfile(s, profileId);
  const manual = { ...EMPTY_MANUAL, ...(profile.manual ?? {}) };
  const [conn] = await s.db
    .select({ status: brandRadarConnections.status, lastSync: brandRadarConnections.lastSync })
    .from(brandRadarConnections)
    .where(eq(brandRadarConnections.profileId, profile.id));
  // Última leitura da conta conectada (mesmo vencida, vale com a data da coleta).
  const api = (conn?.lastSync as ApiSnapshot | null | undefined) ?? null;
  const [brand] = await s.db.select().from(brandProfiles).where(eq(brandProfiles.clientId, profile.clientId));
  const competitors = await s.db
    .select({ handle: brandRadarProfiles.handle, notes: brandRadarProfiles.notes, manual: brandRadarProfiles.manual })
    .from(brandRadarProfiles)
    .where(
      and(
        eq(brandRadarProfiles.clientId, profile.clientId),
        eq(brandRadarProfiles.kind, "competitor"),
        isNull(brandRadarProfiles.archivedAt),
        ne(brandRadarProfiles.id, profile.id),
      ),
    )
    .limit(10);

  const manualAt = manual.updatedAt ?? profile.updatedAt.toISOString();
  const apiAt = api?.fetchedAt ?? null;
  const sources: DiagnosisInputs["sources"] = [];
  const pick = <T>(apiValue: T | null | undefined, manualValue: T | null | undefined, empty: (v: T) => boolean) => {
    if (apiAt && apiValue !== null && apiValue !== undefined && !empty(apiValue))
      return { value: apiValue, source: "instagram_api" as SourceKind, collectedAt: apiAt };
    if (manualValue !== null && manualValue !== undefined && !empty(manualValue))
      return { value: manualValue, source: "manual" as SourceKind, collectedAt: manualAt };
    return null;
  };
  const blank = (v: string) => !v.trim();
  const p = api?.profile;
  const inputs: DiagnosisInputs = {
    handle: profile.handle,
    profileUrl: profile.profileUrl,
    sources,
    profile: {
      displayName: pick(p?.name ?? null, manual.displayName, blank),
      category: pick<string>(null, manual.category, blank),
      bio: pick(p?.biography ?? null, manual.bio, blank),
      link: pick(p?.website ?? null, manual.link, blank),
      followers: pick(p?.followers_count ?? null, manual.followers, () => false),
      following: pick<number>(p?.follows_count ?? null, null, () => false),
      postsCount: pick<number>(p?.media_count ?? null, null, () => false),
    },
    highlights: manual.highlights.length ? { value: manual.highlights, source: "manual", collectedAt: manualAt } : null,
    posts: api?.media?.length
      ? { items: api.media, source: "instagram_api", collectedAt: apiAt! }
      : manual.posts.length
        ? { items: manual.posts, source: "manual", collectedAt: manualAt }
        : null,
    screenshots: manual.screenshots,
    brand: brand
      ? {
          audience: brand.audience,
          positioning: brand.positioning,
          toneOfVoice: brand.toneOfVoice,
          objectives: brand.objectives,
          industry,
        }
      : industry
        ? { audience: null, positioning: null, toneOfVoice: null, objectives: null, industry }
        : null,
    niche: { niche: profile.niche, market: profile.market, region: profile.region },
    goals: manual.goals,
    notes: manual.notes,
    competitors: competitors.map((c) => ({
      handle: c.handle,
      notes: c.notes ?? "",
      bio: (c.manual as ManualInputs | null)?.bio ?? "",
    })),
    missing: [],
  };
  if (apiAt)
    sources.push({ kind: "instagram_api", label: "Conta conectada (API oficial do Instagram)", collectedAt: apiAt });
  if (manual.updatedAt) sources.push({ kind: "manual", label: "Dados informados pela equipe", collectedAt: manualAt });
  if (manual.screenshots.length)
    sources.push({
      kind: "screenshot",
      label: `${manual.screenshots.length} captura(s) de tela`,
      collectedAt: manualAt,
    });
  if (inputs.brand)
    sources.push({
      kind: "client_record",
      label: "Cadastro e perfil de marca do cliente",
      collectedAt: brand?.updatedAt?.toISOString() ?? manualAt,
    });

  const missing = inputs.missing;
  if (!inputs.profile.bio) missing.push("Bio atual do perfil");
  if (!inputs.highlights) missing.push("Destaques (nomes ou captura de tela)");
  if (!inputs.posts && !manual.screenshots.some((x) => x.kind === "grid")) missing.push("Publicações recentes");
  if (!manual.screenshots.length) missing.push("Capturas de tela (perfil, grade, destaques)");
  if (!apiAt) missing.push("Métricas reais (conecte a conta profissional)");
  if (!inputs.niche.niche && !inputs.brand?.audience) missing.push("Nicho e público do cliente");
  return inputs;
}

/* ------------------------------------------------------------------ */
/* Área de trabalho do perfil                                           */
/* ------------------------------------------------------------------ */

export async function getRadarWorkspace(s: Scope, profileId: string) {
  assertBrandRead(s);
  const { profile, clientName, industry } = await loadProfile(s, profileId);
  const [connection] = await s.db
    .select({
      status: brandRadarConnections.status,
      username: brandRadarConnections.username,
      accountType: brandRadarConnections.accountType,
      tokenExpiresAt: brandRadarConnections.tokenExpiresAt,
      lastSyncAt: brandRadarConnections.lastSyncAt,
      lastError: brandRadarConnections.lastError,
      scopes: brandRadarConnections.scopes,
    })
    .from(brandRadarConnections)
    .where(eq(brandRadarConnections.profileId, profile.id));
  const competitors = await s.db
    .select({
      id: brandRadarProfiles.id,
      handle: brandRadarProfiles.handle,
      profileUrl: brandRadarProfiles.profileUrl,
      notes: brandRadarProfiles.notes,
      manual: brandRadarProfiles.manual,
    })
    .from(brandRadarProfiles)
    .where(
      and(
        eq(brandRadarProfiles.clientId, profile.clientId),
        eq(brandRadarProfiles.kind, "competitor"),
        isNull(brandRadarProfiles.archivedAt),
        ne(brandRadarProfiles.id, profile.id),
      ),
    )
    .orderBy(brandRadarProfiles.handle);
  const diagnoses = await s.db
    .select({
      id: brandRadarDiagnoses.id,
      kind: brandRadarDiagnoses.kind,
      overallScore: brandRadarDiagnoses.overallScore,
      evaluatedWeight: brandRadarDiagnoses.evaluatedWeight,
      methodologyVersion: brandRadarDiagnoses.methodologyVersion,
      provider: brandRadarDiagnoses.provider,
      model: brandRadarDiagnoses.model,
      demo: brandRadarDiagnoses.demo,
      createdAt: brandRadarDiagnoses.createdAt,
      createdBy: user.name,
    })
    .from(brandRadarDiagnoses)
    .leftJoin(user, eq(user.id, brandRadarDiagnoses.createdByUserId))
    .where(eq(brandRadarDiagnoses.profileId, profile.id))
    .orderBy(desc(brandRadarDiagnoses.createdAt))
    .limit(100);
  const latestFullId = diagnoses.find((d) => d.kind === "full")?.id ?? null;
  const latestNicheId = diagnoses.find((d) => d.kind === "niche")?.id ?? null;
  const fetchFull = async (id: string | null) => {
    if (!id) return null;
    const [d] = await s.db.select().from(brandRadarDiagnoses).where(eq(brandRadarDiagnoses.id, id));
    return d ?? null;
  };
  const recommendations = await s.db
    .select({
      rec: brandRadarRecommendations,
      assigneeName: user.name,
    })
    .from(brandRadarRecommendations)
    .leftJoin(memberships, eq(memberships.id, brandRadarRecommendations.assigneeMembershipId))
    .leftJoin(user, eq(user.id, memberships.userId))
    .where(eq(brandRadarRecommendations.profileId, profile.id))
    .orderBy(brandRadarRecommendations.priority, desc(brandRadarRecommendations.createdAt))
    .limit(300);
  const bios = await s.db
    .select()
    .from(brandRadarBioVersions)
    .where(eq(brandRadarBioVersions.profileId, profile.id))
    .orderBy(desc(brandRadarBioVersions.createdAt))
    .limit(60);
  const settings = await radarSettings(s);
  return {
    profile: { ...profile, manual: { ...EMPTY_MANUAL, ...(profile.manual ?? {}) } },
    clientName,
    industry,
    connection: connection ?? null,
    competitors: competitors.map((c) => ({ ...c, manual: { ...EMPTY_MANUAL, ...((c.manual as ManualInputs) ?? {}) } })),
    diagnoses,
    latest: await fetchFull(latestFullId),
    latestNiche: await fetchFull(latestNicheId),
    recommendations: recommendations.map((r) => ({ ...r.rec, assigneeName: r.assigneeName })),
    bios,
    settings,
  };
}

export async function getDiagnosis(s: Scope, id: string) {
  assertBrandRead(s);
  if (!uuid.safeParse(id).success) throw new NotFoundError("Diagnóstico não encontrado.");
  const [d] = await s.db.select().from(brandRadarDiagnoses).where(eq(brandRadarDiagnoses.id, id));
  if (!d) throw new NotFoundError("Diagnóstico não encontrado.");
  await loadProfile(s, d.profileId);
  return d;
}

/* ------------------------------------------------------------------ */
/* Comparação entre diagnósticos (linha do tempo)                       */
/* ------------------------------------------------------------------ */

export async function compareDiagnoses(s: Scope, beforeId: string, afterId: string) {
  const a = await getDiagnosis(s, beforeId);
  const b = await getDiagnosis(s, afterId);
  if (a.profileId !== b.profileId) throw new ValidationError("Escolha dois diagnósticos do mesmo perfil.");
  const [older, newer] = a.createdAt <= b.createdAt ? [a, b] : [b, a];
  const ra = older.result as DiagnosisResult;
  const rb = newer.result as DiagnosisResult;
  const dims = DIMENSION_KEYS.map((key) => {
    const x = ra.dimensions?.find((d) => d.key === key);
    const y = rb.dimensions?.find((d) => d.key === key);
    return {
      key,
      label: BRAND_DIMENSIONS[key].label,
      before: x?.score ?? null,
      after: y?.score ?? null,
      beforeStatus: x?.status ?? "not_evaluated",
      afterStatus: y?.status ?? "not_evaluated",
      delta: x?.score != null && y?.score != null ? y.score - x.score : null,
    };
  });
  const recs = await s.db
    .select({ status: brandRadarRecommendations.status, diagnosisId: brandRadarRecommendations.diagnosisId })
    .from(brandRadarRecommendations)
    .where(eq(brandRadarRecommendations.diagnosisId, older.id));
  const metric = (d: typeof older) => {
    const f = (d.inputs as DiagnosisInputs).profile.followers;
    return f?.source === "instagram_api" ? { value: f.value, collectedAt: f.collectedAt } : null;
  };
  return {
    before: {
      id: older.id,
      createdAt: older.createdAt,
      score: older.overallScore,
      methodology: older.methodologyVersion,
    },
    after: {
      id: newer.id,
      createdAt: newer.createdAt,
      score: newer.overallScore,
      methodology: newer.methodologyVersion,
    },
    methodologyChanged:
      older.methodologyVersion !== newer.methodologyVersion ||
      JSON.stringify(older.weights) !== JSON.stringify(newer.weights),
    dimensions: dims,
    bio: {
      before: (older.inputs as DiagnosisInputs).profile.bio?.value ?? null,
      after: (newer.inputs as DiagnosisInputs).profile.bio?.value ?? null,
    },
    highlights: {
      before: (older.inputs as DiagnosisInputs).highlights?.value ?? [],
      after: (newer.inputs as DiagnosisInputs).highlights?.value ?? [],
    },
    screenshots: {
      before: (older.inputs as DiagnosisInputs).screenshots,
      after: (newer.inputs as DiagnosisInputs).screenshots,
    },
    recommendations: {
      done: recs.filter((r) => r.status === "done").length,
      pending: recs.filter((r) => r.status === "open" || r.status === "in_progress").length,
      dismissed: recs.filter((r) => r.status === "dismissed").length,
    },
    followers: { before: metric(older), after: metric(newer) },
    demo: ra.demo || rb.demo,
  };
}

/* ------------------------------------------------------------------ */
/* Recomendações                                                        */
/* ------------------------------------------------------------------ */

async function loadRecommendation(s: Scope, id: string) {
  if (!uuid.safeParse(id).success) throw new NotFoundError("Recomendação não encontrada.");
  const [rec] = await s.db.select().from(brandRadarRecommendations).where(eq(brandRadarRecommendations.id, id));
  if (!rec) throw new NotFoundError("Recomendação não encontrada.");
  const p = await loadProfile(s, rec.profileId);
  return { rec, ...p };
}

export const recommendationUpdateInput = z.object({
  id: z.uuid(),
  status: z.enum(Object.keys(RECOMMENDATION_STATUS) as [keyof typeof RECOMMENDATION_STATUS]).optional(),
  category: z.enum(Object.keys(RECOMMENDATION_CATEGORIES) as [keyof typeof RECOMMENDATION_CATEGORIES]).optional(),
  priority: z.coerce.number().int().min(1).max(5).optional(),
  assigneeMembershipId: z.uuid().nullable().optional(),
  dueDate: z
    .union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal(""), z.null()])
    .optional()
    .transform((v) => (v === undefined ? undefined : v || null)),
});

export async function updateRecommendation(s: Scope, raw: z.input<typeof recommendationUpdateInput>) {
  assertBrandManage(s);
  const data = recommendationUpdateInput.parse(raw);
  const { rec } = await loadRecommendation(s, data.id);
  if (data.assigneeMembershipId) {
    const [m] = await s.db
      .select({ id: memberships.id })
      .from(memberships)
      .where(and(eq(memberships.id, data.assigneeMembershipId), eq(memberships.status, "active")));
    if (!m) throw new ValidationError("Responsável inválido.");
  }
  await s.db
    .update(brandRadarRecommendations)
    .set({
      ...(data.status ? { status: data.status } : {}),
      ...(data.category ? { category: data.category } : {}),
      ...(data.priority ? { priority: data.priority } : {}),
      ...(data.assigneeMembershipId !== undefined ? { assigneeMembershipId: data.assigneeMembershipId } : {}),
      ...(data.dueDate !== undefined ? { dueDate: data.dueDate } : {}),
    })
    .where(eq(brandRadarRecommendations.id, rec.id));
}

const projectChoice = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("existing"), id: z.uuid() }),
  z.object({ mode: z.literal("new"), name: z.string().trim().min(2).max(160) }),
]);

async function resolveProject(s: Scope, clientId: string, choice: z.infer<typeof projectChoice>) {
  if (choice.mode === "existing") {
    const p = await assertProjectAccess(s, choice.id);
    if (p.clientId !== clientId) throw new ValidationError("O projeto é de outro cliente.");
    return choice.id;
  }
  assertCan(s.actor, "projects.write");
  return (
    await createProject(s, {
      clientId,
      name: choice.name,
      objective: "Implementar as recomendações do Radar de Marca.",
    })
  ).id;
}

export const recommendationTaskInput = z.object({
  id: z.uuid(),
  project: projectChoice,
  assigneeMembershipId: z.uuid().nullable().optional(),
  dueDate: z
    .union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal(""), z.null()])
    .optional()
    .transform((v) => v || null),
});

/** Transforma a recomendação em tarefa no módulo de tarefas (com o contexto do diagnóstico). */
export async function recommendationToTask(s: Scope, raw: z.input<typeof recommendationTaskInput>) {
  assertBrandManage(s);
  assertCan(s.actor, "tasks.write");
  const data = recommendationTaskInput.parse(raw);
  const { rec, profile } = await loadRecommendation(s, data.id);
  if (rec.taskId) {
    const [t] = await s.db
      .select({ projectId: tasks.projectId })
      .from(tasks)
      .where(and(eq(tasks.id, rec.taskId), isNull(tasks.deletedAt)));
    if (t) return { taskId: rec.taskId, projectId: t.projectId, existed: true };
  }
  const projectId = await resolveProject(s, profile.clientId, data.project);
  const task = await createTask(s, {
    projectId,
    title: rec.title.slice(0, 300),
    description: [
      `Radar de Marca — @${profile.handle} (${RECOMMENDATION_CATEGORIES[rec.category]}).`,
      `Problema: ${rec.problem}`,
      rec.evidence ? `Evidência: ${rec.evidence}${rec.evidenceSource ? ` (fonte: ${rec.evidenceSource})` : ""}` : null,
      rec.nextAction ? `Próxima ação: ${rec.nextAction}` : null,
      rec.howToTest ? `Como testar: ${rec.howToTest}` : null,
    ]
      .filter(Boolean)
      .join("\n\n"),
    assigneeMembershipId: data.assigneeMembershipId ?? rec.assigneeMembershipId ?? null,
    dueDate: data.dueDate ?? rec.dueDate ?? null,
    priority: rec.priority <= 1 ? "urgent" : rec.priority === 2 ? "high" : rec.priority >= 4 ? "low" : "medium",
  });
  await s.db
    .update(brandRadarRecommendations)
    .set({ taskId: task.id, status: rec.status === "open" ? "in_progress" : rec.status })
    .where(eq(brandRadarRecommendations.id, rec.id));
  return { taskId: task.id, projectId, existed: false };
}

/* Artes iniciais no editor (formato 2), com o texto da recomendação em camadas editáveis. */
const DESIGN_FORMATS = {
  feed: { label: "Post do feed", width: 1080, height: 1350, pages: 1, carousel: false },
  carousel: { label: "Carrossel", width: 1080, height: 1350, pages: 3, carousel: true },
  stories: { label: "Stories", width: 1080, height: 1920, pages: 3, carousel: false },
  highlight_cover: { label: "Capa de destaque", width: 1080, height: 1920, pages: 1, carousel: false },
} as const;
export type RadarDesignFormat = keyof typeof DESIGN_FORMATS;

async function brandLook(s: Scope, clientId: string) {
  const [b] = await s.db
    .select({ colors: brandProfiles.colors, fonts: brandProfiles.fonts })
    .from(brandProfiles)
    .where(eq(brandProfiles.clientId, clientId));
  return {
    font: b?.fonts?.[0]?.name || "Inter",
    color: b?.colors?.[0]?.hex || "#121110",
    accent: b?.colors?.[1]?.hex || b?.colors?.[0]?.hex || "#F4BF2F",
  };
}

function pageObjects(
  size: { width: number; height: number },
  look: { font: string; color: string; accent: string },
  texts: { title: string; body?: string | null },
): DesignObject[] {
  const { width: W, height: H } = size;
  const t = (text: string, o: { cy: number; w: number; fs: number; fw: number; color: string; name: string }) => {
    const obj = textObject({
      name: o.name,
      text,
      x: Math.round((W - o.w) / 2),
      y: 0,
      width: Math.round(o.w),
      fontFamily: look.font,
      fontSize: o.fs,
      fontWeight: o.fw,
      color: o.color,
      textAlign: "center",
      lineHeight: 1.15,
      measure: "center",
    });
    obj.y = Math.round(o.cy - obj.height / 2);
    return obj;
  };
  const out = [
    t(texts.title, { cy: H * 0.42, w: W * 0.82, fs: Math.round(W * 0.07), fw: 700, color: look.color, name: "Título" }),
  ];
  if (texts.body)
    out.push(
      t(texts.body, { cy: H * 0.6, w: W * 0.78, fs: Math.round(W * 0.038), fw: 400, color: look.color, name: "Texto" }),
    );
  return out;
}

async function makeRadarDesign(
  s: Scope,
  o: { clientId: string; name: string; format: RadarDesignFormat; pages: { title: string; body?: string | null }[] },
) {
  assertCan(s.actor, "designs.write");
  const f = DESIGN_FORMATS[o.format];
  const look = await brandLook(s, o.clientId);
  const count = Math.max(1, Math.min(o.pages.length || f.pages, 10));
  const pages = Array.from({ length: count }, (_, i) => o.pages[i] ?? { title: `Página ${i + 1}` });
  const document = createDocument({
    carousel: f.carousel,
    preset: f.carousel ? "carousel-portrait" : null,
    pages: pages.map((p, i) => ({
      width: f.width,
      height: f.height,
      name: f.carousel ? `Slide ${i + 1}` : count > 1 ? `Tela ${i + 1}` : undefined,
      background: "#ffffff",
      objects: pageObjects({ width: f.width, height: f.height }, look, p),
    })),
  });
  const { id } = await createDesign(s, {
    name: o.name.slice(0, 120),
    width: f.width,
    height: f.height,
    clientId: o.clientId,
    projectId: null,
    document: document as unknown as Record<string, unknown>,
  });
  return id;
}

export const recommendationDesignInput = z.object({
  id: z.uuid(),
  format: z.enum(Object.keys(DESIGN_FORMATS) as [RadarDesignFormat]),
});

/** Cria uma arte, carrossel ou sequência de Stories no editor a partir da recomendação. */
export async function recommendationToDesign(s: Scope, raw: z.input<typeof recommendationDesignInput>) {
  assertBrandManage(s);
  const data = recommendationDesignInput.parse(raw);
  const { rec, profile } = await loadRecommendation(s, data.id);
  const f = DESIGN_FORMATS[data.format];
  const pages =
    f.pages > 1
      ? [
          { title: rec.title, body: rec.problem },
          { title: "O que muda", body: rec.nextAction || rec.problem },
          { title: "Próximo passo", body: rec.howToTest || "Chamada para ação" },
        ]
      : [{ title: rec.title, body: rec.nextAction || rec.problem }];
  const designId = await makeRadarDesign(s, {
    clientId: profile.clientId,
    name: `${rec.title} — ${f.label}`,
    format: data.format,
    pages,
  });
  await s.db
    .update(brandRadarRecommendations)
    .set({ designId, status: rec.status === "open" ? "in_progress" : rec.status })
    .where(eq(brandRadarRecommendations.id, rec.id));
  return { designId };
}

export const recommendationContentInput = z.object({
  id: z.uuid(),
  format: z.enum(CONTENT_FORMAT_KEYS).default("feed"),
  campaign: z
    .discriminatedUnion("mode", [
      z.object({ mode: z.literal("none") }),
      z.object({ mode: z.literal("existing"), id: z.uuid() }),
      z.object({ mode: z.literal("new"), name: z.string().trim().min(2).max(160) }),
    ])
    .default({ mode: "none" }),
});

/** Cria um conteúdo (rascunho no calendário editorial) e, se pedido, a campanha. */
export async function recommendationToContent(s: Scope, raw: z.input<typeof recommendationContentInput>) {
  assertBrandManage(s);
  assertCan(s.actor, "content.write");
  const data = recommendationContentInput.parse(raw);
  const { rec, profile } = await loadRecommendation(s, data.id);
  let campaignId: string | null = null;
  if (data.campaign.mode === "new") {
    campaignId = (
      await createCampaign(s, {
        clientId: profile.clientId,
        name: data.campaign.name,
        objective: `Radar de Marca: ${rec.title}`,
      })
    ).id;
  } else if (data.campaign.mode === "existing") {
    campaignId = data.campaign.id;
  }
  const item = await createContent(s, {
    clientId: profile.clientId,
    campaignId,
    format: data.format as ContentFormat,
    title: rec.title.slice(0, 200),
    concept: rec.problem,
    strategy:
      [rec.nextAction, rec.howToTest ? `Como testar: ${rec.howToTest}` : null].filter(Boolean).join("\n\n") || null,
  });
  await s.db
    .update(brandRadarRecommendations)
    .set({ contentItemId: item.id, campaignId, status: rec.status === "open" ? "in_progress" : rec.status })
    .where(eq(brandRadarRecommendations.id, rec.id));
  return { contentItemId: item.id, campaignId, format: CONTENT_FORMATS[data.format as ContentFormat].label };
}

export const contentIdeaInput = z.object({
  diagnosisId: z.uuid(),
  index: z.coerce.number().int().min(0).max(20),
  format: z.enum(CONTENT_FORMAT_KEYS).default("feed"),
});

/** "Criar conteúdo com base neste diagnóstico": a ideia (hipótese) vira um rascunho de conteúdo. */
export async function contentIdeaToContent(s: Scope, raw: z.input<typeof contentIdeaInput>) {
  assertBrandManage(s);
  assertCan(s.actor, "content.write");
  const data = contentIdeaInput.parse(raw);
  const d = await getDiagnosis(s, data.diagnosisId);
  const idea = (d.result as DiagnosisResult).content?.recommendations?.[data.index];
  if (!idea) throw new NotFoundError("Ideia não encontrada neste diagnóstico.");
  const item = await createContent(s, {
    clientId: d.clientId,
    format: data.format as ContentFormat,
    title: idea.idea.slice(0, 200),
    concept: `Hipótese: ${idea.hypothesis}`,
    strategy: idea.howToTest ? `Como testar: ${idea.howToTest}` : null,
  });
  return { contentItemId: item.id };
}

/* ------------------------------------------------------------------ */
/* Destaques recomendados → capa, Stories e tarefa                      */
/* ------------------------------------------------------------------ */

export const highlightActionInput = z.object({
  diagnosisId: z.uuid(),
  index: z.coerce.number().int().min(0).max(40),
  kind: z.enum(["cover", "stories"]),
});

async function loadHighlight(s: Scope, diagnosisId: string, index: number) {
  const d = await getDiagnosis(s, diagnosisId);
  const h = (d.result as DiagnosisResult).highlights?.recommended?.[index] as HighlightPlan | undefined;
  if (!h) throw new NotFoundError("Destaque não encontrado neste diagnóstico.");
  return { d, h };
}

export async function highlightToDesign(s: Scope, raw: z.input<typeof highlightActionInput>) {
  assertBrandManage(s);
  const data = highlightActionInput.parse(raw);
  const { d, h } = await loadHighlight(s, data.diagnosisId, data.index);
  const designId =
    data.kind === "cover"
      ? await makeRadarDesign(s, {
          clientId: d.clientId,
          name: `Capa do destaque "${h.name}"`,
          format: "highlight_cover",
          pages: [{ title: h.name, body: h.coverDirection }],
        })
      : await makeRadarDesign(s, {
          clientId: d.clientId,
          name: `Stories do destaque "${h.name}"`,
          format: "stories",
          pages: (h.storyIdeas.length ? h.storyIdeas : [h.objective]).slice(0, 10).map((idea, i) => ({
            title: i === 0 ? h.name : `${h.name} · ${i + 1}`,
            body: idea,
          })),
        });
  return { designId };
}

export const highlightTaskInput = z.object({
  diagnosisId: z.uuid(),
  index: z.coerce.number().int().min(0).max(40),
  project: projectChoice,
});

export async function highlightToTask(s: Scope, raw: z.input<typeof highlightTaskInput>) {
  assertBrandManage(s);
  assertCan(s.actor, "tasks.write");
  const data = highlightTaskInput.parse(raw);
  const { d, h } = await loadHighlight(s, data.diagnosisId, data.index);
  const projectId = await resolveProject(s, d.clientId, data.project);
  const task = await createTask(s, {
    projectId,
    title: `Destaque "${h.name}": capa e Stories`.slice(0, 300),
    description: [
      `Objetivo: ${h.objective}`,
      `Ordem recomendada: ${h.order}`,
      h.storyIdeas.length ? `Ideias de Stories:\n${h.storyIdeas.map((x) => `- ${x}`).join("\n")}` : null,
      `Direção da capa: ${h.coverDirection}`,
      `Prompt da capa: ${h.coverPrompt}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
  });
  return { taskId: task.id, projectId };
}

/* ------------------------------------------------------------------ */
/* Versões de bio                                                       */
/* ------------------------------------------------------------------ */

async function loadBio(s: Scope, id: string) {
  if (!uuid.safeParse(id).success) throw new NotFoundError("Versão não encontrada.");
  const [bio] = await s.db.select().from(brandRadarBioVersions).where(eq(brandRadarBioVersions.id, id));
  if (!bio) throw new NotFoundError("Versão não encontrada.");
  const p = await loadProfile(s, bio.profileId);
  return { bio, ...p };
}

export const bioSaveInput = z.object({
  id: z.uuid().optional(),
  profileId: z.uuid(),
  text: z.string().trim().min(1, "Escreva a bio").max(1000),
  objective: z.string().trim().max(500).default(""),
  cta: z.string().trim().max(200).default(""),
});

/** Salva uma versão editada (nova versão "editada"; a original fica no histórico). */
export async function saveBioVersion(s: Scope, raw: z.input<typeof bioSaveInput>) {
  assertBrandManage(s);
  const data = bioSaveInput.parse(raw);
  const { profile } = await loadProfile(s, data.profileId);
  let base: typeof brandRadarBioVersions.$inferSelect | null = null;
  if (data.id) {
    const loaded = await loadBio(s, data.id);
    if (loaded.bio.profileId !== profile.id) throw new ValidationError("Versão de outro perfil.");
    base = loaded.bio;
  }
  const settings = await radarSettings(s);
  const warnings =
    countChars(data.text) > settings.bioLimit ? [`Passa do limite de ${settings.bioLimit} caracteres.`] : [];
  const [row] = await s.db
    .insert(brandRadarBioVersions)
    .values({
      organizationId: s.actor.orgId,
      clientId: profile.clientId,
      profileId: profile.id,
      diagnosisId: base?.diagnosisId ?? null,
      style: "custom",
      text: data.text,
      objective: data.objective || base?.objective || "",
      strengths: base?.strengths ?? [],
      cta: data.cta || base?.cta || "",
      warnings: [...warnings, ...(base?.warnings ?? []).filter((w) => !w.startsWith("Passa do limite"))],
      createdByUserId: s.actor.userId,
    })
    .returning();
  return row!;
}

/** "Usar esta versão": grava como bio planejada no cadastro do perfil na plataforma (não altera o Instagram). */
export async function chooseBioVersion(s: Scope, id: string) {
  assertBrandManage(s);
  const { bio, profile } = await loadBio(s, id);
  await s.db
    .update(brandRadarBioVersions)
    .set({ status: "draft" })
    .where(and(eq(brandRadarBioVersions.profileId, profile.id), eq(brandRadarBioVersions.status, "chosen")));
  await s.db.update(brandRadarBioVersions).set({ status: "chosen" }).where(eq(brandRadarBioVersions.id, bio.id));
  await s.db
    .update(brandRadarProfiles)
    .set({ plannedBio: bio.text, plannedBioAt: new Date(), plannedBioByUserId: s.actor.userId })
    .where(eq(brandRadarProfiles.id, profile.id));
  await recordActivity(s, {
    action: "updated",
    entityType: "brand_radar_profile",
    entityId: profile.id,
    summary: `Radar de Marca: bio escolhida para @${profile.handle} (${BIO_STYLES[bio.style]})`,
    event: false,
  });
}

export const bioApprovalInput = z.object({
  id: z.uuid(),
  stage: z.enum(["internal", "client"]).default("internal"),
  message: z.string().trim().max(1000).optional().nullable(),
});

/** Envia a versão para aprovação pelo fluxo existente (arquivo de texto do cliente + aprovação). */
export async function sendBioForApproval(s: Scope, raw: z.input<typeof bioApprovalInput>) {
  assertBrandManage(s);
  assertCan(s.actor, "approvals.request");
  assertCan(s.actor, "files.write");
  const data = bioApprovalInput.parse(raw);
  const { bio, profile, clientName } = await loadBio(s, data.id);
  const body = [
    `Proposta de bio do Instagram — @${profile.handle} (${clientName})`,
    "",
    bio.text,
    "",
    `Estilo: ${BIO_STYLES[bio.style]}`,
    bio.objective ? `Objetivo: ${bio.objective}` : null,
    bio.cta ? `Chamada para ação: ${bio.cta}` : null,
    `Caracteres: ${countChars(bio.text)}`,
    bio.warnings.length ? `Confirmar com o cliente: ${bio.warnings.join(" ")}` : null,
    "",
    "Gerado pelo Radar de Marca. Aprovar não altera o Instagram: a bio é trocada manualmente no aplicativo.",
  ]
    .filter((x) => x !== null)
    .join("\n");
  const stored = await storeUpload(
    s,
    { buffer: Buffer.from(body, "utf8"), originalName: `bio-${profile.handle}-${bio.id.slice(0, 6)}.txt` },
    { clientId: profile.clientId, category: "document", tags: ["radar-de-marca", "bio"], source: "ai" },
  );
  const approval = await requestApproval(s, {
    fileId: stored.fileId,
    stage: data.stage,
    message: data.message ?? `Proposta de bio para @${profile.handle}.`,
  });
  await s.db
    .update(brandRadarBioVersions)
    .set({ status: "sent_for_approval", fileId: stored.fileId })
    .where(eq(brandRadarBioVersions.id, bio.id));
  return { fileId: stored.fileId, approval };
}

export const bioTaskInput = z.object({ id: z.uuid(), project: projectChoice });

export async function bioToTask(s: Scope, raw: z.input<typeof bioTaskInput>) {
  assertBrandManage(s);
  assertCan(s.actor, "tasks.write");
  const data = bioTaskInput.parse(raw);
  const { bio, profile } = await loadBio(s, data.id);
  const projectId = await resolveProject(s, profile.clientId, data.project);
  const task = await createTask(s, {
    projectId,
    title: `Implementar nova bio do Instagram (@${profile.handle})`,
    description: [
      "Trocar a bio no aplicativo do Instagram depois da aprovação do cliente.",
      `Texto:\n${bio.text}`,
      bio.warnings.length ? `Confirmar antes: ${bio.warnings.join(" ")}` : null,
    ]
      .filter(Boolean)
      .join("\n\n"),
  });
  await s.db.update(brandRadarBioVersions).set({ taskId: task.id }).where(eq(brandRadarBioVersions.id, bio.id));
  return { taskId: task.id, projectId };
}

/* ------------------------------------------------------------------ */
/* Exportação (CSV) e opções dos formulários                            */
/* ------------------------------------------------------------------ */

export async function recommendationsForExport(s: Scope, profileId: string) {
  assertBrandRead(s);
  const { profile, clientName } = await loadProfile(s, profileId);
  const rows = await s.db
    .select({ rec: brandRadarRecommendations, diagnosisAt: brandRadarDiagnoses.createdAt })
    .from(brandRadarRecommendations)
    .innerJoin(brandRadarDiagnoses, eq(brandRadarDiagnoses.id, brandRadarRecommendations.diagnosisId))
    .where(eq(brandRadarRecommendations.profileId, profile.id))
    .orderBy(brandRadarRecommendations.priority);
  return { profile, clientName, rows };
}

export async function radarFormOptions(s: Scope, clientId?: string) {
  assertBrandRead(s);
  const clientRows = await s.db
    .select({ id: clients.id, name: clients.name })
    .from(clients)
    .where(and(clientScope(s.actor), isNull(clients.archivedAt)))
    .orderBy(clients.name)
    .limit(500);
  const projectRows = clientId
    ? await s.db
        .select({ id: projects.id, name: projects.name })
        .from(projects)
        .where(and(eq(projects.clientId, clientId), isNull(projects.deletedAt), isNull(projects.archivedAt)))
        .orderBy(projects.name)
        .limit(200)
    : [];
  const members = await s.db
    .select({ id: memberships.id, name: user.name })
    .from(memberships)
    .innerJoin(user, eq(user.id, memberships.userId))
    .where(eq(memberships.status, "active"))
    .orderBy(user.name)
    .limit(300);
  return { clients: clientRows, projects: projectRows, members };
}

/** Designs criados a partir do Radar (para o link "abrir no editor"). */
export async function designExists(s: Scope, id: string) {
  const [d] = await s.db.select({ id: designs.id }).from(designs).where(eq(designs.id, id));
  return !!d;
}

export const CONTENT_CATEGORY_KEYS = Object.keys(CONTENT_CATEGORIES);
