import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CHANGELOG } from "@/lib/changelog";

/*
 * A página Atualizações só pode listar o que foi testado: cada item cita
 * testes que existem no repositório, e docs/CHANGELOG.md espelha o registro.
 */

const root = path.resolve(__dirname, "..");

describe("registro de atualizações", () => {
  it("números únicos e sequenciais, datas válidas e campos preenchidos", () => {
    const ns = CHANGELOG.map((e) => e.n).sort((a, b) => a - b);
    expect(ns).toEqual(ns.map((_, i) => i + 1));
    for (const e of CHANGELOG) {
      expect(e.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(Date.parse(e.date))).toBe(false);
      expect(e.title && e.module && e.description && e.fixed).toBeTruthy();
      expect(e.tests.length).toBeGreaterThan(0);
    }
  });

  it("todo arquivo de teste citado existe", () => {
    for (const e of CHANGELOG) {
      const files = e.tests.flatMap((t) => t.match(/\b(?:tests|e2e)\/[\w.-]+\.(?:test|spec)\.ts\b/g) ?? []);
      expect(files.length, `#${e.n} precisa citar ao menos um arquivo de teste`).toBeGreaterThan(0);
      for (const f of files) expect(existsSync(path.join(root, f)), `#${e.n}: ${f}`).toBe(true);
    }
  });

  it("docs/CHANGELOG.md espelha cada item", () => {
    const md = readFileSync(path.join(root, "docs/CHANGELOG.md"), "utf8");
    for (const e of CHANGELOG) {
      expect(md).toContain(`## #${e.n} — ${e.title}`);
      expect(md).toContain(e.fixed);
    }
  });
});
