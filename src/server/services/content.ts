import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  campaignInput,
  CONTENT_FORMAT_KEYS,
  CONTENT_FORMATS,
  contentItemInput,
  contentListParams,
  contentTextInput,
  contentUpdateInput,
  type ContentFormat,
} from "@/lib/content";
import {
  assertCan,
  assertClientAccess,
  assertInternal,
  assertProjectAccess,
  can,
  clientScope,
  inOrg,
  type Actor,
  type Scope,
} from "@/server/authz";
import {
  brandProfiles,
  campaigns,
  clients,
  contentItemAssets,
  contentItems,
  designs,
  files,
  fileVersions,
  projects,
  requests,
  tasks,
  trendAnalyses,
  trends,
  user,
} from "@/server/db/schema";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { recordActivity } from "./activity";
import { aiSelectionInput } from "./ai-models";
import { prepareImage } from "./ai-images";
import { runImage } from "./ai-run";
import { createDesign, saveDesign } from "./designs";
import { createProject } from "./projects";
import { createRequest } from "./requests";
import { createTask } from "./tasks";

/*
 * Peças de conteúdo, campanhas e calendário editorial. Uma peça vive no
 * cliente e só aponta para os registros que já existem (artes do editor,
 * arquivos, tarefa, solicitação, tendência) — nada é copiado.
 */

/** Escopo: peças e campanhas de clientes que o ator pode ver (e fora da lixeira). */
function visibleClientIds(s: Scope) {
  return s.db.select({ id: clients.id }).from(clients).where(clientScope(s.actor));
}

function readAccess(s: Scope) {
  assertInternal(s.actor);
  assertCan(s.actor, "content.read");
}

function writeAccess(s: Scope) {
  assertInternal(s.actor);
  assertCan(s.actor, "content.write");
}

/* ------------------------------------------------------------------ */
/* Campanhas                                                           */
/* ------------------------------------------------------------------ */

export async function listCampaigns(s: Scope, clientId?: string) {
  readAccess(s);
  return s.db
    .select({
      id: campaigns.id,
      name: campaigns.name,
      clientId: campaigns.clientId,
      clientName: clients.name,
      startsOn: campaigns.startsOn,
      endsOn: campaigns.endsOn,
    })
    .from(campaigns)
    .innerJoin(clients, eq(clients.id, campaigns.clientId))
    .where(
      and(inArray(campaigns.clientId, visibleClientIds(s)), clientId ? eq(campaigns.clientId, clientId) : undefined),
    )
    .orderBy(desc(campaigns.createdAt))
    .limit(300);
}

export async function createCampaign(s: Scope, raw: z.input<typeof campaignInput>) {
  writeAccess(s);
  const data = campaignInput.parse(raw);
  await assertClientAccess(s, data.clientId);
  if (data.startsOn && data.endsOn && data.endsOn < data.startsOn) {
    throw new ValidationError("O fim da campanha deve ser depois do início.", { endsOn: ["Data inválida"] });
  }
  const [row] = await s.db
    .insert(campaigns)
    .values({ organizationId: s.actor.orgId, ...data, createdByUserId: s.actor.userId })
    .returning({ id: campaigns.id });
  await recordActivity(s, {
    action: "created",
    entityType: "campaign",
    entityId: row!.id,
    summary: `Campanha criada: ${data.name}`,
    event: false,
  });
  return { id: row!.id };
}

async function assertCampaign(s: Scope, campaignId: string, clientId: string) {
  const [c] = await s.db.select({ clientId: campaigns.clientId }).from(campaigns).where(eq(campaigns.id, campaignId));
  if (!c) throw new NotFoundError("Campanha não encontrada.");
  if (c.clientId !== clientId)
    throw new ValidationError("A campanha é de outro cliente.", { campaignId: ["Campanha de outro cliente"] });
}

/* ------------------------------------------------------------------ */
/* Peças                                                               */
/* ------------------------------------------------------------------ */

export async function listContent(s: Scope, raw: z.input<typeof contentListParams>) {
  readAccess(s);
  const p = contentListParams.parse(raw);
  return s.db
    .select({
      id: contentItems.id,
      title: contentItems.title,
      format: contentItems.format,
      status: contentItems.status,
      plannedDate: contentItems.plannedDate,
      clientId: contentItems.clientId,
      clientName: clients.name,
      campaignId: contentItems.campaignId,
      campaignName: campaigns.name,
      trendId: contentItems.trendId,
      trendTitle: trends.title,
      updatedAt: contentItems.updatedAt,
      assets: sql<number>`(select count(*)::int from ${contentItemAssets} where ${contentItemAssets.contentItemId} = ${contentItems.id})`,
    })
    .from(contentItems)
    .innerJoin(clients, eq(clients.id, contentItems.clientId))
    .leftJoin(campaigns, eq(campaigns.id, contentItems.campaignId))
    .leftJoin(trends, eq(trends.id, contentItems.trendId))
    .where(
      and(
        inArray(contentItems.clientId, visibleClientIds(s)),
        p.clientId ? eq(contentItems.clientId, p.clientId) : undefined,
        p.campaignId ? eq(contentItems.campaignId, p.campaignId) : undefined,
        p.status ? eq(contentItems.status, p.status) : undefined,
        p.format ? eq(contentItems.format, p.format) : undefined,
        p.from ? gte(contentItems.plannedDate, p.from) : undefined,
        p.to ? lte(contentItems.plannedDate, p.to) : undefined,
        p.q ? ilike(contentItems.title, `%${p.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`) : undefined,
      ),
    )
    .orderBy(sql`${contentItems.plannedDate} asc nulls last`, desc(contentItems.updatedAt))
    .limit(500);
}

export type ContentRow = Awaited<ReturnType<typeof listContent>>[number];

async function assertContent(s: Scope, id: string) {
  const [row] = await s.db
    .select({ id: contentItems.id, clientId: contentItems.clientId, title: contentItems.title })
    .from(contentItems)
    .where(and(eq(contentItems.id, id), inArray(contentItems.clientId, visibleClientIds(s))));
  if (!row) throw new NotFoundError("Conteúdo não encontrado.");
  return row;
}

export async function getContent(s: Scope, id: string) {
  readAccess(s);
  await assertContent(s, id);
  const [row] = await s.db
    .select({
      item: contentItems,
      clientName: clients.name,
      campaignName: campaigns.name,
      trendTitle: trends.title,
      trendUrl: trends.url,
      projectName: projects.name,
      taskTitle: tasks.title,
      requestNumber: requests.number,
      requestTitle: requests.title,
      createdByName: user.name,
    })
    .from(contentItems)
    .innerJoin(clients, eq(clients.id, contentItems.clientId))
    .leftJoin(campaigns, eq(campaigns.id, contentItems.campaignId))
    .leftJoin(trends, eq(trends.id, contentItems.trendId))
    .leftJoin(projects, and(eq(projects.id, contentItems.projectId), isNull(projects.deletedAt)))
    .leftJoin(tasks, eq(tasks.id, contentItems.taskId))
    .leftJoin(requests, eq(requests.id, contentItems.requestId))
    .leftJoin(user, eq(user.id, contentItems.createdByUserId))
    .where(eq(contentItems.id, id));
  const assets = await s.db
    .select({
      id: contentItemAssets.id,
      role: contentItemAssets.role,
      position: contentItemAssets.position,
      designId: designs.id,
      designName: designs.name,
      designThumb: designs.thumbnail,
      designWidth: designs.width,
      designHeight: designs.height,
      outputFileId: designs.outputFileId,
      fileId: files.id,
      fileName: files.name,
      fileStatus: files.status,
      versionId: files.currentVersionId,
      versionNumber: fileVersions.versionNumber,
    })
    .from(contentItemAssets)
    .leftJoin(designs, and(eq(designs.id, contentItemAssets.designId), isNull(designs.deletedAt)))
    .leftJoin(files, and(eq(files.id, contentItemAssets.fileId), isNull(files.deletedAt)))
    .leftJoin(fileVersions, eq(fileVersions.id, files.currentVersionId))
    .where(eq(contentItemAssets.contentItemId, id))
    .orderBy(asc(contentItemAssets.position));
  // Arquivos exportados das artes (saída do editor) aparecem junto, prontos para aprovação.
  const outputIds = assets.map((a) => a.outputFileId).filter((x): x is string => !!x);
  const outputs = outputIds.length
    ? await s.db
        .select({
          id: files.id,
          name: files.name,
          status: files.status,
          versionId: files.currentVersionId,
          versionNumber: fileVersions.versionNumber,
        })
        .from(files)
        .leftJoin(fileVersions, eq(fileVersions.id, files.currentVersionId))
        .where(and(inArray(files.id, outputIds), isNull(files.deletedAt)))
    : [];
  return { ...row!, assets: assets.filter((a) => a.designId || a.fileId), outputs };
}

export async function createContent(s: Scope, raw: z.input<typeof contentItemInput>) {
  writeAccess(s);
  const data = contentItemInput.parse(raw);
  await assertClientAccess(s, data.clientId);
  if (data.campaignId) await assertCampaign(s, data.campaignId, data.clientId);
  if (data.projectId) {
    const p = await assertProjectAccess(s, data.projectId);
    if (p.clientId !== data.clientId) throw new ValidationError("O projeto é de outro cliente.");
  }
  const [row] = await s.db
    .insert(contentItems)
    .values({
      organizationId: s.actor.orgId,
      ...data,
      createdByUserId: s.actor.userId,
      updatedByUserId: s.actor.userId,
    })
    .returning({ id: contentItems.id });
  await recordActivity(s, {
    action: "created",
    entityType: "content",
    entityId: row!.id,
    summary: `Conteúdo criado: ${data.title}`,
    event: false,
  });
  return { id: row!.id };
}

export async function updateContent(s: Scope, raw: z.input<typeof contentUpdateInput>) {
  writeAccess(s);
  const data = contentUpdateInput.parse(raw);
  const current = await assertContent(s, data.id);
  if (data.campaignId) await assertCampaign(s, data.campaignId, current.clientId);
  const { id, ...patch } = data;
  await s.db
    .update(contentItems)
    .set({ ...patch, updatedByUserId: s.actor.userId })
    .where(eq(contentItems.id, id));
  await recordActivity(s, {
    action: patch.status ? "status_changed" : "updated",
    entityType: "content",
    entityId: id,
    summary: patch.status ? `Status do conteúdo alterado` : `Conteúdo atualizado: ${current.title}`,
    event: false,
  });
}

export async function deleteContent(s: Scope, id: string) {
  writeAccess(s);
  const current = await assertContent(s, id);
  // Artes, arquivos, tarefa e solicitação continuam existindo: só a peça (e os vínculos) sai.
  await s.db.delete(contentItems).where(eq(contentItems.id, id));
  await recordActivity(s, {
    action: "deleted",
    entityType: "content",
    entityId: id,
    summary: `Conteúdo excluído: ${current.title}`,
    event: false,
  });
}

/* ------------------------------------------------------------------ */
/* Artes no editor atual                                               */
/* ------------------------------------------------------------------ */

type DesignBrand = { font: string; color: string; accent: string };

function uid() {
  return randomUUID().replace(/-/g, "").slice(0, 8);
}

function textbox(
  text: string,
  o: {
    left: number;
    top: number;
    width: number;
    fontSize: number;
    weight: number;
    fill: string;
    font: string;
    name: string;
  },
) {
  return {
    type: "Textbox",
    version: "7.4.0",
    uid: uid(),
    name: o.name,
    text,
    left: o.left,
    top: o.top,
    width: o.width,
    originX: "center",
    originY: "center",
    fontSize: o.fontSize,
    fontWeight: o.weight,
    fontFamily: o.font,
    fill: o.fill,
    textAlign: "center",
    lineHeight: 1.15,
    selectable: true,
    evented: true,
  };
}

/**
 * Documento editável (mesmo formato do editor): imagem de fundo (quando houver),
 * faixa para leitura e textos em camadas separadas. A imagem é referenciada
 * pela rota de arquivos (nada é embutido no documento).
 */
export function buildDesignDocument(
  size: { width: number; height: number },
  texts: { headline: string; body?: string | null; footer?: string | null },
  brand: DesignBrand,
  image?: { versionId: string; width: number; height: number } | null,
) {
  const { width: W, height: H } = size;
  const objects: Record<string, unknown>[] = [];
  if (image) {
    const scale = Math.max(W / image.width, H / image.height);
    objects.push({
      type: "Image",
      version: "7.4.0",
      uid: uid(),
      name: "Imagem gerada por IA",
      src: `/api/files/${image.versionId}`,
      left: W / 2,
      top: H / 2,
      width: image.width,
      height: image.height,
      scaleX: scale,
      scaleY: scale,
      originX: "center",
      originY: "center",
      selectable: true,
      evented: true,
    });
    objects.push({
      type: "Rect",
      version: "7.4.0",
      uid: uid(),
      name: "Faixa de leitura",
      left: W / 2,
      top: H * 0.78,
      width: W,
      height: H * 0.44,
      originX: "center",
      originY: "center",
      fill: "rgba(0,0,0,0.45)",
      selectable: true,
      evented: true,
    });
  }
  const textColor = image ? "#ffffff" : brand.color;
  objects.push(
    textbox(texts.headline, {
      left: W / 2,
      top: image ? H * 0.72 : H * 0.42,
      width: W * 0.82,
      fontSize: Math.round(W * 0.07),
      weight: 700,
      fill: textColor,
      font: brand.font,
      name: "Título",
    }),
  );
  if (texts.body) {
    objects.push(
      textbox(texts.body, {
        left: W / 2,
        top: image ? H * 0.84 : H * 0.58,
        width: W * 0.78,
        fontSize: Math.round(W * 0.038),
        weight: 400,
        fill: textColor,
        font: brand.font,
        name: "Texto",
      }),
    );
  }
  if (texts.footer) {
    objects.push(
      textbox(texts.footer, {
        left: W / 2,
        top: H * 0.93,
        width: W * 0.7,
        fontSize: Math.round(W * 0.03),
        weight: 600,
        fill: image ? "#ffffff" : brand.accent,
        font: brand.font,
        name: "Chamada",
      }),
    );
  }
  return { version: "7.4.0", background: image ? "#111111" : "#ffffff", objects };
}

async function brandForDesign(s: Scope, clientId: string): Promise<DesignBrand> {
  const [b] = await s.db
    .select({ colors: brandProfiles.colors, fonts: brandProfiles.fonts })
    .from(brandProfiles)
    .where(eq(brandProfiles.clientId, clientId));
  return {
    font: b?.fonts?.[0]?.name || "Inter",
    color: b?.colors?.[0]?.hex || "#121110",
    accent: b?.colors?.[1]?.hex || b?.colors?.[0]?.hex || "#121110",
  };
}

async function makeDesign(
  s: Scope,
  o: {
    name: string;
    clientId: string;
    projectId: string | null;
    size: { width: number; height: number };
    document: Record<string, unknown>;
  },
) {
  const { id } = await createDesign(s, {
    name: o.name.slice(0, 120),
    width: o.size.width,
    height: o.size.height,
    clientId: o.clientId,
    projectId: o.projectId,
  });
  await saveDesign(s, { id, revision: 1, document: o.document });
  return id;
}

/* ------------------------------------------------------------------ */
/* Imagem por IA (etapa opcional, antes de confirmar)                  */
/* ------------------------------------------------------------------ */

export const contentImageInput = z.object({
  clientId: z.uuid(),
  prompt: z.string().trim().min(3, "Descreva a imagem.").max(4000),
  orientation: z.enum(["portrait", "square"]).default("portrait"),
  selection: aiSelectionInput.optional(),
  confirmCost: z.boolean().optional(),
});

/**
 * Gera a imagem principal com o provedor configurado e salva em Arquivos (do
 * cliente). Em falha, devolve a mensagem real — nunca uma imagem de exemplo.
 */
export async function generateContentImage(actor: Actor, raw: z.input<typeof contentImageInput>) {
  const data = contentImageInput.parse(raw);
  const prepared = await inOrg(actor, async (s) => {
    writeAccess(s);
    if (!can(s.actor, "files.write"))
      throw new ForbiddenError("Você não tem permissão para salvar imagens em Arquivos.");
    await assertClientAccess(s, data.clientId);
    return prepareImage(s, {
      prompt: data.prompt,
      size: data.orientation === "portrait" ? "1024x1536" : "1024x1024",
      clientId: data.clientId,
      module: "trends",
      selection: data.selection,
      saveToFiles: true,
      confirmCost: data.confirmCost,
    });
  });
  const res = await runImage(actor, prepared);
  if (!res.ok) return { ok: false as const, message: res.message, retryable: res.retryable };
  const file = res.saved.files[0];
  if (!file)
    return {
      ok: false as const,
      message: "A imagem foi gerada, mas não pôde ser salva em Arquivos.",
      retryable: false,
    };
  return {
    ok: true as const,
    fileId: file.fileId,
    versionId: file.versionId,
    model: res.result.model,
    provider: prepared.providerLabel,
  };
}

/* ------------------------------------------------------------------ */
/* Confirmação da cadeia "Criar conteúdo"                              */
/* ------------------------------------------------------------------ */

export const createFromTrendInput = z.object({
  trendId: z.uuid(),
  clientId: z.uuid(),
  analysisId: z.uuid().nullable().optional(),
  campaign: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("none") }),
    z.object({ mode: z.literal("existing"), id: z.uuid() }),
    z.object({
      mode: z.literal("new"),
      name: z.string().trim().min(2).max(160),
      objective: z.string().trim().max(2000).optional(),
    }),
  ]),
  project: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("none") }),
    z.object({ mode: z.literal("existing"), id: z.uuid() }),
    z.object({ mode: z.literal("new"), name: z.string().trim().min(2).max(160) }),
  ]),
  formats: z.array(z.enum(CONTENT_FORMAT_KEYS)).min(1).max(4),
  plannedDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  texts: contentTextInput,
  image: z.object({ fileId: z.uuid() }).nullable().optional(),
  createDesigns: z.boolean().default(true),
  createRequest: z.boolean().default(false),
  createTask: z.boolean().default(false),
  taskDueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
});

/**
 * Cria tudo o que a pessoa revisou e confirmou, numa única transação: campanha
 * e projeto (se novos), uma peça por formato, artes editáveis, briefing e
 * tarefa. Se algo falhar, nada fica pela metade.
 */
export async function createFromTrend(s: Scope, raw: z.input<typeof createFromTrendInput>) {
  writeAccess(s);
  const data = createFromTrendInput.parse(raw);
  await assertClientAccess(s, data.clientId);
  const [trend] = await s.db
    .select({ id: trends.id, title: trends.title, url: trends.url })
    .from(trends)
    .where(eq(trends.id, data.trendId));
  if (!trend) throw new NotFoundError("Tendência não encontrada.");
  if (data.analysisId) {
    const [a] = await s.db
      .select({ trendId: trendAnalyses.trendId, clientId: trendAnalyses.clientId })
      .from(trendAnalyses)
      .where(eq(trendAnalyses.id, data.analysisId));
    if (!a || a.trendId !== data.trendId || (a.clientId && a.clientId !== data.clientId)) {
      throw new ValidationError("A análise informada não corresponde a esta tendência e cliente.");
    }
  }
  if (data.createDesigns) assertCan(s.actor, "designs.write");
  if (data.createRequest) assertCan(s.actor, "requests.write");
  if (data.createTask) {
    assertCan(s.actor, "tasks.write");
    if (data.project.mode === "none")
      throw new ValidationError("Escolha ou crie um projeto para a tarefa.", {
        project: ["Obrigatório para criar a tarefa"],
      });
  }

  let image: { fileId: string; versionId: string; width: number; height: number } | null = null;
  if (data.image) {
    const [f] = await s.db
      .select({
        id: files.id,
        clientId: files.clientId,
        versionId: fileVersions.id,
        width: fileVersions.width,
        height: fileVersions.height,
        mime: fileVersions.mimeType,
      })
      .from(files)
      .innerJoin(fileVersions, eq(fileVersions.id, files.currentVersionId))
      .where(and(eq(files.id, data.image.fileId), isNull(files.deletedAt)));
    if (!f || f.clientId !== data.clientId || !f.mime.startsWith("image/")) {
      throw new ValidationError("A imagem escolhida não é deste cliente.");
    }
    image = { fileId: f.id, versionId: f.versionId, width: f.width ?? 1024, height: f.height ?? 1536 };
  }

  let campaignId: string | null = null;
  if (data.campaign.mode === "existing") {
    await assertCampaign(s, data.campaign.id, data.clientId);
    campaignId = data.campaign.id;
  } else if (data.campaign.mode === "new") {
    campaignId = (
      await createCampaign(s, {
        clientId: data.clientId,
        name: data.campaign.name,
        objective: data.campaign.objective ?? null,
      })
    ).id;
  }

  let projectId: string | null = null;
  if (data.project.mode === "existing") {
    const p = await assertProjectAccess(s, data.project.id);
    if (p.clientId !== data.clientId) throw new ValidationError("O projeto é de outro cliente.");
    projectId = data.project.id;
  } else if (data.project.mode === "new") {
    assertCan(s.actor, "projects.write");
    projectId = (
      await createProject(s, {
        clientId: data.clientId,
        name: data.project.name,
        objective: data.texts.strategy ?? null,
      })
    ).id;
  }

  const t = data.texts;
  let requestId: string | null = null;
  if (data.createRequest) {
    requestId = (
      await createRequest(s, {
        clientId: data.clientId,
        title: t.title,
        category: "social_media",
        objective: t.strategy ?? t.concept ?? null,
        description: [
          t.concept,
          t.visualDirection ? `Direção visual: ${t.visualDirection}` : null,
          `Tendência de origem: ${trend.title}${trend.url ? ` (${trend.url})` : ""}`,
        ]
          .filter(Boolean)
          .join("\n\n"),
        format: data.formats.map((f) => CONTENT_FORMATS[f].label).join(", "),
        copyText: [t.copy, t.caption, t.cta].filter(Boolean).join("\n\n") || null,
        desiredDueDate: data.plannedDate ?? null,
        draft: true,
      })
    ).id;
  }

  let taskId: string | null = null;
  if (data.createTask && projectId) {
    taskId = (
      await createTask(s, {
        projectId,
        title: `Produzir: ${t.title}`.slice(0, 300),
        description: [
          `Peças: ${data.formats.map((f) => CONTENT_FORMATS[f].label).join(", ")}.`,
          t.concept ? `Conceito: ${t.concept}` : null,
          t.visualDirection ? `Direção visual: ${t.visualDirection}` : null,
          `Tendência de origem: ${trend.title}${trend.url ? ` — ${trend.url}` : ""}`,
        ]
          .filter(Boolean)
          .join("\n\n"),
        dueDate: data.taskDueDate ?? data.plannedDate ?? null,
        requestId,
      })
    ).id;
  }

  const brand = data.createDesigns ? await brandForDesign(s, data.clientId) : null;
  const created: { id: string; format: ContentFormat; designs: string[] }[] = [];
  for (const format of data.formats as ContentFormat[]) {
    const [item] = await s.db
      .insert(contentItems)
      .values({
        organizationId: s.actor.orgId,
        clientId: data.clientId,
        campaignId,
        projectId,
        trendId: data.trendId,
        trendAnalysisId: data.analysisId ?? null,
        taskId,
        requestId,
        format,
        status: "draft",
        title: data.formats.length > 1 ? `${t.title} — ${CONTENT_FORMATS[format].label.split(" (")[0]}` : t.title,
        concept: t.concept,
        strategy: t.strategy,
        copy: t.copy,
        caption: t.caption,
        cta: t.cta,
        script: t.script,
        visualDirection: t.visualDirection,
        imagePrompt: t.imagePrompt,
        hashtags: t.hashtags,
        slides: format === "carousel" ? t.slides : [],
        plannedDate: data.plannedDate ?? null,
        createdByUserId: s.actor.userId,
        updatedByUserId: s.actor.userId,
      })
      .returning({ id: contentItems.id });
    const designIds: string[] = [];
    if (brand && format !== "reels") {
      const size = CONTENT_FORMATS[format];
      const pages =
        format === "carousel" && t.slides.length
          ? t.slides.map((sl, i) => ({
              headline: sl.title || t.title,
              body: sl.text,
              footer: i === t.slides.length - 1 ? t.cta : null,
              withImage: i === 0,
            }))
          : [
              {
                headline: t.copy || t.title,
                body: format === "stories" ? t.cta : null,
                footer: format === "stories" ? null : t.cta,
                withImage: true,
              },
            ];
      for (const [i, page] of pages.entries()) {
        const id = await makeDesign(s, {
          name: format === "carousel" ? `${t.title} — página ${i + 1}` : `${t.title} — ${size.label.split(" (")[0]}`,
          clientId: data.clientId,
          projectId,
          size,
          document: buildDesignDocument(size, page, brand, page.withImage ? image : null),
        });
        designIds.push(id);
        await s.db.insert(contentItemAssets).values({
          organizationId: s.actor.orgId,
          contentItemId: item!.id,
          designId: id,
          role: format === "carousel" ? "slide" : format,
          position: i,
        });
      }
    }
    if (image) {
      await s.db.insert(contentItemAssets).values({
        organizationId: s.actor.orgId,
        contentItemId: item!.id,
        fileId: image.fileId,
        role: "image",
        position: 100,
      });
    }
    created.push({ id: item!.id, format, designs: designIds });
  }
  await recordActivity(s, {
    action: "created",
    entityType: "content",
    entityId: created[0]?.id ?? null,
    summary: `Conteúdo criado a partir da tendência "${trend.title}" (${created.length} peça(s))`,
    metadata: { trendId: data.trendId, campaignId, projectId, taskId, requestId },
    event: false,
  });
  return { items: created, campaignId, projectId, taskId, requestId };
}

/** Datas do calendário editorial de um mês (peças com data planejada). */
export async function calendarMonth(s: Scope, month: string, filters: { clientId?: string; campaignId?: string } = {}) {
  readAccess(s);
  if (!/^\d{4}-\d{2}$/.test(month)) throw new ValidationError("Mês inválido.");
  const from = `${month}-01`;
  const [y, m] = month.split("-").map(Number) as [number, number];
  const to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return listContent(s, { ...filters, from, to });
}

/** Clientes e projetos para os formulários (respeitando o escopo). */
export async function contentFormOptions(s: Scope, clientId?: string) {
  readAccess(s);
  const clientRows = await s.db
    .select({ id: clients.id, name: clients.name })
    .from(clients)
    .where(and(clientScope(s.actor), isNull(clients.archivedAt)))
    .orderBy(asc(clients.name))
    .limit(500);
  const projectRows = clientId
    ? await s.db
        .select({ id: projects.id, name: projects.name, clientId: projects.clientId })
        .from(projects)
        .where(
          and(
            eq(projects.clientId, clientId),
            isNull(projects.archivedAt),
            isNull(projects.deletedAt),
            or(isNull(projects.completedAt)),
          ),
        )
        .orderBy(asc(projects.name))
    : [];
  return { clients: clientRows, projects: projectRows };
}
