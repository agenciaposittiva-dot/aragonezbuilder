import { readFileSync } from "node:fs";
import path from "node:path";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/server/authz";
import { withOrg } from "@/server/db";
import { campaigns, contentItemAssets, contentItems, designs, requests, tasks } from "@/server/db/schema";
import { env } from "@/server/env";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { saveProviderKey } from "@/server/services/ai-providers";
import { createClient, updateBrandProfile } from "@/server/services/clients";
import {
  calendarMonth,
  createFromTrend,
  generateContentImage,
  getContent,
  listContent,
  updateContent,
} from "@/server/services/content";
import { createProject } from "@/server/services/projects";
import { listTrends, refreshSources } from "@/server/services/trends";
import { ConnectorError } from "@/server/trends/connectors/types";
import { installAiMock } from "./ai-mocks";
import { addMember, as, createOrgWithOwner, resetDb } from "./helpers";

const fetchText = async (url: string) => {
  if (url.startsWith("https://trends.google.com/")) {
    return readFileSync(path.join(__dirname, "fixtures", "trends", "google-trends-br.xml"), "utf8");
  }
  throw new ConnectorError("A fonte respondeu 404.");
};

const OPENAI = "sk-openai-teste-valida-cont1";
const texts = {
  title: "Café do festival",
  concept: "Conectar a cafeteria ao festival.",
  copy: "O festival chegou",
  caption: "Venha provar a bebida especial.",
  cta: "Passe aqui hoje",
  visualDirection: "Luz quente",
  imagePrompt: "Xícara de café sobre mesa de madeira",
  hashtags: ["#cafe"],
  slides: [
    { title: "Capa", text: "Festival" },
    { title: "Bebida", text: "Especial da semana" },
    { title: "Venha", text: "Centro" },
  ],
};

describe("conteúdo a partir de tendências", () => {
  let ctx: Awaited<ReturnType<typeof createOrgWithOwner>>;
  let other: Awaited<ReturnType<typeof createOrgWithOwner>>;
  let clientId: string;
  let otherClientId: string;
  let trendId: string;
  let mock: ReturnType<typeof installAiMock>;
  const saved = { demo: env.AI_DEFAULT_PROVIDER, openai: env.OPENAI_API_KEY };

  beforeAll(async () => {
    env.AI_DEFAULT_PROVIDER = "openai";
    env.OPENAI_API_KEY = undefined;
    mock = installAiMock();
    mock.state.valid.openai.add(OPENAI);
    await resetDb();
    ctx = await createOrgWithOwner("Agência Conteúdo");
    other = await createOrgWithOwner("Outra Agência");
    clientId = (await as(ctx.actor, (s) => createClient(s, { name: "Cafeteria Aurora" }))).id;
    otherClientId = (await as(ctx.actor, (s) => createClient(s, { name: "Loja Beta" }))).id;
    await as(ctx.actor, (s) =>
      updateBrandProfile(s, {
        clientId,
        colors: [
          { name: "Café", hex: "#4a2c1d" },
          { name: "Creme", hex: "#f3e5d0" },
        ],
        fonts: [{ name: "Poppins", usage: "títulos" }],
      }),
    );
    await refreshSources(ctx.actor, { fetch: fetchText });
    trendId = (await as(ctx.actor, (s) => listTrends(s, { platform: "google_trends" }))).rows[0]!.id;
  });

  afterAll(() => {
    env.AI_DEFAULT_PROVIDER = saved.demo;
    env.OPENAI_API_KEY = saved.openai;
    vi.unstubAllGlobals();
  });

  beforeEach(() => mock.reset());

  it("imagem: falha real do provedor volta como falha (nada é salvo)", async () => {
    expect((await as(ctx.actor, (s) => saveProviderKey(s, "openai", OPENAI))).ok).toBe(true);
    mock.state.failStatus = 500;
    const r = await generateContentImage(ctx.actor, { clientId, prompt: texts.imagePrompt });
    expect(r.ok).toBe(false);
  });

  it("cria peças, artes editáveis, briefing, tarefa e calendário mantendo os vínculos", async () => {
    const img = await generateContentImage(ctx.actor, { clientId, prompt: texts.imagePrompt });
    expect(img.ok).toBe(true);
    if (!img.ok) return;

    const r = await as(ctx.actor, (s) =>
      createFromTrend(s, {
        trendId,
        clientId,
        campaign: { mode: "new", name: "Festival de outubro" },
        project: { mode: "new", name: "Conteúdo do festival" },
        formats: ["feed", "stories", "carousel"],
        plannedDate: "2026-10-28",
        texts,
        image: { fileId: img.fileId },
        createDesigns: true,
        createRequest: true,
        createTask: true,
      }),
    );
    // Carrossel: uma arte só, com uma página por slide.
    expect(r.items.map((i) => [i.format, i.designs.length])).toEqual([
      ["feed", 1],
      ["stories", 1],
      ["carousel", 1],
    ]);
    expect(r.taskId && r.requestId && r.campaignId && r.projectId).toBeTruthy();

    const items = await withOrg(ctx.org.id, (tx) =>
      tx
        .select()
        .from(contentItems)
        .where(
          inArray(
            contentItems.id,
            r.items.map((i) => i.id),
          ),
        ),
    );
    for (const it of items) {
      expect(it).toMatchObject({
        trendId,
        clientId,
        campaignId: r.campaignId,
        projectId: r.projectId,
        taskId: r.taskId,
        requestId: r.requestId,
        plannedDate: "2026-10-28",
        status: "draft",
      });
    }
    expect(items.find((i) => i.format === "carousel")!.slides).toHaveLength(3);
    expect(items.find((i) => i.format === "feed")!.slides).toEqual([]);

    const designIds = r.items.flatMap((i) => i.designs);
    const ds = await withOrg(ctx.org.id, (tx) => tx.select().from(designs).where(inArray(designs.id, designIds)));
    const size = Object.fromEntries(ds.map((d) => [d.id, `${d.width}x${d.height}`]));
    expect(size[r.items[0]!.designs[0]!]).toBe("1080x1350");
    expect(size[r.items[1]!.designs[0]!]).toBe("1080x1920");
    expect(ds.every((d) => d.clientId === clientId && d.projectId === r.projectId)).toBe(true);
    // Documento editável no formato do editor (versão 2): camadas separadas, fonte e cor da marca.
    type Doc = {
      schema: string;
      meta?: { carousel?: boolean };
      pages: {
        width: number;
        height: number;
        objects: { type: string; text?: string; src?: string; fontFamily?: string; x: number; width: number }[];
      }[];
    };
    const feed = ds.find((d) => d.id === r.items[0]!.designs[0])!;
    const doc = feed.document as Doc;
    expect(doc.schema).toBe("aragonez.design/2");
    const objs = doc.pages[0]!.objects;
    expect(objs.find((o) => o.type === "image")?.src).toBe(`/api/files/${img.versionId}`);
    // A imagem cobre a página sem passar das bordas.
    expect(objs.find((o) => o.type === "image")).toMatchObject({ x: 0, width: 1080 });
    expect(objs.filter((o) => o.type === "text").map((o) => o.text)).toContain("O festival chegou");
    expect(objs.find((o) => o.type === "text")?.fontFamily).toBe("Poppins");
    const carouselDoc = ds.find((d) => d.id === r.items[2]!.designs[0])!;
    expect(carouselDoc.name).toBe("Café do festival — carrossel");
    const cdoc = carouselDoc.document as Doc;
    expect(cdoc.meta?.carousel).toBe(true);
    expect(cdoc.pages).toHaveLength(3);
    expect(cdoc.pages.every((p) => p.width === 1080 && p.height === 1350)).toBe(true);

    const assets = await withOrg(ctx.org.id, (tx) =>
      tx.select().from(contentItemAssets).where(eq(contentItemAssets.contentItemId, r.items[2]!.id)),
    );
    expect(assets.filter((a) => a.designId)).toHaveLength(1);
    expect(assets.filter((a) => a.fileId === img.fileId)).toHaveLength(1);

    const [task] = await withOrg(ctx.org.id, (tx) => tx.select().from(tasks).where(eq(tasks.id, r.taskId!)));
    expect(task).toMatchObject({ projectId: r.projectId, requestId: r.requestId });
    expect(task!.description).toContain("Tendência de origem");
    const [req] = await withOrg(ctx.org.id, (tx) => tx.select().from(requests).where(eq(requests.id, r.requestId!)));
    expect(req!.clientId).toBe(clientId);

    const cal = await as(ctx.actor, (s) => calendarMonth(s, "2026-10"));
    expect(cal.map((c) => c.id).sort()).toEqual(r.items.map((i) => i.id).sort());
    expect((await as(ctx.actor, (s) => calendarMonth(s, "2026-11"))).length).toBe(0);

    const detail = await as(ctx.actor, (s) => getContent(s, r.items[0]!.id));
    expect(detail.trendTitle).toBe("Festival de Café Fictício");
    expect(detail.assets.map((a) => a.designId).filter(Boolean)).toEqual(r.items[0]!.designs);
  });

  it("atualização parcial não apaga a data planejada", async () => {
    const [row] = await as(ctx.actor, (s) => listContent(s, { clientId }));
    await as(ctx.actor, (s) => updateContent(s, { id: row!.id, status: "review" }));
    const after = await as(ctx.actor, (s) => getContent(s, row!.id));
    expect(after.item.status).toBe("review");
    expect(after.item.plannedDate).toBe("2026-10-28");
  });

  it("tarefa exige projeto; erro no meio não deixa nada pela metade", async () => {
    await expect(
      as(ctx.actor, (s) =>
        createFromTrend(s, {
          trendId,
          clientId,
          campaign: { mode: "none" },
          project: { mode: "none" },
          formats: ["feed"],
          texts,
          createTask: true,
        }),
      ),
    ).rejects.toBeInstanceOf(ValidationError);

    const foreignProject = await as(ctx.actor, (s) =>
      createProject(s, { clientId: otherClientId, name: "Projeto da Loja" }),
    );
    const before = await withOrg(ctx.org.id, (tx) => tx.select().from(campaigns));
    await expect(
      as(ctx.actor, (s) =>
        createFromTrend(s, {
          trendId,
          clientId,
          campaign: { mode: "new", name: "Não deve existir" },
          project: { mode: "existing", id: foreignProject.id },
          formats: ["feed"],
          texts,
        }),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    const after = await withOrg(ctx.org.id, (tx) => tx.select().from(campaigns));
    expect(after).toHaveLength(before.length);
  });

  it("imagem de outro cliente não pode ser usada", async () => {
    const img = await generateContentImage(ctx.actor, { clientId: otherClientId, prompt: "Vitrine de loja" });
    expect(img.ok).toBe(true);
    if (!img.ok) return;
    await expect(
      as(ctx.actor, (s) =>
        createFromTrend(s, {
          trendId,
          clientId,
          campaign: { mode: "none" },
          project: { mode: "none" },
          formats: ["feed"],
          texts,
          image: { fileId: img.fileId },
        }),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("permissões e isolamento", async () => {
    const designer: Actor = await addMember(ctx.org.slug, ctx.org.id, "designer");
    // Designer cria artes e conteúdo, mas não abre briefing (requests.write).
    await expect(
      as(designer, (s) =>
        createFromTrend(s, {
          trendId,
          clientId,
          campaign: { mode: "none" },
          project: { mode: "none" },
          formats: ["feed"],
          texts,
          createRequest: true,
        }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const ok = await as(designer, (s) =>
      createFromTrend(s, {
        trendId,
        clientId,
        campaign: { mode: "none" },
        project: { mode: "none" },
        formats: ["stories"],
        texts,
      }),
    );
    expect(ok.items[0]!.designs).toHaveLength(1);

    const collaborator = await addMember(ctx.org.slug, ctx.org.id, "collaborator");
    await expect(as(collaborator, (s) => listContent(s, {}))).rejects.toBeInstanceOf(ForbiddenError);

    const portal = await addMember(ctx.org.slug, ctx.org.id, "client", { clientIds: [clientId] });
    await expect(as(portal, (s) => listContent(s, {}))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(as(portal, (s) => getContent(s, ok.items[0]!.id))).rejects.toBeInstanceOf(ForbiddenError);

    expect(await as(other.actor, (s) => listContent(s, {}))).toEqual([]);
    await expect(as(other.actor, (s) => getContent(s, ok.items[0]!.id))).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      as(other.actor, (s) =>
        createFromTrend(s, {
          trendId,
          clientId,
          campaign: { mode: "none" },
          project: { mode: "none" },
          formats: ["feed"],
          texts,
        }),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
