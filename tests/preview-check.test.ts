import { describe, expect, it } from "vitest";
import { imageObject, rectObject, textObject } from "@/lib/design-doc";
import { contrastRatio, parseColor, runPreviewChecks, type CheckInput, type CheckSlide } from "@/lib/preview-check";
import { automaticProposal, conversionProposalSchema } from "@/lib/preview-convert";
import { closestFeedPlacement, defaultPlacement, NETWORK_KEYS, placementsOf, SOCIAL_SPECS } from "@/lib/social-specs";

const base = (o: Partial<CheckInput> = {}): CheckInput => ({
  network: "instagram",
  placement: "feed_portrait",
  slides: [],
  caption: "Legenda com chamada clara.",
  hashtags: ["#marca"],
  cta: "Comente",
  hasCaption: true,
  ...o,
});

const page = (o: Partial<CheckSlide> & Pick<CheckSlide, "key">): CheckSlide => ({
  label: o.key,
  width: 1080,
  height: 1350,
  objects: [],
  background: "#ffffff",
  ...o,
});

const title = (o: Parameters<typeof textObject>[0]) => textObject({ fontSize: 64, ...o });
const codes = (i: CheckInput) => runPreviewChecks(i).map((x) => x.code);

describe("especificações das redes", () => {
  it("cada rede tem formatos, limites de legenda e marca as aproximadas", () => {
    for (const n of NETWORK_KEYS) {
      const spec = SOCIAL_SPECS[n];
      expect(placementsOf(n).length).toBeGreaterThan(0);
      expect(spec.caption.max).toBeGreaterThan(spec.caption.preview);
      if (spec.fidelity === "approximate") expect(spec.notes.join(" ")).toMatch(/aproximada/i);
    }
    expect(SOCIAL_SPECS.instagram.placements.stories?.safeArea).toBeTruthy();
    // Nem toda rede tem todos os formatos (LinkedIn não tem Stories).
    expect(SOCIAL_SPECS.linkedin.placements.stories).toBeUndefined();
    expect(SOCIAL_SPECS.facebook.placements.carousel?.slides?.max).not.toBe(
      SOCIAL_SPECS.instagram.placements.carousel?.slides?.max,
    );
  });

  it("formato inicial: salvo, tipo da peça ou proporção da arte", () => {
    expect(defaultPlacement("instagram", { saved: "feed_square", pages: 1, width: 1080, height: 1350 })).toBe(
      "feed_square",
    );
    // Salvo que a rede não aceita é ignorado.
    expect(defaultPlacement("linkedin", { saved: "stories", pages: 1, width: 1080, height: 1080 })).toBe("feed_square");
    expect(defaultPlacement("instagram", { contentFormat: "stories", pages: 3, width: 1080, height: 1920 })).toBe(
      "stories",
    );
    expect(defaultPlacement("instagram", { contentFormat: "carousel", pages: 4, width: 1080, height: 1350 })).toBe(
      "carousel",
    );
    expect(closestFeedPlacement("instagram", 1200, 628)).toBe("feed_landscape");
    expect(closestFeedPlacement("instagram", 1000, 1000)).toBe("feed_square");
  });
});

describe("verificador da prévia", () => {
  it("post sem problemas não gera erro nem aviso", () => {
    const ok = page({
      key: "a",
      objects: [title({ text: "Título", x: 100, y: 200, width: 600 })],
    });
    const issues = runPreviewChecks(base({ slides: [ok] }));
    expect(issues.filter((i) => i.level !== "suggestion")).toEqual([]);
  });

  it("dimensões: proporção errada, baixa resolução e tamanhos diferentes no carrossel", () => {
    expect(codes(base({ slides: [page({ key: "q", width: 1080, height: 1080, objects: [] })] }))).toContain("ratio");
    expect(codes(base({ slides: [page({ key: "s", width: 640, height: 800 })] }))).toContain("low_resolution");
    const mixed = codes(
      base({
        placement: "carousel",
        slides: [page({ key: "1" }), page({ key: "2", width: 1080, height: 1080 })],
      }),
    );
    expect(mixed).toContain("carousel_size_mismatch");
    expect(codes(base({ placement: "carousel", slides: [page({ key: "1" })] }))).toContain("carousel_too_short");
    expect(codes(base({ slides: [page({ key: "1" }), page({ key: "2" })] }))).toContain("feed_multiple");
  });

  it("margens: texto cortado, perto da borda e fora da página (com a camada para abrir no editor)", () => {
    const cut = title({ id: "cut", text: "Passa da borda", x: 900, y: 300, width: 400 });
    const edge = title({ id: "edge", text: "Colado", x: 10, y: 600, width: 300 });
    const away = rectObject({ id: "away", x: 2000, y: 2000, width: 50, height: 50 });
    const issues = runPreviewChecks(base({ slides: [page({ key: "p", objects: [cut, edge, away] })] }));
    expect(issues.find((i) => i.code === "text_cut")).toMatchObject({ level: "error", slideKey: "p", objectId: "cut" });
    expect(issues.find((i) => i.code === "near_edge")).toMatchObject({ level: "warning", objectId: "edge" });
    expect(issues.find((i) => i.code === "outside")).toMatchObject({ objectId: "away" });
    // Erros vêm antes dos avisos e das sugestões.
    const order = issues.map((i) => i.level);
    expect(order.indexOf("error")).toBeLessThan(order.indexOf("warning"));
  });

  it("carrossel conectado: o que continua na página vizinha não é tratado como cortado", () => {
    const across = title({ id: "x", text: "Continua", x: 900, y: 300, width: 400 });
    const issues = runPreviewChecks(
      base({
        placement: "carousel",
        slides: [
          page({ key: "1", objects: [across], connected: { first: true, last: false } }),
          page({
            key: "2",
            objects: [title({ text: "Fim", x: 100, y: 300, width: 300 })],
            connected: { first: false, last: true },
          }),
        ],
      }),
    );
    expect(issues.map((i) => i.code)).not.toContain("text_cut");
  });

  it("Stories: área coberta pela interface e recurso interativo desenhado na arte", () => {
    const top = title({ id: "top", text: "No topo", x: 100, y: 80, width: 500 });
    const link = title({ id: "link", text: "Toque no link", x: 100, y: 900, width: 500 });
    const issues = runPreviewChecks(
      base({ placement: "stories", slides: [page({ key: "s", width: 1080, height: 1920, objects: [top, link] })] }),
    );
    expect(issues.find((i) => i.code === "unsafe_area")).toMatchObject({ objectId: "top" });
    expect(issues.find((i) => i.code === "simulated_sticker")).toMatchObject({ objectId: "link" });
  });

  it("legibilidade: contraste baixo, fonte pequena; sobre imagem não mede contraste", () => {
    const pale = title({ id: "pale", text: "Clarinho", x: 100, y: 300, width: 500, color: "#eeeeee" });
    const tiny = textObject({ id: "tiny", text: "Letra miúda", x: 100, y: 600, width: 500, fontSize: 14 });
    const issues = runPreviewChecks(base({ slides: [page({ key: "p", objects: [pale, tiny] })] }));
    expect(issues.find((i) => i.code === "contrast")).toMatchObject({ objectId: "pale" });
    expect(issues.find((i) => i.code === "small_text")).toMatchObject({ objectId: "tiny" });

    const photo = imageObject({ src: "/api/files/x", naturalWidth: 1080, naturalHeight: 1350, x: 0, y: 0 });
    const over = title({ text: "Sobre a foto", x: 100, y: 300, width: 500, color: "#eeeeee" });
    expect(codes(base({ slides: [page({ key: "p", objects: [photo, over] })] }))).not.toContain("contrast");
    expect(contrastRatio(parseColor("#000")!, parseColor("#fff")!)).toBeCloseTo(21, 0);
  });

  it("páginas duplicadas, margem diferente entre slides e logotipo cortado", () => {
    const t = (x: number) => [title({ text: "Mesmo texto", x, y: 300, width: 500 })];
    const issues = codes(
      base({
        placement: "carousel",
        slides: [
          page({ key: "1", objects: t(100) }),
          page({ key: "2", objects: t(100) }),
          page({ key: "3", objects: [title({ text: "Outro", x: 100, y: 300, width: 400 })] }),
          page({ key: "4", objects: [title({ text: "Deslocado", x: 400, y: 300, width: 400 })] }),
        ],
      }),
    );
    expect(issues).toContain("duplicate_slide");
    expect(issues).toContain("margin_mismatch");

    const logo = imageObject({
      name: "Logo",
      src: "/api/files/l",
      naturalWidth: 300,
      naturalHeight: 100,
      x: 950,
      y: 50,
    });
    expect(codes(base({ slides: [page({ key: "p", objects: [logo] })] }))).toContain("logo_cut");
  });

  it("logotipo obrigatório do cliente e arquivo incompatível", () => {
    const issues = codes(
      base({
        slides: [page({ key: "p", objects: [title({ text: "Sem logo", x: 100, y: 300, width: 500 })] })],
        brandLogoVersionIds: ["v-logo"],
      }),
    );
    expect(issues).toContain("brand_logo_missing");
    const pdf = codes(
      base({ slides: [{ key: "f", label: "Arquivo", width: 1080, height: 1350, mimeType: "application/pdf" }] }),
    );
    expect(pdf).toContain("media_type");
    const video = codes(
      base({
        placement: "stories",
        slides: [{ key: "v", label: "Vídeo", width: 1080, height: 1920, mimeType: "video/mp4" }],
      }),
    );
    expect(video).not.toContain("media_type");
  });

  it("legenda vazia, longa demais, hashtags demais e sem chamada", () => {
    const slides = [page({ key: "p", objects: [title({ text: "Ok", x: 100, y: 300, width: 300 })] })];
    expect(codes(base({ slides, caption: "" }))).toContain("caption_empty");
    expect(codes(base({ slides, caption: "x".repeat(2300) }))).toContain("caption_too_long");
    expect(codes(base({ slides, caption: "y".repeat(300) }))).toContain("caption_preview");
    expect(codes(base({ slides, hashtags: Array.from({ length: 31 }, (_, i) => `#t${i}`) }))).toContain(
      "hashtags_too_many",
    );
    expect(codes(base({ slides, cta: "" }))).toContain("cta_missing");
    expect(
      codes(base({ placement: "stories", slides: [page({ key: "s", width: 1080, height: 1920 })], caption: "" })),
    ).not.toContain("caption_empty");
    // Artes avulsas (sem peça) não têm legenda para verificar.
    expect(codes(base({ slides, caption: "", hasCaption: false }))).not.toContain("caption_empty");
  });

  it("exportação desatualizada ou faltando", () => {
    const slides = [page({ key: "p" })];
    expect(codes(base({ slides, exports: { stale: true, exported: 1, total: 1 } }))).toContain("export_stale");
    expect(codes(base({ slides, exports: { stale: false, exported: 0, total: 1 } }))).toContain("export_missing");
  });

  it("formato que a rede não tem e peça sem mídia", () => {
    expect(codes(base({ network: "linkedin", placement: "stories" }))).toEqual(["placement_unsupported"]);
    expect(codes(base({ slides: [] }))).toContain("no_media");
  });
});

describe("conversão automática (sem IA)", () => {
  const src = {
    title: "Café do festival",
    copy: "O festival chegou",
    caption: "Venha provar a bebida especial. Fica no centro. Aberto até tarde! #cafe",
    cta: "Passe aqui hoje",
  };

  it("feed → carrossel: capa, um ponto por página e a chamada no fim", () => {
    const p = automaticProposal(src, "carousel");
    expect(conversionProposalSchema.parse(p)).toBeTruthy();
    expect(p.slides[0]!.title).toBe("O festival chegou");
    expect(p.slides.map((s) => s.title)).toContain("Venha provar a bebida especial.");
    expect(p.slides.at(-1)!.title).toBe("Passe aqui hoje");
    expect(p.slides.some((s) => s.title.includes("#cafe"))).toBe(false);
    expect(p.caption).toBe(src.caption);
  });

  it("Stories tem no máximo 3 telas de conteúdo; feed vira uma página só", () => {
    const many = { ...src, slides: Array.from({ length: 8 }, (_, i) => ({ title: `Ponto ${i}`, text: "x" })) };
    expect(automaticProposal(many, "stories").slides).toHaveLength(1 + 3 + 1);
    expect(automaticProposal(many, "carousel").slides.length).toBeLessThanOrEqual(10);
    expect(automaticProposal(many, "feed").slides).toHaveLength(1);
  });
});
