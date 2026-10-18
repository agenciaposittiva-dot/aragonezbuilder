import { describe, expect, it } from "vitest";
import {
  convertLegacyDocument,
  createDocument,
  DESIGN_SCHEMA,
  documentIssues,
  emptyDocument,
  findObjects,
  parseDesignDocument,
  readDesignDocument,
  rectObject,
  sequentialIds,
  summarizeDocument,
  textObject,
  type DesignDocument,
  type DesignObject,
  type GroupObject,
  type ImageObject,
  type LineObject,
  type TextObject,
} from "@/lib/design-doc";
import { buildPdf } from "@/lib/design-doc/pdf";
import fixture from "./fixtures/legacy-fabric.json";

/*
 * Modelo do documento e migração do formato antigo. O fixture foi gerado com
 * o próprio Fabric 7 (como o editor antigo salvava) junto com as medidas que o
 * Fabric calcula para cada objeto — a migração precisa chegar nos mesmos
 * centros, tamanhos e ângulos.
 */

type Expected = {
  cx: number;
  cy: number;
  angle: number;
  scaleX: number;
  scaleY: number;
  width: number;
  height: number;
};
const expected = fixture.expected as unknown as Record<
  string,
  Expected & { p1?: { x: number; y: number }; p2?: { x: number; y: number } }
>;

const SIZE = { width: 1080, height: 1350 };
const all = (doc: DesignDocument) => {
  const out: DesignObject[] = [];
  const walk = (l: DesignObject[]) =>
    l.forEach((o) => {
      out.push(o);
      if (o.type === "group") walk(o.children);
    });
  doc.pages.forEach((p) => walk(p.objects));
  return out;
};
const byId = (doc: DesignDocument, id: string) => all(doc).find((o) => o.id === id)!;
const center = (o: DesignObject) => ({ x: o.x + o.width / 2, y: o.y + o.height / 2 });

describe("modelo do documento", () => {
  it("documento novo é válido, com páginas e carrossel", () => {
    const doc = createDocument({
      pages: [
        { width: 1080, height: 1350 },
        { width: 500, height: 500 },
      ],
      carousel: true,
    });
    expect(doc.schema).toBe(DESIGN_SCHEMA);
    expect(doc.pages).toHaveLength(2);
    // Carrossel: todas as páginas com o tamanho da primeira.
    expect(doc.pages[1]).toMatchObject({ width: 1080, height: 1350, name: "Página 2" });
    expect(parseDesignDocument(doc)).toEqual(doc);
    expect(emptyDocument(1080, 1080).pages).toHaveLength(1);
  });

  it("regras do documento: ids únicos, componentes existentes, carrossel do mesmo tamanho", () => {
    const ids = sequentialIds("x");
    const doc = createDocument({ pages: [{ width: 100, height: 100 }], newId: ids });
    const a = rectObject({ id: "dup", width: 10, height: 10 });
    const broken: DesignDocument = {
      ...doc,
      pages: [
        {
          ...doc.pages[0]!,
          objects: [
            a,
            { ...a },
            {
              id: "i1",
              type: "instance",
              componentId: "nada",
              name: "",
              x: 0,
              y: 0,
              width: 1,
              height: 1,
              rotation: 0,
              opacity: 1,
            },
          ],
        },
        { ...doc.pages[0]!, id: "p2", width: 50 },
      ],
      meta: { carousel: true },
    };
    const issues = documentIssues(broken);
    expect(issues.join("\n")).toMatch(/repetido: dup/);
    expect(issues.join("\n")).toMatch(/Componente inexistente/);
    expect(issues.join("\n")).toMatch(/mesmo tamanho/);
    expect(() => parseDesignDocument(broken)).toThrow(/inválido/);
  });

  it("rejeita valores perigosos ou fora do formato", () => {
    const doc = emptyDocument(100, 100);
    const bad = (o: Record<string, unknown>) => ({ ...doc, pages: [{ ...doc.pages[0]!, objects: [o] }] });
    const base = rectObject({ id: "r1", width: 10, height: 10 });
    expect(() => parseDesignDocument(bad({ ...base, fill: "url(javascript:alert(1))" }))).toThrow();
    expect(() => parseDesignDocument(bad({ ...base, x: Number.NaN }))).toThrow();
    expect(() => parseDesignDocument(bad({ ...base, type: "script" }))).toThrow();
    expect(() =>
      parseDesignDocument(
        bad({
          id: "i1",
          type: "image",
          src: "javascript:alert(1)",
          name: "",
          x: 0,
          y: 0,
          width: 1,
          height: 1,
          rotation: 0,
          opacity: 1,
        }),
      ),
    ).toThrow();
  });

  it("resumo e busca para o chat de edição", () => {
    const doc = createDocument({
      pages: [
        {
          width: 1080,
          height: 1080,
          objects: [textObject({ id: "t1", name: "Título", text: "Promoção de Verão", width: 800 })],
        },
        { width: 1080, height: 1080, objects: [textObject({ id: "t2", name: "CTA", text: "Compre já", width: 400 })] },
      ],
      newId: sequentialIds("p"),
    });
    expect(findObjects(doc, { textContains: "verao" }).map((l) => l.object.id)).toEqual(["t1"]);
    expect(findObjects(doc, { page: 2 }).map((l) => l.object.id)).toEqual(["t2"]);
    expect(findObjects(doc, { name: "título" })).toHaveLength(1);
    const s = summarizeDocument(doc);
    expect(s.pages[1]).toMatchObject({ number: 2, objects: [{ id: "t2", text: "Compre já" }] });
  });
});

describe("migração do formato antigo (Fabric)", () => {
  const { doc } = convertLegacyDocument(fixture.doc, SIZE);

  it("converte de forma determinística e válida", () => {
    expect(convertLegacyDocument(fixture.doc, SIZE).doc).toEqual(doc);
    expect(() => parseDesignDocument(doc)).not.toThrow();
    expect(doc.pages).toHaveLength(1);
    expect(doc.pages[0]).toMatchObject({ width: 1080, height: 1350, background: "#f1f0ec", name: "Página 1" });
    expect(doc.meta).toMatchObject({ migratedFrom: "fabric", legacy: { version: "7.4.0" } });
    // Mesma quantidade de objetos e a mesma ordem das camadas, com os mesmos ids.
    expect(doc.pages[0]!.objects.map((o) => o.id)).toEqual(fixture.doc.objects.map((o: { uid: string }) => o.uid));
  });

  it("chega nos mesmos centros, tamanhos e ângulos calculados pelo Fabric", () => {
    for (const id of [
      "title001",
      "sub00001",
      "body0001",
      "rect0001",
      "circ0001",
      "imag0001",
      "imag0002",
      "lock0001",
      "hide0001",
      "ltop0001",
      "shad0001",
      "grad0001",
      "grpa0001",
      "grpb0001",
    ]) {
      const o = byId(doc, id);
      const e = expected[id]!;
      const c = center(o);
      expect(c.x, `${id} x`).toBeCloseTo(e.cx, 1);
      expect(c.y, `${id} y`).toBeCloseTo(e.cy, 1);
      expect(o.width, `${id} largura`).toBeCloseTo(e.width * Math.abs(e.scaleX), 1);
      if (o.type !== "text") expect(o.height, `${id} altura`).toBeCloseTo(e.height * Math.abs(e.scaleY), 1);
      expect(o.rotation, `${id} ângulo`).toBeCloseTo(e.angle, 3);
    }
    // Espelhado: (−20°, espelho horizontal) é o mesmo que o Fabric decompõe como (160°, espelho vertical).
    const tri = byId(doc, "tria0001");
    expect(tri).toMatchObject({ type: "triangle", rotation: -20, flipX: true, width: 200, height: 150 });
    expect(center(tri)).toEqual({ x: 860, y: 800 });
  });

  it("textos: escala incorporada à fonte e à largura, propriedades preservadas", () => {
    const title = byId(doc, "title001") as TextObject;
    expect(title).toMatchObject({
      type: "text",
      name: "Título",
      text: "Seu título aqui",
      fontFamily: "Inter",
      fontSize: 92,
      fontWeight: 700,
      textAlign: "center",
      lineHeight: 1.15,
      color: "#121110",
      width: 810,
      height: 103.96,
    });
    expect(title.legacy).toBeUndefined();
    const sub = byId(doc, "sub00001") as TextObject;
    expect(sub.fontSize).toBe(81);
    expect(sub.width).toBe(750);
    const body = byId(doc, "body0001") as TextObject;
    expect(body).toMatchObject({ letterSpacing: 120, underline: true, fontStyle: "italic", textAlign: "right" });
    const free = byId(doc, "itxt0001") as TextObject;
    expect(free).toMatchObject({ autoWidth: true, fontFamily: "Georgia" });
  });

  it("formas, imagens, linhas e estados", () => {
    expect(byId(doc, "rect0001")).toMatchObject({
      type: "rect",
      radius: 10,
      stroke: "#000000",
      strokeWidth: 7.5,
      fill: "#F4BF2F",
    });
    expect(byId(doc, "circ0001")).toMatchObject({ type: "ellipse", width: 240, height: 160 });
    const img = byId(doc, "imag0001") as ImageObject;
    expect(img.src.startsWith("data:image/png")).toBe(true);
    expect(img).toMatchObject({ naturalWidth: 40, naturalHeight: 30, crop: null, width: 120, height: 90 });
    expect(byId(doc, "imag0002")).toMatchObject({ crop: { x: 5, y: 5, width: 20, height: 15 }, width: 80, height: 60 });
    expect(byId(doc, "lock0001")).toMatchObject({ locked: true });
    expect(byId(doc, "hide0001")).toMatchObject({ hidden: true, opacity: 0.5 });
    expect(byId(doc, "shad0001")).toMatchObject({
      shadow: { color: "rgba(0,0,0,0.4)", blur: 20, offsetX: 4, offsetY: 8 },
    });
    expect(byId(doc, "grad0001")).toMatchObject({
      fill: {
        type: "linear",
        angle: 0,
        stops: [
          { offset: 0, color: "#F4BF2F" },
          { offset: 1, color: "#e5562a" },
        ],
      },
    });

    for (const id of ["line0001", "line0002", "line0003"]) {
      const l = byId(doc, id) as LineObject;
      const e = expected[id]!;
      const a = (l.rotation * Math.PI) / 180;
      const c = { x: l.x + l.width / 2, y: l.y };
      const p1 = { x: c.x - (Math.cos(a) * l.width) / 2, y: c.y - (Math.sin(a) * l.width) / 2 };
      const p2 = { x: c.x + (Math.cos(a) * l.width) / 2, y: c.y + (Math.sin(a) * l.width) / 2 };
      expect(l.height).toBe(0);
      expect(p1.x, `${id} p1.x`).toBeCloseTo(e.p1!.x, 1);
      expect(p1.y, `${id} p1.y`).toBeCloseTo(e.p1!.y, 1);
      expect(p2.x, `${id} p2.x`).toBeCloseTo(e.p2!.x, 1);
      expect(p2.y, `${id} p2.y`).toBeCloseTo(e.p2!.y, 1);
    }
    expect(byId(doc, "line0003")).toMatchObject({ lineCap: "round", strokeWidth: 4 });
  });

  it("grupos viram grupos com os filhos nas coordenadas da página; o que não tem equivalente fica intacto", () => {
    const g = byId(doc, "grup0001") as GroupObject;
    expect(g.type).toBe("group");
    expect(g.children.map((c) => c.id)).toEqual(["grpa0001", "grpb0001"]);
    expect(g.rotation).toBe(0);
    expect(byId(doc, "grpa0001")).toMatchObject({ width: 120, height: 120, rotation: 20 });
    const path = byId(doc, "path0001");
    expect(path.type).toBe("fabric");
    if (path.type === "fabric")
      expect(path.raw).toEqual(fixture.doc.objects.find((o: { uid: string }) => o.uid === "path0001"));
    expect(center(path)).toEqual({ x: 800, y: 1100 });
  });

  it("guarda propriedades sem equivalente em legacy (nada se perde)", () => {
    const raw = {
      version: "7.4.0",
      objects: [
        {
          type: "Rect",
          uid: "r1",
          left: 10,
          top: 10,
          width: 10,
          height: 10,
          fill: "#000",
          hoverCursor: "pointer",
          customData: { a: 1 },
        },
      ],
      background: "#fff",
      clipPath: { type: "Rect" },
    };
    const d = convertLegacyDocument(raw, { width: 100, height: 100 }).doc;
    expect(d.pages[0]!.objects[0]!.legacy).toEqual({ hoverCursor: "pointer", customData: { a: 1 } });
    expect(d.meta?.legacy).toMatchObject({ version: "7.4.0", clipPath: { type: "Rect" } });
  });

  it("documentos mínimos (como os dos testes e de outros módulos) e texto sem altura", () => {
    const d = convertLegacyDocument(
      {
        objects: [
          { type: "textbox", uid: "t0", text: "Olá", left: 0, top: 10 },
          {
            type: "Textbox",
            text: "Gerado fora do editor",
            left: 540,
            top: 540,
            width: 800,
            fontSize: 60,
            originX: "center",
            originY: "center",
          },
          { type: "image", uid: "i1", src: "https://app.exemplo.com/api/files/0d6f6a2e-1b8c-4c7e-9d1f-2a3b4c5d6e7f" },
          { type: "sem-tipo" },
          "lixo",
        ],
      },
      { width: 1080, height: 1080 },
    ).doc;
    const objs = d.pages[0]!.objects;
    expect(objs.map((o) => o.type)).toEqual(["text", "text", "image", "fabric"]);
    expect(objs[1]!.id).toBe("lg1");
    const t = objs[1] as TextObject;
    expect(t.measure).toBe("center");
    expect(center(t)).toEqual({ x: 540, y: 540 });
    expect((objs[2] as ImageObject).src).toBe("/api/files/0d6f6a2e-1b8c-4c7e-9d1f-2a3b4c5d6e7f");
    expect(() => parseDesignDocument(d)).not.toThrow();
  });

  it("documento real do editor antigo (banco de desenvolvimento)", () => {
    const real = {
      objects: [
        {
          top: 398,
          uid: "qlggb92h",
          fill: "#121110",
          left: 398,
          name: "Título",
          text: "Seu título aqui",
          type: "Textbox",
          angle: 0,
          flipX: false,
          flipY: false,
          skewX: 0,
          skewY: 0,
          width: 810,
          height: 103.96,
          scaleX: 1,
          scaleY: 1,
          shadow: null,
          stroke: null,
          styles: [],
          evented: true,
          opacity: 1,
          originX: "center",
          originY: "center",
          version: "7.4.0",
          visible: true,
          fillRule: "nonzero",
          fontSize: 92,
          minWidth: 20,
          overline: false,
          pathSide: "left",
          direction: "ltr",
          fontStyle: "normal",
          pathAlign: "baseline",
          textAlign: "center",
          underline: false,
          fontFamily: "Inter",
          fontWeight: 700,
          lineHeight: 1.15,
          paintFirst: "fill",
          selectable: true,
          charSpacing: 0,
          linethrough: false,
          strokeWidth: 1,
          lockRotation: false,
          lockScalingX: false,
          lockScalingY: false,
          lockMovementX: false,
          lockMovementY: false,
          strokeLineCap: "butt",
          strokeUniform: false,
          strokeLineJoin: "miter",
          backgroundColor: "",
          pathStartOffset: 0,
          splitByGrapheme: false,
          strokeDashArray: null,
          strokeDashOffset: 0,
          strokeMiterLimit: 4,
          textBackgroundColor: "",
          textDecorationThickness: 66.667,
          globalCompositeOperation: "source-over",
        },
        {
          top: 398,
          uid: "t67uqpmu",
          fill: "#F4BF2F",
          left: 398,
          name: "Círculo",
          type: "Circle",
          angle: 0,
          flipX: false,
          flipY: false,
          skewX: 0,
          skewY: 0,
          width: 324,
          height: 324,
          radius: 162,
          scaleX: 1,
          scaleY: 1,
          shadow: null,
          stroke: null,
          evented: true,
          opacity: 1,
          originX: "center",
          originY: "center",
          version: "7.4.0",
          visible: true,
          endAngle: 360,
          fillRule: "nonzero",
          paintFirst: "fill",
          selectable: true,
          startAngle: 0,
          strokeWidth: 1,
          lockRotation: false,
          lockScalingX: false,
          lockScalingY: false,
          lockMovementX: false,
          lockMovementY: false,
          strokeLineCap: "butt",
          strokeUniform: false,
          strokeLineJoin: "miter",
          backgroundColor: "",
          strokeDashArray: null,
          counterClockwise: false,
          strokeDashOffset: 0,
          strokeMiterLimit: 4,
          globalCompositeOperation: "source-over",
        },
      ],
      version: "7.4.0",
      background: "#ffffff",
    };
    const r = readDesignDocument(real, { width: 1080, height: 1080 });
    expect(r.source).toBe("fabric");
    expect(r.doc.pages[0]!.objects).toEqual([
      expect.objectContaining({ id: "qlggb92h", type: "text", x: -7, y: 346.02, width: 810, height: 103.96 }),
      {
        id: "t67uqpmu",
        type: "ellipse",
        name: "Círculo",
        x: 236,
        y: 236,
        width: 324,
        height: 324,
        rotation: 0,
        opacity: 1,
        fill: "#F4BF2F",
      },
    ]);
    // Nenhuma propriedade "sobrou": tudo era padrão do Fabric ou foi convertido.
    expect(r.doc.pages[0]!.objects.every((o) => !o.legacy)).toBe(true);
  });
});

describe("leitura de documentos", () => {
  it("formato 2 passa direto; vazio vira uma página; partes inválidas são guardadas", () => {
    const doc = emptyDocument(1080, 1350, { pages: 2, carousel: true });
    expect(readDesignDocument(doc, { width: 1, height: 1 })).toEqual({ doc, source: "v2", notes: [] });
    const empty = readDesignDocument({}, { width: 300, height: 200 });
    expect(empty.doc.pages).toEqual([expect.objectContaining({ width: 300, height: 200, objects: [] })]);
    const broken = {
      ...doc,
      pages: [
        {
          ...doc.pages[0]!,
          objects: [rectObject({ id: "ok", width: 10, height: 10 }), { id: "bad", type: "rect", x: "não" }],
        },
      ],
    };
    const r = readDesignDocument(broken, { width: 1080, height: 1350 });
    expect(r.source).toBe("repaired");
    expect(r.doc.pages[0]!.objects.map((o) => o.id)).toEqual(["ok"]);
    expect(r.doc.meta?.legacy?.invalid).toEqual([{ id: "bad", type: "rect", x: "não" }]);
    expect(() => parseDesignDocument(r.doc)).not.toThrow();
  });
});

describe("PDF", () => {
  it("monta um PDF válido com uma página por imagem", () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const pdf = buildPdf(
      [
        { jpeg, pixelWidth: 1080, pixelHeight: 1350, width: 1080, height: 1350 },
        { jpeg, pixelWidth: 2160, pixelHeight: 2700, width: 1080, height: 1350 },
      ],
      { title: "Carrossel ação" },
    );
    const text = new TextDecoder("latin1").decode(pdf);
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(text).toContain("/Count 2");
    expect(text).toContain("/MediaBox [0 0 810 1012.5]");
    // A tabela xref aponta para o início de cada objeto.
    const xref = Number(/startxref\n(\d+)/.exec(text)![1]);
    expect(text.slice(xref, xref + 4)).toBe("xref");
    const offsets = [...text.slice(xref).matchAll(/(\d{10}) 00000 n/g)].map((m) => Number(m[1]));
    offsets.forEach((off, i) => expect(text.slice(off, off + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`));
  });
});
