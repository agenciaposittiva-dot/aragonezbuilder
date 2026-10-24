import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { chosenAngle, MACHINE_STEPS } from "@/lib/content-machine";
import { readDesignDocument } from "@/lib/design-doc";
import { withSystem } from "@/server/db";
import {
  contentItemAssets,
  contentItems,
  designs,
  tasks,
  trendObservations,
  trends,
  trendSources,
} from "@/server/db/schema";
import { env } from "@/server/env";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { updateAiSettings } from "@/server/services/ai";
import { generateCarousel } from "@/server/services/carousel-generator";
import { createClient, updateBrandProfile } from "@/server/services/clients";
import {
  carouselRequest,
  createMachineProject,
  createMachineTask,
  extractArticle,
  finishMachineGeneration,
  generateAngles,
  getMachineProject,
  listMachineProjects,
  planMachineContent,
  researchOpportunity,
  saveMachineProject,
  setLinkSource,
  setTrendSource,
  startMachineGeneration,
} from "@/server/services/content-machine";
import { createProject } from "@/server/services/projects";
import { addMember, as, createOrgWithOwner, resetDb } from "./helpers";

/*
 * Máquina de Conteúdo pelo serviço (provedor de demonstração): projeto salvo e
 * recuperável com controle de revisão, fontes (ideia, link, Radar), evidência
 * real × hipótese, ângulos, pedido ao gerador de carrosséis, ligação arte +
 * peça sem duplicar, calendário, tarefa e isolamento entre agências e clientes.
 */

type Ctx = Awaited<ReturnType<typeof createOrgWithOwner>>;
const policy = { enabled: true, monthlyTokenLimit: 0, userDailyRequestLimit: 0 };

describe("Máquina de Conteúdo", () => {
  let a: Ctx;
  let b: Ctx;
  let clientId: string;
  let otherClientId: string;
  let trendId: string;
  let bareTrendId: string;

  beforeAll(async () => {
    env.AI_DEFAULT_PROVIDER = "demo";
    await resetDb();
    a = await createOrgWithOwner("Agência Máquina");
    b = await createOrgWithOwner("Outra Agência");
    await as(a.actor, (s) => updateAiSettings(s, { ...policy, allowClientContext: true }));
    clientId = (await as(a.actor, (s) => createClient(s, { name: "Café Serra", industry: "Cafeteria" }))).id;
    otherClientId = (await as(a.actor, (s) => createClient(s, { name: "Loja Norte" }))).id;
    await as(a.actor, (s) =>
      updateBrandProfile(s, {
        clientId,
        positioning: "Café especial de origem, torra fresca",
        audience: "Adultos que gostam de café de qualidade",
        toneOfVoice: "Próximo e descontraído",
        colors: [{ name: "Principal", hex: "#5B3A29" }],
      }),
    );
    // Tema do Radar com observação real e outro sem observações.
    await withSystem(async (tx) => {
      const [src] = await tx
        .insert(trendSources)
        .values({ organizationId: a.org.id, kind: "rss", key: "rss:teste", name: "Portal Café Notícias" })
        .returning();
      const [t] = await tx
        .insert(trends)
        .values({
          organizationId: a.org.id,
          sourceId: src!.id,
          externalId: "cafe-1",
          title: "Safra de café 2026 bate recorde",
          summary: "Produção chegou a 70 milhões de sacas segundo a fonte.",
          url: "https://exemplo.com/safra",
          platform: "news",
        })
        .returning();
      trendId = t!.id;
      await tx
        .insert(trendObservations)
        .values({ organizationId: a.org.id, trendId, observedOn: "2026-10-20", rank: 3, metrics: [] });
      const [bare] = await tx
        .insert(trends)
        .values({
          organizationId: a.org.id,
          sourceId: src!.id,
          externalId: "cafe-2",
          title: "Cafés gelados no verão",
          platform: "news",
        })
        .returning();
      bareTrendId = bare!.id;
    });
  });

  it("projeto: criado com o cliente, listado, recuperado e salvo com controle de revisão", async () => {
    const { id } = await as(a.actor, (s) => createMachineProject(s, { clientId }));
    const view = await as(a.actor, (s) => getMachineProject(s, id));
    expect(view.project).toMatchObject({ clientId, step: 2, revision: 1, status: "draft" });
    expect(view.brand.provisional).toBe(false);
    expect(view.reachable).toBe(2);
    expect(MACHINE_STEPS).toHaveLength(9);

    const state = { ...view.state, source: { ...sourceIdea("Como escolher grãos de café") } };
    const saved = await as(a.actor, (s) => saveMachineProject(s, { id, revision: 1, step: 3, state }));
    expect(saved.revision).toBe(2);
    expect(saved.step).toBe(3);
    // Outra aba com a revisão antiga não sobrescreve.
    await expect(as(a.actor, (s) => saveMachineProject(s, { id, revision: 1, state }))).rejects.toBeInstanceOf(
      ConflictError,
    );
    // Não dá para pular etapas sem as decisões anteriores (sem ângulo, no máximo a etapa 3).
    const jump = await as(a.actor, (s) => saveMachineProject(s, { id, revision: 2, step: 9, state }));
    expect(jump.step).toBe(3);

    const list = await as(a.actor, (s) => listMachineProjects(s, { clientId }));
    expect(list.map((p) => p.id)).toContain(id);
  });

  it("trocar de cliente antes de gerar descarta ângulos e oportunidade da marca anterior", async () => {
    const { id } = await as(a.actor, (s) => createMachineProject(s, { clientId }));
    let view = await as(a.actor, (s) => getMachineProject(s, id));
    await as(a.actor, (s) =>
      saveMachineProject(s, {
        id,
        revision: view.project.revision,
        state: { ...view.state, source: sourceIdea("Pão de queijo") },
      }),
    );
    await generateAngles(a.actor, { id });
    view = await as(a.actor, (s) => getMachineProject(s, id));
    expect(view.state.angles.length).toBeGreaterThan(0);
    const res = await as(a.actor, (s) =>
      saveMachineProject(s, { id, revision: view.project.revision, clientId: otherClientId, state: view.state }),
    );
    expect(res.clientId).toBe(otherClientId);
    expect(res.state.angles).toEqual([]);
    expect(res.state.opportunity).toBeNull();
    expect(res.state.source?.text).toBe("Pão de queijo");
  });

  it("evidência: tema do Radar com observação = em alta; ideia própria = hipótese; fonte e data vêm dos dados", async () => {
    const { id } = await as(a.actor, (s) => createMachineProject(s, { clientId, trendId }));
    let view = await as(a.actor, (s) => getMachineProject(s, id));
    expect(view.state.source).toMatchObject({ kind: "trend", trendId, url: "https://exemplo.com/safra" });
    const r = await researchOpportunity(a.actor, { id });
    expect(r.opportunity.evidence).toBe("trending");
    expect(r.opportunity.evidenceNote).toMatch(/2026-10-20.*posição 3/);
    expect(r.opportunity.sourceName).toBe("Portal Café Notícias");
    expect(r.opportunity.sourceUrl).toBe("https://exemplo.com/safra");
    expect(r.opportunity.demo).toBe(true);

    // Tema do Radar sem observações e ideia própria: hipótese editorial.
    await as(a.actor, (s) => setTrendSource(s, { id, trendId: bareTrendId }));
    expect((await researchOpportunity(a.actor, { id })).opportunity.evidence).toBe("hypothesis");
    view = await as(a.actor, (s) => getMachineProject(s, id));
    await as(a.actor, (s) =>
      saveMachineProject(s, {
        id,
        revision: view.project.revision,
        state: { ...view.state, source: sourceIdea("Café e produtividade") },
      }),
    );
    const idea = await researchOpportunity(a.actor, { id });
    expect(idea.opportunity.evidence).toBe("hypothesis");
    expect(idea.opportunity.evidenceNote).toMatch(/hipótese editorial/);
  });

  it("link: só endereços públicos; texto público da página extraído com título, site e data", async () => {
    const { id } = await as(a.actor, (s) => createMachineProject(s, { clientId }));
    await expect(as(a.actor, (s) => setLinkSource(s, { id, url: "http://127.0.0.1/admin" }))).rejects.toBeInstanceOf(
      ValidationError,
    );
    const html = `<html><head><title>Título simples</title>
      <meta property="og:title" content="Como a torra muda o sabor &amp; o aroma">
      <meta property="og:site_name" content="Revista do Café">
      <meta property="article:published_time" content="2026-10-15T09:00:00Z">
      <script>var segredo = 1;</script><style>p{}</style></head>
      <body><nav><p>Menu com links que não devem entrar no texto extraído.</p></nav>
      <article><h2>A torra define o perfil sensorial do café que chega à xícara.</h2>
      <p>Torras claras preservam acidez e notas frutadas, enquanto torras escuras trazem amargor.</p>
      <p>curto</p></article><footer><p>Rodapé com direitos reservados e contato da revista.</p></footer></body></html>`;
    const art = extractArticle(html);
    expect(art.title).toBe("Como a torra muda o sabor & o aroma");
    expect(art.siteName).toBe("Revista do Café");
    expect(art.publishedAt).toBe("2026-10-15T09:00:00.000Z");
    expect(art.text).toContain("Torras claras preservam acidez");
    expect(art.text).not.toMatch(/Menu com links|Rodapé|segredo|curto/);
  });

  it("ângulos: cinco abordagens; pedir mais acrescenta outras sem repetir os tipos", async () => {
    const { id } = await as(a.actor, (s) => createMachineProject(s, { clientId }));
    const view = await as(a.actor, (s) => getMachineProject(s, id));
    await as(a.actor, (s) =>
      saveMachineProject(s, {
        id,
        revision: view.project.revision,
        state: { ...view.state, source: sourceIdea("Métodos de preparo") },
      }),
    );
    const first = await generateAngles(a.actor, { id });
    expect(first.angles).toHaveLength(5);
    for (const x of first.angles) expect(x.hook && x.idea && x.cta).toBeTruthy();
    const more = await generateAngles(a.actor, { id, more: true });
    expect(more.angles.length).toBeGreaterThan(5);
    const firstTypes = new Set(first.angles.map((x) => x.type));
    expect(more.angles.slice(5).every((x) => !firstTypes.has(x.type))).toBe(true);
  });

  it("geração: pedido ao gerador com o ângulo e a fonte; arte + peça ligadas; regerar troca o vínculo sem duplicar", async () => {
    const { id } = await as(a.actor, (s) => createMachineProject(s, { clientId, trendId }));
    await generateAngles(a.actor, { id });
    let view = await as(a.actor, (s) => getMachineProject(s, id));
    const angle = view.state.angles[1]!;
    const saved = await as(a.actor, (s) =>
      saveMachineProject(s, {
        id,
        revision: view.project.revision,
        step: 5,
        state: { ...view.state, angleId: angle.id, slides: 6, images: "none", objective: "authority" },
      }),
    );
    expect(chosenAngle(saved.state)?.id).toBe(angle.id);

    const req = carouselRequest({ title: "Safra", clientId }, saved.state);
    expect(req.topic).toBe(angle.hook);
    expect(req.references).toContain("Direção editorial escolhida (não são dados)");
    // O número da fonte real entra como referência (pode virar dado); o resumo da IA não.
    expect(req.references).toContain("70 milhões de sacas");
    expect(req.slides).toBe(6);

    const { request } = await as(a.actor, (s) => startMachineGeneration(s, id));
    const gen = await generateCarousel(a.actor, request);
    expect(gen.ok).toBe(true);
    const designId = (gen as { designId: string }).designId;
    const linked = await as(a.actor, (s) => finishMachineGeneration(s, id, designId));
    view = await as(a.actor, (s) => getMachineProject(s, id));
    expect(view.project).toMatchObject({ status: "ready", step: 6 });
    expect(view.design?.id).toBe(designId);
    expect(view.reachable).toBe(9);
    const [item] = await withSystem((tx) =>
      tx.select().from(contentItems).where(eq(contentItems.id, linked.contentItemId)),
    );
    expect(item).toMatchObject({ clientId, format: "carousel", status: "draft", trendId });
    expect(item!.strategy).toMatch(/Evidência|Ângulo/);
    expect(item!.slides.length).toBe(6);
    const assets = await withSystem((tx) =>
      tx.select().from(contentItemAssets).where(eq(contentItemAssets.contentItemId, linked.contentItemId)),
    );
    expect(assets).toEqual([expect.objectContaining({ designId, role: "carousel" })]);
    const [d] = await withSystem((tx) => tx.select().from(designs).where(eq(designs.id, designId)));
    expect(readDesignDocument(d!.document, d!).doc.pages).toHaveLength(6);

    // Regerar: mesma peça, arte nova ligada, a anterior continua no Estúdio.
    const again = await generateCarousel(a.actor, (await as(a.actor, (s) => startMachineGeneration(s, id))).request);
    const newDesign = (again as { designId: string }).designId;
    const relinked = await as(a.actor, (s) => finishMachineGeneration(s, id, newDesign));
    expect(relinked.contentItemId).toBe(linked.contentItemId);
    const assets2 = await withSystem((tx) =>
      tx.select().from(contentItemAssets).where(eq(contentItemAssets.contentItemId, linked.contentItemId)),
    );
    expect(assets2.map((x) => x.designId)).toEqual([newDesign]);
    const [old] = await withSystem((tx) =>
      tx.select({ deletedAt: designs.deletedAt }).from(designs).where(eq(designs.id, designId)),
    );
    expect(old?.deletedAt).toBeNull();

    // Calendário e tarefa usam a mesma peça.
    await as(a.actor, (s) => planMachineContent(s, { id, plannedDate: "2026-11-05" }));
    const project = await as(a.actor, (s) => createProject(s, { clientId, name: "Conteúdo de novembro" }));
    const { taskId } = await as(a.actor, (s) =>
      createMachineTask(s, { id, projectId: project.id, dueDate: "2026-11-03" }),
    );
    const [planned] = await withSystem((tx) =>
      tx.select().from(contentItems).where(eq(contentItems.id, linked.contentItemId)),
    );
    expect(planned).toMatchObject({ plannedDate: "2026-11-05", taskId, projectId: project.id });
    const [task] = await withSystem((tx) => tx.select().from(tasks).where(eq(tasks.id, taskId)));
    expect(task?.title).toMatch(/^Revisar e publicar/);
    await expect(as(a.actor, (s) => createMachineTask(s, { id, projectId: project.id }))).rejects.toThrow(
      /já tem uma tarefa/,
    );
  });

  it("isolamento e permissões: outra agência e pessoa sem acesso a conteúdos não veem; sem escrita não cria", async () => {
    const { id } = await as(a.actor, (s) => createMachineProject(s, { clientId }));
    await expect(as(b.actor, (s) => getMachineProject(s, id))).rejects.toBeInstanceOf(NotFoundError);
    await expect(as(b.actor, (s) => createMachineProject(s, { clientId }))).rejects.toThrow();
    // Colaborador (só projetos atribuídos, sem acesso a conteúdos): não lista nem abre projetos da Máquina.
    const collaborator = await addMember(a.org.slug, a.org.id, "collaborator");
    await expect(as(collaborator, (s) => listMachineProjects(s, {}))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(as(collaborator, (s) => getMachineProject(s, id))).rejects.toBeInstanceOf(ForbiddenError);
    const finance = await addMember(a.org.slug, a.org.id, "finance");
    await expect(as(finance, (s) => createMachineProject(s, { clientId }))).rejects.toBeInstanceOf(ForbiddenError);
  });
});

function sourceIdea(text: string) {
  return {
    kind: "idea" as const,
    text,
    title: text,
    url: null,
    siteName: null,
    trendId: null,
    fileId: null,
    publishedAt: null,
    collectedAt: null,
  };
}
