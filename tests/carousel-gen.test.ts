import { describe, expect, it } from "vitest";
import { assembleDocument, assignLayouts, currentSlides, FORMAT_SIZE } from "@/lib/carousel-gen/assemble";
import { contrast, minContrast, mix } from "@/lib/carousel-gen/color";
import { buildDirection, hashSeed, PALETTES, tintOf, type BrandIdentity } from "@/lib/carousel-gen/direction";
import { fitText, measure } from "@/lib/carousel-gen/fit";
import { DECORATIVE } from "@/lib/carousel-gen/layouts";
import { aiPlanSchema, normalizePlan, numbersIn } from "@/lib/carousel-gen/plan";
import {
  documentIssues,
  parseDesignDocument,
  type DesignDocument,
  type DesignObject,
  type DesignPage,
  type GeneratorMeta,
  type TextObject,
} from "@/lib/design-doc";
import { demoCarouselJson } from "@/server/ai/demo-carousel";

/*
 * Motor de composição do gerador de carrosséis, sem banco: roteiro de
 * demonstração → regras do roteiro → direção de arte → slides no formato do
 * editor. Verifica os critérios de qualidade: temas diferentes geram
 * carrosséis diferentes, unidade dentro do carrossel, continuidade entre
 * slides, numeração, texto dentro da área segura, contraste WCAG, nenhum
 * número inventado e identidade do cliente aplicada.
 */

type Opts = {
  identity?: BrandIdentity | null;
  references?: string;
  slides?: number | null;
  format?: "portrait" | "square";
  objective?: string;
};

function build(topic: string, o: Opts = {}) {
  const input = {
    topic,
    objective: o.objective ?? "",
    audience: "",
    slides: o.slides ?? null,
    tone: "",
    format: o.format ?? ("portrait" as const),
    clientId: null,
    useIdentity: !!o.identity,
    references: o.references ?? "",
    fileIds: [],
    images: "auto" as const,
  };
  const prompt = [
    "Formato da resposta: carousel_plan",
    `Tema: ${topic}`,
    input.objective ? `Objetivo: ${input.objective}` : null,
    `Quantidade de slides: ${input.slides ?? "automática"}`,
    "",
    input.references ? `Referências da equipe:\n${input.references}` : "Referências da equipe: nenhuma",
  ]
    .filter((l) => l !== null)
    .join("\n");
  const ai = aiPlanSchema.parse(JSON.parse(demoCarouselJson("carousel_plan", prompt)!));
  let n = 0;
  const norm = normalizePlan(ai, input, {
    imagesAvailable: false,
    newKey: (i) => `s${i + 1}`,
    newPageId: () => `pg${++n}`,
  });
  const seed = hashSeed(topic);
  const direction = buildDirection({ seed, topic, identity: o.identity ?? null, suggestion: norm.suggestion });
  const meta: GeneratorMeta = {
    v: 1,
    mode: "quick",
    input,
    plan: norm.plan,
    slides: assignLayouts(norm.slides, seed),
    claims: norm.claims,
    direction,
    ai: { provider: "demo", model: "demo", demo: true, imageProvider: null, imageModel: null },
    visuals: "vector",
    warnings: norm.warnings,
    version: 1,
    history: [],
    variantOf: null,
    createdAt: new Date().toISOString(),
  };
  return { meta, doc: assembleDocument(meta), norm };
}

const THEMES = [
  "Clareamento dental: mitos e cuidados",
  "Como montar uma reserva de emergência",
  "Café especial em casa",
  "Treino de força para iniciantes",
];

const flat = (list: DesignObject[]): DesignObject[] =>
  list.flatMap((o) => (o.type === "group" ? [o, ...flat(o.children)] : [o]));
const texts = (p: DesignPage) => flat(p.objects).filter((o): o is TextObject => o.type === "text");
const solid = (o: DesignObject) => {
  const fill = (o as { fill?: unknown }).fill;
  return typeof fill === "string" && o.opacity === 1 && !o.hidden ? fill : null;
};
const inside = (t: TextObject, o: DesignObject) => {
  const cx = t.x + t.width / 2;
  const cy = t.y + Math.min(t.height, 60) / 2;
  return o.rotation === 0 && cx >= o.x && cx <= o.x + o.width && cy >= o.y && cy <= o.y + o.height;
};

/** Cor atrás do texto: a forma sólida mais acima que o contém, ou o fundo da página. */
function backgroundsUnder(doc: DesignDocument, pageIndex: number, t: TextObject) {
  const page = doc.pages[pageIndex]!;
  const all = flat(page.objects);
  const idx = all.indexOf(t);
  const below = all.slice(0, idx).filter((o) => o.type !== "text" && o.type !== "image" && solid(o) && inside(t, o));
  const top = below.at(-1);
  const out = [top ? solid(top)! : typeof page.background === "string" ? page.background : "#FFFFFF"];
  // Sem cartão por baixo, a forma de continuidade (deste slide ou do anterior) pode passar atrás.
  if (!top && doc.meta?.generator) out.push(tintOf(doc.meta.generator.direction));
  return out;
}

describe("gerador de carrosséis — composição", () => {
  const built = THEMES.map((t) => build(t));

  it("gera documentos válidos, conectados e do mesmo tamanho", () => {
    for (const { doc } of built) {
      expect(() => parseDesignDocument(doc)).not.toThrow();
      expect(documentIssues(doc)).toEqual([]);
      expect(doc.meta?.carousel).toBe(true);
      expect(new Set(doc.pages.map((p) => `${p.width}x${p.height}`))).toEqual(new Set(["1080x1350"]));
      expect(doc.pages.length).toBeGreaterThanOrEqual(5);
    }
  });

  it("temas de segmentos diferentes geram carrosséis diferentes (direção, paleta, composição)", () => {
    const signature = (b: (typeof built)[number]) =>
      JSON.stringify([b.meta.direction.key, b.meta.direction.motif, b.meta.slides.map((s) => `${s.role}:${s.layout}`)]);
    expect(new Set(built.map(signature)).size).toBe(THEMES.length);
    expect(new Set(built.map((b) => b.meta.direction.palette.bg)).size).toBeGreaterThanOrEqual(3);
    // Paleta pelo assunto: saúde → paleta clínica; finanças → azul confiança/editorial; café → tons quentes.
    expect(["menta", "lavanda"]).toContain(built[0]!.meta.direction.key.split("-")[0]);
    expect(PALETTES.find((p) => p.key === built[2]!.meta.direction.key.split("-")[0])?.tags).toContain("food");
  });

  it("unidade: mesma tipografia em todos os slides; capa primeiro e chamada final por último", () => {
    for (const { doc, meta } of built) {
      const headingFonts = new Set(
        doc.pages.flatMap((p) =>
          texts(p)
            .filter((t) => t.id.endsWith("-title"))
            .map((t) => t.fontFamily),
        ),
      );
      expect(headingFonts.size).toBe(1);
      expect(meta.slides[0]!.role).toBe("cover");
      expect(meta.slides.at(-1)!.role).toBe("cta");
    }
  });

  it("continuidade: um elemento atravessa cada divisa (borda direita → próximo slide)", () => {
    for (const { doc } of built) {
      const W = doc.pages[0]!.width;
      doc.pages.slice(0, -1).forEach((p) => {
        const cross = p.objects.filter((o) => o.name === "Elemento de continuidade" && o.x < W && o.x + o.width > W);
        expect(cross.length, p.name).toBeGreaterThan(0);
      });
      expect(doc.pages.at(-1)!.objects.some((o) => o.name === "Elemento de continuidade")).toBe(false);
    }
  });

  it("numeração e progresso em todos os slides depois da capa; 'arraste' na capa", () => {
    for (const { doc } of built) {
      const total = doc.pages.length;
      doc.pages.forEach((p, i) => {
        const counter = texts(p).find((t) => t.name === "Contador");
        if (i === 0) {
          expect(counter).toBeUndefined();
          expect(texts(p).some((t) => t.name === "Arraste")).toBe(true);
          return;
        }
        expect(counter?.text).toBe(`${String(i + 1).padStart(2, "0")}/${String(total).padStart(2, "0")}`);
        const bar = p.objects.find((o) => o.name === "Progresso")!;
        const track = p.objects.find((o) => o.name === "Progresso (trilho)")!;
        expect(bar.width / track.width).toBeCloseTo((i + 1) / total, 1);
      });
    }
  });

  it("textos dentro da página e da área segura (margens), sem estourar o rodapé", () => {
    for (const { doc } of built) {
      for (const p of doc.pages) {
        for (const t of texts(p)) {
          if (t.name.startsWith(DECORATIVE)) continue;
          expect(t.x, `${p.name} ${t.id}`).toBeGreaterThanOrEqual(40);
          expect(t.x + t.width, `${p.name} ${t.id}`).toBeLessThanOrEqual(p.width - 40);
          expect(t.y + t.height, `${p.name} ${t.id}`).toBeLessThanOrEqual(p.height - 40);
          expect(t.y, `${p.name} ${t.id}`).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it("contraste WCAG AA de todos os textos sobre o que está atrás", () => {
    for (const { doc } of built) {
      doc.pages.forEach((p, i) => {
        for (const t of texts(p)) {
          if (t.name.startsWith(DECORATIVE)) continue;
          const color = t.color as string;
          for (const bg of backgroundsUnder(doc, i, t)) {
            expect(contrast(color, bg), `${p.name} ${t.id} ${color} sobre ${bg}`).toBeGreaterThanOrEqual(
              minContrast(t.fontSize, t.fontWeight) - 0.01,
            );
          }
        }
      });
    }
  });

  it("tudo editável: textos são objetos de texto e ícones são caminhos (nada achatado em imagem)", () => {
    const { doc } = built[1]!;
    expect(doc.pages.flatMap((p) => p.objects).some((o) => o.type === "image")).toBe(false);
    expect(doc.pages.flatMap((p) => texts(p)).length).toBeGreaterThan(20);
    expect(doc.pages.flatMap((p) => p.objects).some((o) => o.type === "path" && o.name === "Ícone")).toBe(true);
  });

  it("quantidade de slides pedida e formato quadrado", () => {
    const { doc, meta } = build("Dicas de produtividade no home office", { slides: 5, format: "square" });
    expect(doc.pages).toHaveLength(5);
    expect(meta.slides).toHaveLength(5);
    expect(doc.pages[0]).toMatchObject({ width: FORMAT_SIZE.square.width, height: FORMAT_SIZE.square.height });
  });
});

describe("gerador de carrosséis — dados e identidade", () => {
  it("número das referências entra como dado (a confirmar); número inventado sai", () => {
    const withRef = build("Energia solar residencial", {
      references:
        "Segundo a pesquisa da associação do setor, 72% dos consumidores querem reduzir a conta de luz (Associação Exemplo, 2025).",
    });
    const data = withRef.meta.slides.find((s) => s.role === "data");
    expect(data?.stat?.value).toBe("72%");
    expect(data?.stat?.source).toContain("Associação Exemplo");

    // Resposta "da IA" com número sem respaldo nas referências.
    const input = {
      topic: "Energia solar",
      objective: "",
      audience: "",
      slides: null,
      tone: "",
      format: "portrait" as const,
      clientId: null,
      useIdentity: false,
      references: "",
      fileIds: [],
      images: "auto" as const,
    };
    const ai = aiPlanSchema.parse({
      title: "Energia solar",
      slides: [
        { role: "cover", title: "Energia solar", visual: { kind: "icon", prompt: "", icon: "sun" } },
        {
          role: "data",
          title: "Economia",
          stat: { value: "95%", label: "de economia garantida", source: "" },
          visual: { kind: "icon", prompt: "", icon: "" },
        },
        {
          role: "insight",
          title: "Reduza a conta em 40% já no primeiro mês",
          body: "",
          visual: { kind: "icon", prompt: "", icon: "" },
        },
        { role: "cta", title: "Fale com a gente", visual: { kind: "icon", prompt: "", icon: "" } },
      ],
    });
    let n = 0;
    const norm = normalizePlan(ai, input, {
      imagesAvailable: false,
      newKey: (i) => `s${i + 1}`,
      newPageId: () => `p${++n}`,
    });
    expect(norm.slides[1]!.stat).toBeNull();
    expect(norm.slides[1]!.role).toBe("insight");
    expect(norm.warnings.join(" ")).toContain("95%");
    expect(norm.claims.some((c) => c.text.includes("40%"))).toBe(true);
    expect(numbersIn("R$ 1.500,50 e 12%")).toEqual(new Set(["1500.5", "12"]));
  });

  it("identidade do cliente: cores, fontes e logo do cliente (nunca a da agência)", () => {
    const logo = {
      fileId: "11111111-1111-4111-8111-111111111111",
      versionId: "22222222-2222-4222-8222-222222222222",
      width: 400,
      height: 120,
    };
    const identity: BrandIdentity = {
      name: "Clínica Vitta",
      colors: ["#0B6E4F", "#F2C14E", "#FFFFFF"],
      fonts: ["Poppins", "Inter"],
      handle: "Clínica Vitta",
      logo,
    };
    const { doc, meta } = build("Clareamento dental: mitos e cuidados", { identity });
    expect(meta.direction.fromIdentity).toBe(true);
    expect(meta.direction.fonts.heading).toBe("Poppins");
    const p = meta.direction.palette;
    const brand = ["#0B6E4F", "#F2C14E"];
    // Fundo ou destaque saem das cores da marca (o fundo claro é um tom da cor principal).
    expect(
      brand.includes(p.accent) ||
        brand.includes(p.bg) ||
        contrast(p.bg, mix("#0B6E4F", "#FFFFFF", 0.92)) < 1.05 ||
        brand.includes(p.accent2),
    ).toBe(true);
    const logos = doc.pages
      .flatMap((pg) => pg.objects)
      .filter((o) => o.type === "image" && o.name === "Logo do cliente");
    expect(logos.length).toBeGreaterThan(0);
    expect(logos.every((o) => o.type === "image" && o.src === `/api/files/${logo.versionId}`)).toBe(true);
    expect(JSON.stringify(doc)).not.toContain("org-logo");
  });

  it("textos editados no editor são mantidos ao trocar a direção visual", () => {
    const { doc, meta } = build("Café especial em casa");
    const page = doc.pages[1]!;
    const title = texts(page).find((t) => t.id === `${meta.slides[1]!.key}-title`)!;
    title.text = "Título reescrito pela equipe";
    const slides = currentSlides(doc, meta);
    expect(slides[1]!.title).toBe("Título reescrito pela equipe");
    // Título em maiúsculas pelo estilo volta à grafia original.
    const kicker = texts(doc.pages[0]!).find((t) => t.id.endsWith("-kicker"));
    if (kicker) expect(slides[0]!.kicker).toBe(meta.slides[0]!.kicker);
  });
});

describe("ajuste de texto", () => {
  it("reduz o corpo até caber e mede como o editor (corpo × 1,13 × entrelinha)", () => {
    const box = {
      text: "Um título bem longo para caber em poucas linhas no slide",
      width: 800,
      fontFamily: "Inter",
      fontWeight: 800,
      lineHeight: 1.1,
    };
    const f = fitText(box, 300, 120, 40);
    expect(f.overflow).toBe(false);
    expect(f.height).toBeLessThanOrEqual(300);
    expect(f.fontSize).toBeLessThan(120);
    const one = measure({ ...box, text: "Oi" }, 100);
    expect(one.lines).toBe(1);
    expect(one.height).toBeGreaterThanOrEqual(113);
  });
});
