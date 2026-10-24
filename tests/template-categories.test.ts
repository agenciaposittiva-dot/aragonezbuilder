import { describe, expect, it } from "vitest";
import {
  categoryGroup,
  compareCategories,
  formatKey,
  formatLabel,
  OTHER_CATEGORY,
  TEMPLATE_CATEGORIES,
} from "@/lib/design-doc/template-categories";
import { TEMPLATE_LIBRARY } from "@/lib/template-library";

describe("categorias e formatos da galeria de modelos", () => {
  it("agrupa categorias novas, antigas e vazias", () => {
    expect(categoryGroup("Minimalista")).toBe("Minimalista");
    expect(categoryGroup("minimalista")).toBe("Minimalista");
    expect(categoryGroup("Frases")).toBe("Minimalista");
    expect(categoryGroup("Capas")).toBe("Autoridade e posicionamento");
    expect(categoryGroup("Carrosséis")).toBe("Carrosséis estratégicos");
    expect(categoryGroup("Importados")).toBe("Importados");
    expect(categoryGroup(null)).toBe(OTHER_CATEGORY);
    expect(categoryGroup("  ")).toBe(OTHER_CATEGORY);
  });

  it("ordena: categorias conhecidas na ordem da lista, depois as demais, Outros por último", () => {
    const sorted = ["Zebra", OTHER_CATEGORY, "Editorial", "Aesthetic", "Importados"].sort(compareCategories);
    expect(sorted).toEqual(["Aesthetic", "Editorial", "Importados", "Zebra", OTHER_CATEGORY]);
  });

  it("reconhece os formatos comuns com tolerância", () => {
    expect(formatKey(1080, 1350)).toBe("4:5");
    expect(formatKey(1080, 1080)).toBe("1:1");
    expect(formatKey(1080, 1920)).toBe("9:16");
    expect(formatKey(1920, 1080)).toBe("16:9");
    expect(formatKey(1200, 628)).toBe("outro");
    expect(formatLabel(1080, 1350)).toBe("4:5");
    expect(formatLabel(480, 320)).toBe("480×320");
  });

  it("a biblioteca de modelos usa só categorias da galeria", () => {
    for (const t of TEMPLATE_LIBRARY) {
      expect(TEMPLATE_CATEGORIES).toContain(t.category);
    }
  });
});
