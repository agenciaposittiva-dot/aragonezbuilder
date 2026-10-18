import { eq } from "drizzle-orm";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createDocument, textObject } from "@/lib/design-doc";
import { runPreviewChecks } from "@/lib/preview-check";
import { checkInputOf } from "@/lib/preview-data";
import { resolveActor } from "@/server/authz/actor";
import { withOrg, withSystem } from "@/server/db";
import {
  approvals,
  clientMembers,
  contentItemAssets,
  contentItems,
  designs,
  memberships,
  roles,
} from "@/server/db/schema";
import { env } from "@/server/env";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { updateAiSettings } from "@/server/services/ai";
import { saveProviderKey } from "@/server/services/ai-providers";
import { decideApproval } from "@/server/services/approvals";
import { createClient } from "@/server/services/clients";
import { createContent, getContent } from "@/server/services/content";
import {
  contentsForDesign,
  contentsForFile,
  createConvertedContent,
  duplicateContent,
  getContentPreview,
  getDesignPreview,
  getPortalPreview,
  requestContentApproval,
  savePreviewTarget,
  savePreviewTexts,
} from "@/server/services/content-preview";
import { createDesign } from "@/server/services/designs";
import { storeUpload } from "@/server/services/files";
import {
  automaticConversion,
  PREVIEW_POLICY_MESSAGE,
  reviewPreview,
  convertPreview,
} from "@/server/services/preview-ai";
import { installAiMock } from "./ai-mocks";
import { addMember, as, createOrgWithOwner, createUser, resetDb } from "./helpers";

const png = (c: number) =>
  sharp({ create: { width: 108, height: 135, channels: 3, background: { r: c, g: 120, b: 200 } } })
    .png()
    .toBuffer();

const KEY = "sk-ant-teste-valida-previa1";

describe("central de pré-visualização", () => {
  let ctx: Awaited<ReturnType<typeof createOrgWithOwner>>;
  let clientA: string;
  let clientB: string;
  let contentId: string;
  let designId: string;
  let pageIds: string[];
  let fileIds: string[];

  beforeAll(async () => {
    await resetDb();
    ctx = await createOrgWithOwner("Agência Prévia");
    clientA = (await as(ctx.actor, (s) => createClient(s, { name: "Cafeteria Aurora" }))).id;
    clientB = (await as(ctx.actor, (s) => createClient(s, { name: "Loja Beta" }))).id;
    contentId = (
      await as(ctx.actor, (s) =>
        createContent(s, {
          clientId: clientA,
          title: "Festival do café",
          format: "carousel",
          copy: "O festival chegou",
          caption: "Venha provar a bebida especial. Fica no centro.",
          cta: "Passe aqui hoje",
          hashtags: ["#cafe"],
          slides: [
            { title: "Capa", text: "Festival" },
            { title: "Bebida", text: "Especial" },
          ],
          plannedDate: "2026-10-28",
        }),
      )
    ).id;
    // Carrossel salvo no editor: 3 páginas; a 2ª tem um texto saindo pela borda de baixo.
    const doc = createDocument({
      carousel: true,
      pages: [0, 1, 2].map((i) => ({
        width: 1080,
        height: 1350,
        name: `Slide ${i + 1}`,
        objects: [
          textObject({
            id: `t${i}`,
            text: `Página ${i + 1}`,
            x: 100,
            y: i === 1 ? 1300 : 300,
            width: 600,
            fontSize: 72,
          }),
        ],
      })),
    });
    pageIds = doc.pages.map((p) => p.id);
    designId = (
      await as(ctx.actor, (s) =>
        createDesign(s, {
          name: "Festival — carrossel",
          width: 1080,
          height: 1350,
          clientId: clientA,
          document: doc as unknown as Record<string, unknown>,
        }),
      )
    ).id;
    await withOrg(ctx.org.id, (tx) =>
      tx
        .insert(contentItemAssets)
        .values({ organizationId: ctx.org.id, contentItemId: contentId, designId, role: "carousel", position: 0 }),
    );
    // Exportação para Arquivos (como faz o editor): um arquivo por página, guardado em meta.outputs.
    fileIds = [];
    for (const [i] of pageIds.entries()) {
      const f = await as(ctx.actor, async (s) =>
        storeUpload(
          s,
          { buffer: await png(10 + i * 40), originalName: `festival-${i + 1}.png` },
          { clientId: clientA },
        ),
      );
      fileIds.push(f.fileId);
    }
    await withOrg(ctx.org.id, async (tx) => {
      const [d] = await tx.select().from(designs).where(eq(designs.id, designId));
      const document = d!.document as { meta?: Record<string, unknown> };
      document.meta = { ...document.meta, outputs: Object.fromEntries(pageIds.map((p, i) => [p, fileIds[i]])) };
      await tx.update(designs).set({ document, outputFileId: fileIds[0] }).where(eq(designs.id, designId));
    });
  });

  it("monta a prévia com os dados salvos: páginas, legenda, arquivos e vínculos", async () => {
    const p = await as(ctx.actor, (s) => getContentPreview(s, contentId));
    expect(p.slides.map((s) => s.kind === "page" && s.pageId)).toEqual(pageIds);
    expect(p.slides.map((s) => s.label)).toEqual(["Página 1", "Página 2", "Página 3"]);
    expect(p.content).toMatchObject({
      caption: "Venha provar a bebida especial. Fica no centro.",
      hashtags: ["#cafe"],
      cta: "Passe aqui hoje",
      plannedDate: "2026-10-28",
      network: "instagram",
      placement: null,
    });
    expect(p.client?.name).toBe("Cafeteria Aurora");
    expect(p.designs[0]).toMatchObject({ id: designId, carousel: true });
    expect(p.outputs.map((o) => o.fileId)).toEqual(fileIds);
    expect(p.outputs.every((o) => o.versionNumber === 1 && o.internal === null && o.client === null)).toBe(true);
    expect(p.exports).toEqual({ stale: false, exported: 3, total: 3 });
  });

  it("verificador aponta o texto cortado na página certa, com a camada", async () => {
    const p = await as(ctx.actor, (s) => getContentPreview(s, contentId));
    const issues = runPreviewChecks(checkInputOf(p, { network: "instagram", placement: "carousel" }));
    const cut = issues.find((i) => i.code === "text_cut");
    expect(cut).toMatchObject({ level: "error", slideKey: `${designId}:${pageIds[1]}`, objectId: "t1" });
    // Como feed (uma imagem só), o carrossel vira erro de formato.
    const asFeed = runPreviewChecks(checkInputOf(p, { network: "instagram", placement: "feed_portrait" }));
    expect(asFeed.map((i) => i.code)).toContain("feed_multiple");
  });

  it("edição salva na arte atualiza a prévia (e marca a exportação como desatualizada)", async () => {
    await withOrg(ctx.org.id, async (tx) => {
      const [d] = await tx.select().from(designs).where(eq(designs.id, designId));
      const document = structuredClone(d!.document) as { pages: { objects: { id: string; y: number }[] }[] };
      document.pages[1]!.objects[0]!.y = 400;
      await tx
        .update(designs)
        .set({ document, updatedAt: new Date(Date.now() + 5 * 60_000) })
        .where(eq(designs.id, designId));
    });
    const p = await as(ctx.actor, (s) => getContentPreview(s, contentId));
    const issues = runPreviewChecks(checkInputOf(p, { network: "instagram", placement: "carousel" }));
    expect(issues.map((i) => i.code)).not.toContain("text_cut");
    expect(p.exports?.stale).toBe(true);
    expect(issues.map((i) => i.code)).toContain("export_stale");
  });

  it("salva rede e formato na peça; recusa formato que a rede não tem", async () => {
    await as(ctx.actor, (s) => savePreviewTarget(s, { contentId, network: "facebook", placement: "carousel" }));
    const p = await as(ctx.actor, (s) => getContentPreview(s, contentId));
    expect(p.content).toMatchObject({ network: "facebook", placement: "carousel" });
    await expect(
      as(ctx.actor, (s) => savePreviewTarget(s, { contentId, network: "linkedin", placement: "stories" })),
    ).rejects.toThrow(ValidationError);
  });

  it("legenda revisada na prévia muda só legenda, hashtags e chamada", async () => {
    await as(ctx.actor, (s) =>
      savePreviewTexts(s, { contentId, caption: "Nova legenda.", hashtags: ["#cafe", "#festival"], cta: "Venha" }),
    );
    const c = await as(ctx.actor, (s) => getContent(s, contentId));
    expect(c.item).toMatchObject({ caption: "Nova legenda.", hashtags: ["#cafe", "#festival"], cta: "Venha" });
    expect(c.item.slides).toHaveLength(2);
    expect(c.item.title).toBe("Festival do café");
  });

  it("aprovação usa o fluxo existente: um pedido por página exportada", async () => {
    const r = await as(ctx.actor, (s) =>
      requestContentApproval(s, { contentId, stage: "internal", message: "Revisar" }),
    );
    expect(r).toMatchObject({ requested: 3, failures: [] });
    const rows = await withOrg(ctx.org.id, (tx) => tx.select().from(approvals));
    expect(rows.filter((a) => a.stage === "internal" && a.status === "pending")).toHaveLength(3);
    const c = await as(ctx.actor, (s) => getContent(s, contentId));
    expect(c.item.status).toBe("review");
    // Repetir não duplica pedidos pendentes.
    await expect(as(ctx.actor, (s) => requestContentApproval(s, { contentId, stage: "internal" }))).rejects.toThrow(
      /aguardando/,
    );
    const p = await as(ctx.actor, (s) => getContentPreview(s, contentId));
    expect(p.outputs.every((o) => o.internal === "pending")).toBe(true);
  });

  it("sem exportação, não há o que aprovar", async () => {
    const id = (await as(ctx.actor, (s) => createContent(s, { clientId: clientA, title: "Sem arte" }))).id;
    await expect(as(ctx.actor, (s) => requestContentApproval(s, { contentId: id, stage: "internal" }))).rejects.toThrow(
      /Exporte/,
    );
  });

  it("portal: o cliente só vê a prévia depois do envio, só do próprio cliente, e decide pelo fluxo normal", async () => {
    const approver = await addMember(ctx.org.slug, ctx.org.id, "client_approver", { clientIds: [clientA] });
    const outsider = await addMember(ctx.org.slug, ctx.org.id, "client_approver", { clientIds: [clientB] });
    await expect(as(approver, (s) => getPortalPreview(s, contentId))).rejects.toThrow(NotFoundError);

    // Aprovação interna e envio ao cliente (compartilha os arquivos).
    const pending = await withOrg(ctx.org.id, (tx) => tx.select().from(approvals));
    for (const a of pending) await as(ctx.actor, (s) => decideApproval(s, { approvalId: a.id, decision: "approved" }));
    const sent = await as(ctx.actor, (s) => requestContentApproval(s, { contentId, stage: "client" }));
    expect(sent.requested).toBe(3);

    const view = await as(approver, (s) => getPortalPreview(s, contentId));
    expect(view.slides.map((s) => s.fileId)).toEqual(fileIds);
    expect(view.content).toMatchObject({ caption: "Nova legenda.", network: "facebook", placement: "carousel" });
    expect(Object.keys(view.versions)).toHaveLength(3);
    expect(await as(approver, (s) => contentsForFile(s, fileIds[0]!))).toEqual([
      { id: contentId, title: "Festival do café" },
    ]);

    await expect(as(outsider, (s) => getPortalPreview(s, contentId))).rejects.toThrow(NotFoundError);
    expect(await as(outsider, (s) => contentsForFile(s, fileIds[0]!))).toEqual([]);
    // Cliente não acessa a prévia interna (com camadas e verificação).
    await expect(as(approver, (s) => getContentPreview(s, contentId))).rejects.toThrow(ForbiddenError);
  });

  it("permissões da equipe: sem acesso ao cliente não vê; quem só lê não altera", async () => {
    // Papel sem "todos os dados": só enxerga os clientes de que participa (aqui, o cliente B).
    const u = await createUser("Redatora do cliente B");
    await withSystem(async (tx) => {
      const [role] = await tx
        .insert(roles)
        .values({
          organizationId: ctx.org.id,
          key: "redacao_restrita",
          name: "Redação restrita",
          kind: "internal",
          permissions: ["clients.read", "files.read", "designs.read", "designs.write", "content.read", "content.write"],
        })
        .returning();
      const [m] = await tx
        .insert(memberships)
        .values({ organizationId: ctx.org.id, userId: u.id, roleId: role!.id })
        .returning();
      await tx.insert(clientMembers).values({ organizationId: ctx.org.id, clientId: clientB, membershipId: m!.id });
    });
    const limited = (await resolveActor(u.id, ctx.org.slug))!;
    expect(limited.dataAll).toBe(false);
    await expect(as(limited, (s) => getContentPreview(s, contentId))).rejects.toThrow(NotFoundError);
    await expect(
      as(limited, (s) => savePreviewTarget(s, { contentId, network: "instagram", placement: "feed_square" })),
    ).rejects.toThrow(NotFoundError);
    expect(await as(limited, (s) => contentsForDesign(s, designId))).toEqual([]);
    expect(await as(limited, (s) => contentsForFile(s, fileIds[0]!))).toEqual([]);
    const finance = await addMember(ctx.org.slug, ctx.org.id, "finance");
    await expect(
      as(finance, (s) => savePreviewTarget(s, { contentId, network: "instagram", placement: "feed_portrait" })),
    ).rejects.toThrow(ForbiddenError);
    await expect(as(finance, (s) => duplicateContent(s, contentId))).rejects.toThrow(ForbiddenError);
  });

  it("duplicar cria uma peça em rascunho com arte própria; a original fica igual", async () => {
    const before = await as(ctx.actor, (s) => getContent(s, contentId));
    const { id } = await as(ctx.actor, (s) => duplicateContent(s, contentId));
    const copy = await as(ctx.actor, (s) => getContent(s, id));
    expect(copy.item).toMatchObject({ status: "draft", caption: before.item.caption, network: "facebook" });
    expect(copy.item.title).toMatch(/cópia/);
    const copyDesign = copy.assets.find((a) => a.designId)!.designId;
    expect(copyDesign).not.toBe(designId);
    const after = await as(ctx.actor, (s) => getContent(s, contentId));
    expect(after.item).toEqual(before.item);
    expect(after.assets.map((a) => a.designId)).toEqual([designId]);
  });

  it("conversão: rascunho automático e nova versão editável, preservando a original", async () => {
    const before = await as(ctx.actor, (s) => getContent(s, contentId));
    const draft = await as(ctx.actor, (s) => automaticConversion(s, { contentId, target: "stories" }));
    expect(draft.slides.length).toBeGreaterThan(1);
    const r = await as(ctx.actor, (s) =>
      createConvertedContent(s, { ...draft, title: "Festival — Stories", contentId, target: "stories" }),
    );
    const created = await as(ctx.actor, (s) => getContentPreview(s, r.id));
    expect(created.content).toMatchObject({ format: "stories", status: "draft", placement: "stories" });
    expect(created.slides).toHaveLength(draft.slides.length);
    expect(created.slides.every((s) => s.width === 1080 && s.height === 1920)).toBe(true);
    const after = await as(ctx.actor, (s) => getContent(s, contentId));
    expect(after.item).toEqual(before.item);
    expect(after.assets).toEqual(before.assets);
    const [row] = await withOrg(ctx.org.id, (tx) => tx.select().from(contentItems).where(eq(contentItems.id, r.id)));
    expect(row?.clientId).toBe(clientA);
  });

  it("prévia da arte avulsa (sem peça) não tem legenda", async () => {
    const lone = await as(ctx.actor, (s) => createDesign(s, { name: "Avulsa", width: 1080, height: 1080 }));
    const p = await as(ctx.actor, (s) => getDesignPreview(s, lone.id));
    expect(p).toMatchObject({ source: "design", content: null });
    expect(p.slides).toHaveLength(1);
    expect(await as(ctx.actor, (s) => contentsForDesign(s, designId))).toEqual([
      { id: contentId, title: "Festival do café" },
    ]);
  });

  describe("IA (só sugestões)", () => {
    let mock: ReturnType<typeof installAiMock>;
    const saved = { provider: env.AI_DEFAULT_PROVIDER, key: env.ANTHROPIC_API_KEY };
    const policy = { enabled: true, monthlyTokenLimit: 0, userDailyRequestLimit: 0 };

    beforeAll(() => {
      mock = installAiMock();
      mock.state.valid.anthropic.add(KEY);
    });
    beforeEach(() => mock.reset());
    afterAll(() => {
      env.AI_DEFAULT_PROVIDER = saved.provider;
      env.ANTHROPIC_API_KEY = saved.key;
      vi.unstubAllGlobals();
    });

    it("modo demonstração: revisão e conversão locais, sem alterar a peça", async () => {
      env.AI_DEFAULT_PROVIDER = "demo";
      const before = await as(ctx.actor, (s) => getContent(s, contentId));
      const r = await reviewPreview(ctx.actor, { contentId, network: "instagram", placement: "carousel" });
      expect(r.demo).toBe(true);
      expect(r.review.suggestions.length).toBeGreaterThan(0);
      expect(r.review.caption).toMatch(/Exemplo da demonstração/);
      const c = await convertPreview(ctx.actor, { contentId, target: "carousel" });
      expect(c.proposal.slides.length).toBeGreaterThan(1);
      const after = await as(ctx.actor, (s) => getContent(s, contentId));
      expect(after.item).toEqual(before.item);
      expect(mock.generationCalls()).toHaveLength(0);
    });

    it("provedor real: sem autorização da organização nada é enviado; com ela, a resposta é validada", async () => {
      env.AI_DEFAULT_PROVIDER = "anthropic";
      env.ANTHROPIC_API_KEY = undefined;
      expect((await as(ctx.actor, (s) => saveProviderKey(s, "anthropic", KEY))).ok).toBe(true);
      await as(ctx.actor, (s) => updateAiSettings(s, { ...policy, allowClientContext: false }));
      await expect(
        reviewPreview(ctx.actor, { contentId, network: "instagram", placement: "carousel" }),
      ).rejects.toThrow(PREVIEW_POLICY_MESSAGE);
      expect(mock.generationCalls()).toHaveLength(0);

      await as(ctx.actor, (s) => updateAiSettings(s, { ...policy, allowClientContext: true }));
      mock.state.reply = JSON.stringify({
        summary: "Boa hierarquia.",
        suggestions: [
          { area: "legenda", page: "Página 9", text: "Comece pela oferta." },
          { area: "hierarquia", page: "Página 2", text: "Aumente o título." },
        ],
        caption: "Legenda sugerida.",
      });
      const r = await reviewPreview(ctx.actor, { contentId, network: "instagram", placement: "carousel" });
      expect(r.demo).toBe(false);
      // Página inexistente não vira link.
      expect(r.review.suggestions.map((s) => s.page)).toEqual([null, "Página 2"]);
      const body = JSON.stringify(mock.generationCalls()[0]?.body ?? {});
      expect(body).toContain("Nova legenda.");
      expect(body).toContain("Verificação automática");

      mock.state.reply = "isto não é JSON";
      await expect(
        reviewPreview(ctx.actor, { contentId, network: "instagram", placement: "carousel" }),
      ).rejects.toThrow(/formato esperado/);
    });
  });
});
