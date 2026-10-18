import { describe, expect, it } from "vitest";
import { computeSnap, snapTargets } from "@/components/studio/editor/snap";
import { EditorStore } from "@/components/studio/editor/store";
import { createDocument, rectObject, sequentialIds, textObject } from "@/lib/design-doc";
import { buildZip, crc32 } from "@/lib/zip";

/*
 * Peças do editor que não dependem do navegador: histórico (desfazer/refazer
 * por operações, agrupamento de alterações seguidas), alinhamento magnético e
 * o ZIP das exportações com várias páginas.
 */

function store() {
  const doc = createDocument({
    newId: sequentialIds("p"),
    pages: [
      {
        width: 1080,
        height: 1080,
        objects: [
          rectObject({ id: "r1", x: 100, y: 100, width: 200, height: 100 }),
          textObject({ id: "t1", text: "Olá", x: 100, y: 400, width: 500 }),
        ],
      },
      { width: 1080, height: 1080 },
    ],
  });
  return new EditorStore(doc);
}

describe("histórico do editor", () => {
  it("desfaz e refaz pelas operações, restaurando seleção e página", () => {
    const s = store();
    const original = s.doc;
    const changes: string[] = [];
    s.onChange = (r) => changes.push(r);
    s.setSelection(["r1"]);
    s.dispatch([{ op: "move", ids: ["r1"], dx: 10, dy: 0 }], { select: ["r1"] });
    s.dispatch([{ op: "setText", id: "t1", text: "Oi" }], { select: ["t1"] });
    expect(s.past.map((e) => e.label)).toEqual(["Mover", "Editar texto"]);
    s.undo();
    expect(s.selection).toEqual(["r1"]);
    s.undo();
    expect(s.doc).toEqual(original);
    expect(s.canUndo).toBe(false);
    s.redo();
    s.redo();
    expect(s.doc.pages[0]!.objects.map((o) => o.x)).toEqual([110, 100]);
    expect(changes).toEqual(["edit", "edit", "history", "history", "history", "history"]);
  });

  it("alterações seguidas do mesmo controle viram uma entrada só", () => {
    const s = store();
    for (const o of [0.9, 0.8, 0.7, 0.6])
      s.dispatch([{ op: "update", id: "r1", set: { opacity: o } }], { coalesce: "opacity:r1" });
    expect(s.past).toHaveLength(1);
    s.undo();
    expect(s.doc.pages[0]!.objects[0]!.opacity).toBe(1);
  });

  it("operação inválida avisa e não muda nada; ajustes técnicos ficam fora do histórico", () => {
    const s = store();
    const errors: string[] = [];
    s.onError = (m) => errors.push(m);
    expect(s.dispatch([{ op: "setText", id: "r1", text: "x" }])).toBeNull();
    expect(errors[0]).toMatch(/não é um texto/);
    s.dispatch([{ op: "update", id: "t1", set: { height: 77 } }], { history: false, reason: "silent" });
    expect(s.past).toHaveLength(0);
    expect(s.doc.pages[0]!.objects[1]!.height).toBe(77);
  });

  it("desfazer não apaga onde as páginas foram exportadas (a próxima exportação continua sendo nova versão)", () => {
    const s = store();
    s.dispatch([{ op: "updatePage", id: s.doc.pages[0]!.id, set: { background: "#000000" } }]);
    s.dispatch(
      [{ op: "setMeta", set: { outputs: { [s.doc.pages[0]!.id]: "0d6f6a2e-1b8c-4c7e-9d1f-2a3b4c5d6e7f" } } }],
      {
        history: false,
      },
    );
    s.undo();
    expect(s.doc.pages[0]!.background).toBe("#ffffff");
    expect(s.doc.meta?.outputs).toBeDefined();
  });

  it("seleção some quando o objeto é removido; ativar objeto ativa a página dele", () => {
    const s = store();
    s.setSelection(["r1"]);
    s.dispatch([{ op: "remove", ids: ["r1"] }]);
    expect(s.selection).toEqual([]);
    s.setActivePage(s.doc.pages[1]!.id);
    s.setSelection(["t1"]);
    expect(s.activePageId).toBe(s.doc.pages[0]!.id);
  });
});

describe("alinhamento magnético", () => {
  const page = { x: 0, y: 0, width: 1000, height: 1000 };
  const other = { x: 600, y: 100, width: 200, height: 100 };
  const targets = snapTargets([page, other], { v: [250], h: [] });

  it("atrai para o centro da página e para as bordas de outro objeto, com as linhas", () => {
    const r = computeSnap({ x: 396, y: 597, width: 200, height: 100 }, targets, 6);
    expect(r.dx).toBe(4);
    expect(r.lines.find((l) => l.axis === "x")).toMatchObject({ at: 500 });
    const top = computeSnap({ x: 50, y: 103, width: 100, height: 50 }, targets, 6);
    expect(top.dy).toBe(-3);
    expect(top.lines.find((l) => l.axis === "y")).toMatchObject({ at: 100, start: 50, end: 800 });
  });

  it("guias e grade; fora do limite não mexe", () => {
    // O centro (252) é o que está mais perto da guia (250).
    expect(computeSnap({ x: 247, y: 10, width: 10, height: 10 }, targets, 6).dx).toBe(-2);
    expect(computeSnap({ x: 333, y: 333, width: 10, height: 10 }, { x: [], y: [] }, 6, 20).dx).toBe(2);
    expect(computeSnap({ x: 420, y: 333, width: 10, height: 10 }, targets, 6)).toEqual({ dx: 0, dy: 0, lines: [] });
  });
});

describe("ZIP das exportações", () => {
  it("monta um ZIP válido (assinaturas, CRC e diretório central)", () => {
    const enc = new TextEncoder();
    const files = [
      { name: "Arte - 01 Capa.png", data: enc.encode("primeira") },
      { name: "Arte - 02 Fim.png", data: enc.encode("segunda página") },
    ];
    const zip = buildZip(files, new Date(2026, 9, 18, 10, 30));
    const view = new DataView(zip.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint32(14, true)).toBe(crc32(files[0]!.data));
    const end = zip.length - 22;
    expect(view.getUint32(end, true)).toBe(0x06054b50);
    expect(view.getUint16(end + 10, true)).toBe(2);
    const centralOffset = view.getUint32(end + 16, true);
    expect(view.getUint32(centralOffset, true)).toBe(0x02014b50);
    expect(crc32(enc.encode("123456789"))).toBe(0xcbf43926);
  });
});
