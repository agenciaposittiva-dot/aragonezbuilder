import { eq } from "drizzle-orm";
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import {
  DESIGN_SCHEMA,
  fileSrc,
  imageObject,
  readDesignDocument,
  textObject,
  type DesignDocument,
} from "@/lib/design-doc";
import type { Actor } from "@/server/authz/actor";
import { withSystem } from "@/server/db";
import { designs } from "@/server/db/schema";
import { ConflictError, ValidationError } from "@/server/errors";
import { createClient } from "@/server/services/clients";
import { compareDesignVersions, listDesignVersions } from "@/server/services/design-versions";
import {
  applyDesignOperations,
  createDesign,
  duplicateDesign,
  getDesign,
  saveDesign,
  templatePagesForDesign,
} from "@/server/services/designs";
import { storeUpload } from "@/server/services/files";
import { addMember, as, createOrgWithOwner, resetDb } from "./helpers";

/*
 * Servidor do editor: criação no formato 2 (com páginas e carrossel),
 * validação ao salvar, conversão de artes antigas sem perder o original e o
 * lote de operações com controle de revisão (base do chat de edição por IA).
 */

type Ctx = Awaited<ReturnType<typeof createOrgWithOwner>>;

const png = (w = 40, h = 30) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r: 30, g: 120, b: 200 } } })
    .png()
    .toBuffer();

const LEGACY = {
  version: "7.4.0",
  background: "#ffffff",
  objects: [
    {
      type: "Textbox",
      uid: "ttl1",
      name: "Título",
      text: "Antigo",
      left: 540,
      top: 300,
      width: 800,
      height: 80,
      fontSize: 70,
      originX: "center",
      originY: "center",
    },
    {
      type: "Rect",
      uid: "box1",
      name: "Faixa",
      left: 540,
      top: 900,
      width: 1080,
      height: 200,
      fill: "#F4BF2F",
      originX: "center",
      originY: "center",
    },
  ],
};

const docOf = async (actor: Actor, id: string) =>
  (await as(actor, (s) => getDesign(s, id))).design.document as unknown as DesignDocument;

describe("servidor do editor", () => {
  let a: Ctx;
  let clientA: string;
  let clientB: string;
  let viewer: Actor;

  beforeAll(async () => {
    await resetDb();
    a = await createOrgWithOwner("Agência Editor");
    clientA = (await as(a.actor, (s) => createClient(s, { name: "Alfa" }))).id;
    clientB = (await as(a.actor, (s) => createClient(s, { name: "Beta" }))).id;
    viewer = await addMember(a.org.slug, a.org.id, "finance");
  });

  it("cria artes no formato 2: formato simples, carrossel com páginas conectadas e documento pronto", async () => {
    const one = await as(a.actor, (s) =>
      createDesign(s, { name: "Post", width: 1080, height: 1350, preset: "ig-portrait" }),
    );
    const d1 = await docOf(a.actor, one.id);
    expect(d1).toMatchObject({ schema: DESIGN_SCHEMA, meta: { preset: "ig-portrait" } });
    expect(d1.pages).toHaveLength(1);

    const car = await as(a.actor, (s) =>
      createDesign(s, { name: "Carrossel", width: 1080, height: 1080, preset: "carousel-square", pages: 5 }),
    );
    const d2 = await docOf(a.actor, car.id);
    expect(d2.meta?.carousel).toBe(true);
    expect(d2.pages.map((p) => [p.name, p.width, p.height])).toEqual(
      [1, 2, 3, 4, 5].map((n) => [`Página ${n}`, 1080, 1080]),
    );

    // Outros módulos (ex.: tendências → conteúdo) podem mandar o documento pronto.
    const ready = await as(a.actor, (s) =>
      createDesign(s, {
        name: "Gerada",
        width: 100,
        height: 100,
        clientId: clientA,
        document: {
          schema: DESIGN_SCHEMA,
          pages: [
            {
              id: "s1",
              name: "Capa",
              width: 1080,
              height: 1920,
              background: "#000",
              objects: [textObject({ id: "h1", text: "Oi", width: 600 })],
            },
          ],
          components: [],
        },
      }),
    );
    const row = (await as(a.actor, (s) => getDesign(s, ready.id))).design;
    expect([row.width, row.height]).toEqual([1080, 1920]);
    await expect(
      as(a.actor, (s) =>
        createDesign(s, { name: "Ruim", width: 100, height: 100, document: { schema: DESIGN_SCHEMA, pages: [] } }),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("salvar valida o formato 2 e atualiza o tamanho da arte pela primeira página", async () => {
    const { id } = await as(a.actor, (s) => createDesign(s, { name: "Validação", width: 1080, height: 1080 }));
    const doc = await docOf(a.actor, id);
    const bigger: DesignDocument = { ...doc, pages: [{ ...doc.pages[0]!, height: 1350 }] };
    const r = await as(a.actor, (s) =>
      saveDesign(s, { id, revision: 1, document: bigger as unknown as Record<string, unknown> }),
    );
    expect((await as(a.actor, (s) => getDesign(s, id))).design.height).toBe(1350);
    const broken = { ...bigger, pages: [{ ...bigger.pages[0]!, objects: [{ id: "x", type: "rect" }] }] };
    await expect(as(a.actor, (s) => saveDesign(s, { id, revision: r.revision, document: broken }))).rejects.toThrow(
      /dados inválidos/,
    );
  });

  it("arte antiga abre convertida e, na primeira gravação nova, o original fica no histórico", async () => {
    const { id } = await as(a.actor, (s) => createDesign(s, { name: "Antiga", width: 1080, height: 1080 }));
    // Como o editor antigo (e outros módulos) gravavam.
    await withSystem((tx) => tx.update(designs).set({ document: LEGACY }).where(eq(designs.id, id)));
    const d = (await as(a.actor, (s) => getDesign(s, id))).design;
    const { doc, source } = readDesignDocument(d.document, d);
    expect(source).toBe("fabric");
    expect(doc.pages[0]!.objects.map((o) => o.id)).toEqual(["ttl1", "box1"]);

    const next = { ...doc, pages: [{ ...doc.pages[0]!, name: "Capa" }] };
    await as(a.actor, (s) =>
      saveDesign(s, { id, revision: d.revision, document: next as unknown as Record<string, unknown> }),
    );
    const versions = await as(a.actor, (s) => listDesignVersions(s, id));
    const kept = versions.find((v) => v.label === "Formato anterior (antes do novo editor)");
    expect(kept?.kind).toBe("named");
    // Comparar a versão antiga (formato Fabric) com a atual (formato 2): os mesmos ids casam.
    const cmp = await as(a.actor, (s) => compareDesignVersions(s, kept!.id, "current"));
    expect(cmp).toMatchObject({ added: [], removed: [], textChanged: [] });
  });

  it("lote de operações: prévia, aplicação com versão anterior, conflito de revisão e diffs legíveis", async () => {
    const { id } = await as(a.actor, (s) =>
      createDesign(s, { name: "Chat", width: 1080, height: 1080, clientId: clientA }),
    );
    let doc = await docOf(a.actor, id);
    const pageId = doc.pages[0]!.id;
    const add = await as(a.actor, (s) =>
      applyDesignOperations(s, {
        designId: id,
        revision: 1,
        ops: [{ op: "add", pageId, object: textObject({ id: "t1", name: "Título", text: "Promoçao", width: 800 }) }],
      }),
    );
    expect(add).toMatchObject({ saved: true, revision: 2 });

    const preview = await as(a.actor, (s) =>
      applyDesignOperations(s, {
        designId: id,
        revision: 2,
        ops: [{ op: "setText", id: "t1", text: "Promoção" }],
        dryRun: true,
      }),
    );
    expect(preview.saved).toBe(false);
    expect(preview.diffs[0]!.summary).toBe("Título “Promoçao”: texto “Promoçao” → “Promoção”");
    expect(preview.inverse).toEqual([expect.objectContaining({ op: "replace", id: "t1" })]);
    doc = await docOf(a.actor, id);
    expect(doc.pages[0]!.objects[0]).toMatchObject({ text: "Promoçao" });

    const applied = await as(a.actor, (s) =>
      applyDesignOperations(s, {
        designId: id,
        revision: 2,
        ops: [{ op: "setText", id: "t1", text: "Promoção" }],
        checkpointLabel: "Antes da edição pelo chat",
      }),
    );
    expect(applied.revision).toBe(3);
    expect(
      (await as(a.actor, (s) => listDesignVersions(s, id))).some((v) => v.label === "Antes da edição pelo chat"),
    ).toBe(true);

    // Revisão velha: nada é aplicado.
    await expect(
      as(a.actor, (s) =>
        applyDesignOperations(s, { designId: id, revision: 2, ops: [{ op: "setText", id: "t1", text: "X" }] }),
      ),
    ).rejects.toBeInstanceOf(ConflictError);
    // Operação inválida: erro legível, nada muda.
    await expect(
      as(a.actor, (s) =>
        applyDesignOperations(s, { designId: id, revision: 3, ops: [{ op: "setText", id: "naoexiste", text: "X" }] }),
      ),
    ).rejects.toThrow(/não encontrado/);
    // Desfazer pelo servidor com a inversa devolvida.
    await as(a.actor, (s) => applyDesignOperations(s, { designId: id, revision: 3, ops: applied.inverse }));
    expect((await docOf(a.actor, id)).pages[0]!.objects[0]).toMatchObject({ text: "Promoçao" });
    // Sem permissão de escrita: negado.
    await expect(
      as(viewer, (s) =>
        applyDesignOperations(s, { designId: id, revision: 4, ops: [{ op: "setText", id: "t1", text: "X" }] }),
      ),
    ).rejects.toThrow();
  });

  it("imagens nas operações: só arquivos acessíveis e do mesmo cliente", async () => {
    const { id } = await as(a.actor, (s) =>
      createDesign(s, { name: "Imagens", width: 1080, height: 1080, clientId: clientA }),
    );
    const pageId = (await docOf(a.actor, id)).pages[0]!.id;
    const own = await as(a.actor, async (s) =>
      storeUpload(s, { buffer: await png(), originalName: "a.png" }, { clientId: clientA }),
    );
    const other = await as(a.actor, async (s) =>
      storeUpload(s, { buffer: await png(), originalName: "b.png" }, { clientId: clientB }),
    );
    const img = (versionId: string, objId: string) =>
      imageObject({ id: objId, src: fileSrc(versionId), naturalWidth: 40, naturalHeight: 30 });
    await as(a.actor, (s) =>
      applyDesignOperations(s, {
        designId: id,
        revision: 1,
        ops: [{ op: "add", pageId, object: img(own.versionId, "i1") }],
      }),
    );
    await expect(
      as(a.actor, (s) =>
        applyDesignOperations(s, {
          designId: id,
          revision: 2,
          ops: [{ op: "add", pageId, object: img(other.versionId, "i2") }],
        }),
      ),
    ).rejects.toThrow(/outro cliente/);
    await expect(
      as(a.actor, (s) =>
        applyDesignOperations(s, {
          designId: id,
          revision: 2,
          ops: [{ op: "replaceImage", id: "i1", src: "https://exemplo.com/x.png", naturalWidth: 1, naturalHeight: 1 }],
        }),
      ),
    ).rejects.toThrow(/arquivos da plataforma/);
  });

  it("templates respeitam o cliente; cópias não herdam os arquivos exportados", async () => {
    const tplA = await as(a.actor, (s) =>
      createDesign(s, { name: "Modelo Alfa", width: 1080, height: 1080, clientId: clientA, isTemplate: true }),
    );
    const tplAll = await as(a.actor, (s) =>
      createDesign(s, { name: "Modelo geral", width: 1080, height: 1080, isTemplate: true }),
    );
    await expect(
      as(a.actor, (s) =>
        createDesign(s, { name: "B", width: 100, height: 100, clientId: clientB, templateId: tplA.id }),
      ),
    ).rejects.toThrow(/exclusivo de outro cliente/);
    const okA = await as(a.actor, (s) =>
      createDesign(s, { name: "A", width: 100, height: 100, clientId: clientA, templateId: tplA.id }),
    );
    const okB = await as(a.actor, (s) =>
      createDesign(s, { name: "B", width: 100, height: 100, clientId: clientB, templateId: tplAll.id }),
    );
    expect((await as(a.actor, (s) => getDesign(s, okA.id))).design.width).toBe(1080);
    await expect(as(a.actor, (s) => templatePagesForDesign(s, tplA.id, okB.id))).rejects.toThrow(/exclusivo/);
    expect((await as(a.actor, (s) => templatePagesForDesign(s, tplAll.id, okB.id))).pages).toHaveLength(1);

    // Página exportada: a cópia começa sem o arquivo (a exportação dela cria um arquivo novo).
    const doc = await docOf(a.actor, okA.id);
    const exported = { ...doc, meta: { outputs: { [doc.pages[0]!.id]: "0d6f6a2e-1b8c-4c7e-9d1f-2a3b4c5d6e7f" } } };
    await as(a.actor, (s) =>
      saveDesign(s, { id: okA.id, revision: 1, document: exported as unknown as Record<string, unknown> }),
    );
    const copy = await as(a.actor, (s) => duplicateDesign(s, okA.id));
    expect((await docOf(a.actor, okA.id)).meta?.outputs).toBeDefined();
    expect((await docOf(a.actor, copy.id)).meta?.outputs).toBeUndefined();
  });
});
