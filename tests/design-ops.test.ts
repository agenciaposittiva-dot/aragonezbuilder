import { describe, expect, it } from "vitest";
import {
  applyOperations,
  createDocument,
  DesignOpError,
  ellipseObject,
  imageObject,
  instanceChildren,
  lineObject,
  locate,
  parseDesignDocument,
  rectObject,
  sequentialIds,
  textObject,
  type DesignDocument,
  type DesignOp,
  type GroupObject,
  type ImageObject,
  type InstanceObject,
  type TextObject,
} from "@/lib/design-doc";

/*
 * Camada de operações: cada operação é validada, gera diff legível e a inversa
 * exata — aplicar a inversa devolve o documento original, e reaplicar as
 * operações "aplicadas" (com os ids gerados) refaz o mesmo resultado.
 */

const SRC = "/api/files/0d6f6a2e-1b8c-4c7e-9d1f-2a3b4c5d6e7f";
const SRC2 = "/api/files/1d6f6a2e-1b8c-4c7e-9d1f-2a3b4c5d6e7f";

function sample(): DesignDocument {
  return createDocument({
    newId: sequentialIds("p"),
    pages: [
      {
        width: 1080,
        height: 1350,
        name: "Capa",
        objects: [
          rectObject({ id: "bg", name: "Fundo", x: 0, y: 0, width: 1080, height: 1350, fill: "#121110" }),
          textObject({
            id: "title",
            name: "Título",
            text: "Seu título aqui",
            x: 140,
            y: 200,
            width: 800,
            fontSize: 92,
            color: "#ffffff",
          }),
          ellipseObject({ id: "dot", x: 100, y: 900, width: 200, height: 200, fill: "#F4BF2F" }),
          imageObject({
            id: "photo",
            src: SRC,
            naturalWidth: 2000,
            naturalHeight: 1000,
            x: 100,
            y: 500,
            width: 400,
            height: 400,
            crop: { x: 500, y: 0, width: 1000, height: 1000 },
          }),
          lineObject({ id: "rule", x: 140, y: 420, width: 300, stroke: "#F4BF2F" }),
        ],
      },
      {
        width: 1080,
        height: 1350,
        name: "Slide 2",
        objects: [textObject({ id: "t2", text: "Segundo slide", x: 100, y: 100, width: 600 })],
      },
    ],
  });
}

/** Aplica, confere a inversa e o refazer. */
function roundTrip(doc: DesignDocument, ops: DesignOp[], newId = sequentialIds("n")) {
  const r = applyOperations(doc, ops, { newId });
  expect(() => parseDesignDocument(r.doc)).not.toThrow();
  const undone = applyOperations(r.doc, r.inverse);
  expect(undone.doc).toEqual(doc);
  const redone = applyOperations(doc, r.applied);
  expect(redone.doc).toEqual(r.doc);
  return r;
}

const obj = (doc: DesignDocument, id: string) => locate(doc, id)!.object;

describe("operações do documento", () => {
  it("setText: diff legível e inversa", () => {
    const doc = sample();
    const r = roundTrip(doc, [{ op: "setText", id: "title", text: "Oferta de verão" }]);
    expect((obj(r.doc, "title") as TextObject).text).toBe("Oferta de verão");
    expect(r.diffs[0]!.summary).toBe("Título “Seu título aqui”: texto “Seu título aqui” → “Oferta de verão”");
    expect(r.diffs[0]!.changes).toEqual([
      { id: "title", field: "text", before: "Seu título aqui", after: "Oferta de verão" },
    ]);
    expect(r.diffs[0]!.targets[0]).toMatchObject({ kind: "object", id: "title", pageId: doc.pages[0]!.id });
  });

  it("objetos não alterados mantêm a mesma referência (o editor só redesenha o que mudou)", () => {
    const doc = sample();
    const r = applyOperations(doc, [{ op: "setText", id: "title", text: "Novo" }]);
    expect(r.doc.pages[0]!.objects[0]).toBe(doc.pages[0]!.objects[0]);
    expect(r.doc.pages[1]).toBe(doc.pages[1]);
    expect(r.doc.pages[0]!.objects[1]).not.toBe(doc.pages[0]!.objects[1]);
  });

  it("setStyle aplica só o que cada tipo aceita (fill em texto vira cor do texto)", () => {
    const doc = sample();
    const r = roundTrip(doc, [
      { op: "setStyle", ids: ["title", "dot", "rule"], style: { fill: "#e5562a", strokeWidth: 9, fontSize: 120 } },
    ]);
    expect(obj(r.doc, "title")).toMatchObject({ color: "#e5562a", fontSize: 120, strokeWidth: 9 });
    expect(obj(r.doc, "dot")).toMatchObject({ fill: "#e5562a", strokeWidth: 9 });
    expect(obj(r.doc, "dot")).not.toHaveProperty("fontSize");
    expect(obj(r.doc, "rule")).toMatchObject({ stroke: "#e5562a", strokeWidth: 9 });
    expect(r.diffs[0]!.summary).toBe("Estilo alterado em 3 elementos");
  });

  it("update genérico valida o resultado e não troca id/tipo", () => {
    const doc = sample();
    roundTrip(doc, [{ op: "update", id: "dot", set: { opacity: 0.5, name: "Bolinha" } }]);
    expect(() => applyOperations(doc, [{ op: "update", id: "dot", set: { opacity: 3 } }])).toThrow(DesignOpError);
    expect(() => applyOperations(doc, [{ op: "update", id: "dot", set: { type: "text" } }])).toThrow(
      /não pode ser alterada/,
    );
    const r = roundTrip(doc, [
      { op: "update", id: "title", set: { shadow: { color: "#000", blur: 10, offsetX: 0, offsetY: 4 } } },
    ]);
    expect(obj(r.doc, "title")).toHaveProperty("shadow.blur", 10);
    roundTrip(r.doc, [{ op: "update", id: "title", set: {}, unset: ["shadow"] }]);
  });

  it("transform, move, resize e rotação", () => {
    const doc = sample();
    let r = roundTrip(doc, [{ op: "transform", id: "dot", x: 10, y: 20, width: 300, rotation: 45 }]);
    expect(obj(r.doc, "dot")).toMatchObject({ x: 10, y: 20, width: 300, height: 200, rotation: 45 });
    r = roundTrip(doc, [{ op: "move", ids: ["dot", "title"], dx: 5, dy: -5 }]);
    expect(obj(r.doc, "dot")).toMatchObject({ x: 105, y: 895 });
    r = roundTrip(doc, [{ op: "resize", ids: ["title"], scaleX: 2, scaleY: 2 }]);
    // Escala uniforme em texto aumenta a fonte junto (nada de "escala" guardada).
    expect(obj(r.doc, "title")).toMatchObject({ x: 140, width: 1600, fontSize: 184 });
  });

  it("imagens: trocar mantendo a caixa, enquadrar e recortar", () => {
    const doc = sample();
    let r = roundTrip(doc, [{ op: "replaceImage", id: "photo", src: SRC2, naturalWidth: 1000, naturalHeight: 2000 }]);
    const img = obj(r.doc, "photo") as ImageObject;
    expect(img).toMatchObject({
      src: SRC2,
      x: 100,
      y: 500,
      width: 400,
      height: 400,
      crop: { x: 0, y: 500, width: 1000, height: 1000 },
    });
    expect(r.diffs[0]!.changes.map((c) => c.field)).toEqual(expect.arrayContaining(["src", "crop"]));
    r = roundTrip(doc, [{ op: "imageFit", id: "photo", mode: "fit" }]);
    expect(obj(r.doc, "photo")).toMatchObject({ crop: null, width: 400, height: 200, y: 600 });
    r = roundTrip(doc, [{ op: "imageFit", id: "photo", mode: "fill", zoom: 2, focusX: 0, focusY: 0 }]);
    expect(obj(r.doc, "photo")).toMatchObject({ crop: { x: 0, y: 0, width: 500, height: 500 } });
    roundTrip(doc, [{ op: "crop", id: "photo", crop: { x: 0, y: 0, width: 100, height: 100 } }]);
    expect(() =>
      applyOperations(doc, [{ op: "crop", id: "photo", crop: { x: 1900, y: 0, width: 500, height: 100 } }]),
    ).toThrow(/limites/);
    expect(() =>
      applyOperations(doc, [{ op: "replaceImage", id: "title", src: SRC2, naturalWidth: 1, naturalHeight: 1 }]),
    ).toThrow(/não é uma imagem/);
  });

  it("adicionar, remover (volta à mesma posição) e duplicar com ids determinísticos", () => {
    const doc = sample();
    const pageId = doc.pages[0]!.id;
    let r = roundTrip(doc, [
      { op: "add", pageId, object: rectObject({ id: "new1", width: 50, height: 50 }), index: 1 },
    ]);
    expect(r.doc.pages[0]!.objects.map((o) => o.id)).toEqual(["bg", "new1", "title", "dot", "photo", "rule"]);
    expect(r.diffs[0]!.summary).toMatch(/^Adicionado Retângulo em Capa$/);
    r = roundTrip(doc, [{ op: "remove", ids: ["title", "photo", "bg"] }]);
    expect(r.doc.pages[0]!.objects.map((o) => o.id)).toEqual(["dot", "rule"]);
    r = roundTrip(doc, [{ op: "duplicate", ids: ["dot", "title"] }]);
    expect(r.doc.pages[0]!.objects.map((o) => o.id)).toEqual(["bg", "title", "n2", "dot", "n1", "photo", "rule"]);
    expect(obj(r.doc, "n1")).toMatchObject({ x: 124, y: 924 });
    expect(r.applied[0]).toMatchObject({ op: "duplicate", idMap: { dot: "n1", title: "n2" } });
    expect(() =>
      applyOperations(doc, [{ op: "add", pageId, object: rectObject({ id: "dot", width: 1, height: 1 }) }]),
    ).toThrow(/Já existe/);
  });

  it("ordem das camadas e mudança de página", () => {
    const doc = sample();
    let r = roundTrip(doc, [{ op: "reorder", id: "bg", to: "front" }]);
    expect(r.doc.pages[0]!.objects.at(-1)!.id).toBe("bg");
    r = roundTrip(doc, [{ op: "reorder", id: "rule", to: "backward" }]);
    expect(r.doc.pages[0]!.objects.map((o) => o.id)).toEqual(["bg", "title", "dot", "rule", "photo"]);
    r = roundTrip(doc, [{ op: "reparent", id: "dot", pageId: doc.pages[1]!.id }]);
    expect(r.doc.pages[1]!.objects.map((o) => o.id)).toEqual(["t2", "dot"]);
  });

  it("agrupar e desagrupar (com a ordem original de volta no desfazer)", () => {
    const doc = sample();
    let r = roundTrip(doc, [{ op: "group", ids: ["title", "photo"], groupId: "g1", name: "Bloco" }]);
    expect(r.doc.pages[0]!.objects.map((o) => o.id)).toEqual(["bg", "dot", "g1", "rule"]);
    const g = obj(r.doc, "g1") as GroupObject;
    expect(g.children.map((c) => c.id)).toEqual(["title", "photo"]);
    expect(g).toMatchObject({ x: 100, y: 200, width: 840, rotation: 0 });
    // Mover o grupo move os filhos; redimensionar escala os filhos.
    const moved = roundTrip(r.doc, [{ op: "transform", id: "g1", x: 0, y: 0 }]);
    expect(obj(moved.doc, "title")).toMatchObject({ x: 40, y: 0 });
    const scaled = roundTrip(r.doc, [{ op: "transform", id: "g1", width: 420 }]);
    expect(obj(scaled.doc, "photo")).toMatchObject({ width: 200 });
    r = roundTrip(r.doc, [{ op: "ungroup", id: "g1" }]);
    expect(r.doc.pages[0]!.objects.map((o) => o.id)).toEqual(["bg", "dot", "title", "photo", "rule"]);
    expect(() => applyOperations(doc, [{ op: "group", ids: ["title", "t2"] }])).toThrow(/mesmo nível/);
  });

  it("alinhar e distribuir", () => {
    const doc = sample();
    let r = roundTrip(doc, [{ op: "align", ids: ["dot"], edge: "hcenter" }]);
    expect(obj(r.doc, "dot")).toMatchObject({ x: 440 });
    r = roundTrip(doc, [{ op: "align", ids: ["dot", "title"], edge: "left" }]);
    expect(obj(r.doc, "title")).toMatchObject({ x: 100 });
    r = roundTrip(doc, [{ op: "distribute", ids: ["title", "dot", "rule"], axis: "vertical" }]);
    expect(r.diffs[0]!.summary).toBe("Distribuídos 3 elementos");
  });

  it("páginas: adicionar, duplicar, reordenar (slides do carrossel), editar e remover", () => {
    const doc = sample();
    const [p1, p2] = doc.pages;
    let r = roundTrip(doc, [{ op: "duplicatePage", id: p1!.id }]);
    expect(r.doc.pages.map((p) => p.name)).toEqual(["Capa", "Capa (cópia)", "Slide 2"]);
    expect(r.doc.pages[1]!.objects.map((o) => o.id)).toEqual(["n2", "n3", "n4", "n5", "n6"]);
    r = roundTrip(doc, [{ op: "reorderPage", id: p2!.id, index: 0 }]);
    expect(r.doc.pages.map((p) => p.name)).toEqual(["Slide 2", "Capa"]);
    expect(r.diffs[0]!.summary).toBe("Slide 2 movida da posição 2 para 1");
    r = roundTrip(doc, [
      { op: "updatePage", id: p1!.id, set: { background: "#F4BF2F", name: "Abertura", guides: { v: [540], h: [] } } },
    ]);
    expect(r.doc.pages[0]).toMatchObject({ background: "#F4BF2F", name: "Abertura", guides: { v: [540], h: [] } });
    r = roundTrip(doc, [{ op: "removePage", id: p1!.id }]);
    expect(r.doc.pages).toHaveLength(1);
    expect(() => applyOperations(r.doc, [{ op: "removePage", id: p2!.id }])).toThrow(/pelo menos uma página/);
    const added = roundTrip(doc, [
      { op: "addPage", page: { id: "p9", name: "Fim", width: 1080, height: 1350, background: "#fff", objects: [] } },
    ]);
    expect(added.doc.pages.at(-1)!.id).toBe("p9");
  });

  it("carrossel exige páginas do mesmo tamanho (validado no fim do lote)", () => {
    const doc = sample();
    const [p1, p2] = doc.pages;
    const r = roundTrip(doc, [{ op: "setMeta", set: { carousel: true } }]);
    expect(r.doc.meta?.carousel).toBe(true);
    expect(() =>
      applyOperations(r.doc, [{ op: "updatePage", id: p1!.id, set: { width: 1080, height: 1080 } }]),
    ).toThrow(/mesmo tamanho/);
    // No mesmo lote, todas as páginas mudam juntas: válido.
    roundTrip(r.doc, [
      { op: "updatePage", id: p1!.id, set: { height: 1080 } },
      { op: "updatePage", id: p2!.id, set: { height: 1080 } },
    ]);
  });

  it("trocar paleta numa página específica", () => {
    const doc = sample();
    const r = roundTrip(doc, [
      { op: "changePalette", map: [{ from: "#f4bf2f", to: "#2563eb" }], pageId: doc.pages[0]!.id },
    ]);
    expect(obj(r.doc, "dot")).toMatchObject({ fill: "#2563eb" });
    expect(obj(r.doc, "rule")).toMatchObject({ stroke: "#2563eb" });
    expect(r.doc.pages[1]).toBe(doc.pages[1]);
    expect(r.diffs[0]!.summary).toMatch(/2 elemento\(s\) de Capa/);
  });

  it("componentes: criar a partir da seleção, alterar instância, atualizar o original e desvincular", () => {
    const doc = sample();
    let r = roundTrip(doc, [
      { op: "createComponent", ids: ["dot", "rule"], componentId: "c1", instanceId: "i1", name: "Selo" },
    ]);
    expect(r.doc.components).toHaveLength(1);
    const inst = obj(r.doc, "i1") as InstanceObject;
    expect(inst).toMatchObject({ type: "instance", componentId: "c1", x: 100, y: 420, width: 340, height: 680 });
    expect(r.doc.components[0]!.objects[0]).toMatchObject({ id: "dot", x: 0, y: 480 });
    // Instância maior: os filhos escalam junto.
    const big = applyOperations(r.doc, [{ op: "transform", id: "i1", width: 680, height: 1360 }]).doc;
    expect(instanceChildren(big, obj(big, "i1") as InstanceObject)[0]).toMatchObject({ width: 400, height: 400 });
    r = roundTrip(r.doc, [{ op: "overrideInstance", id: "i1", childId: "dot", set: { fill: "#e5562a" } }]);
    expect(instanceChildren(r.doc, obj(r.doc, "i1") as InstanceObject)[0]).toMatchObject({ fill: "#e5562a" });
    const comp = r.doc.components[0]!;
    roundTrip(r.doc, [{ op: "replaceComponent", component: { ...comp, name: "Selo novo" } }]);
    const d = roundTrip(r.doc, [{ op: "detachInstance", id: "i1" }]);
    const g = obj(d.doc, "i1") as GroupObject;
    expect(g.type).toBe("group");
    expect(g.children[0]).toMatchObject({ fill: "#e5562a", x: 100, y: 900 });
    expect(() => applyOperations(r.doc, [{ op: "removeComponent", id: "c1" }])).toThrow(/em uso/);
  });

  it("lote atômico: se uma operação falha, nada muda", () => {
    const doc = sample();
    const before = JSON.stringify(doc);
    try {
      applyOperations(doc, [
        { op: "setText", id: "title", text: "A" },
        { op: "setText", id: "dot", text: "B" },
      ]);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(DesignOpError);
      expect((err as DesignOpError).index).toBe(1);
      expect((err as Error).message).toMatch(/não é um texto/);
    }
    expect(JSON.stringify(doc)).toBe(before);
    expect(() => applyOperations(doc, [{ op: "nada" }])).toThrow(/Operação 1 inválida/);
    expect(() => applyOperations(doc, [{ op: "setText", id: "naoexiste", text: "x" }])).toThrow(/não encontrado/);
  });

  it("lote com várias operações: inversa na ordem certa", () => {
    const doc = sample();
    const r = roundTrip(doc, [
      { op: "setText", id: "title", text: "Um" },
      { op: "move", ids: ["title"], dx: 10, dy: 0 },
      { op: "group", ids: ["title", "dot"], groupId: "gg" },
      { op: "setStyle", ids: ["gg"], style: { fill: "#000000" } },
      { op: "duplicatePage", id: doc.pages[0]!.id },
    ]);
    expect(r.diffs).toHaveLength(5);
  });
});
