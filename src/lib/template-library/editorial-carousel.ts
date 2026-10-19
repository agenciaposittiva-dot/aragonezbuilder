import { createDocument, type DesignDocument, type DesignObject } from "@/lib/design-doc";
import { ARROW_D, BOOKMARK_D, lineHeightFor, path, photo, rect, text, type Placeholders } from "./kit";

/*
 * Carrossel editorial claro (5 páginas): capa com foto, páginas de texto em
 * fundo cinza-claro, página com imagem de destaque, página com bloco de imagem
 * e página final com chamada para salvar. Cabeçalho e rodapé iguais em todas.
 */

const W = 1080;
const H = 1350;
const INK = "#1C1C1C";
const PAPER = "#EFEFEF";
const GREEN = "#3DDC6E";
const SMALL = { fontFamily: "Inter", fontSize: 16, fontWeight: 500 };
const BODY = { fontFamily: "Inter", fontSize: 46, fontWeight: 600, letterSpacing: -20, color: INK };
const SERIF = { fontFamily: "Instrument Serif", fontStyle: "italic" as const };

/** Cabeçalho e rodapé (cor clara na capa com foto). */
function chrome(color: string, footerRight: "brand" | "handle"): DesignObject[] {
  return [
    text({
      ...SMALL,
      name: "Topo: frase",
      text: "Sua frase de posicionamento aqui",
      color,
      x: 50,
      width: 420,
      baseline: 97,
    }),
    rect({
      name: "Topo: pílula",
      x: 594,
      y: 68,
      width: 63,
      height: 29,
      radius: 14.5,
      fill: null,
      stroke: color,
      strokeWidth: 2.2,
    }),
    path({
      name: "Topo: seta",
      d: ARROW_D,
      viewBox: [0, 0, 24, 24],
      stroke: color,
      strokeWidth: 2.2,
      lineCap: "round",
      lineJoin: "round",
      x: 612,
      y: 70,
      width: 26,
      height: 25,
    }),
    text({
      ...SMALL,
      name: "Topo: ano",
      text: "2026 ©●↗",
      color,
      x: 853,
      width: 180,
      baseline: 82,
      textAlign: "right",
    }),
    text({
      ...SMALL,
      name: "Rodapé: assinatura",
      text: "Seu Nome | Sua Agência",
      color,
      x: 50,
      width: 420,
      baseline: 1283,
    }),
    footerRight === "brand"
      ? text({
          name: "Rodapé: marca",
          text: "Marca©",
          fontFamily: "Inter",
          fontSize: 28,
          fontWeight: 700,
          letterSpacing: -20,
          color,
          x: 796,
          width: 240,
          baseline: 1284,
          textAlign: "right",
        })
      : text({
          ...SMALL,
          name: "Rodapé: perfil",
          text: "@seuperfil",
          color,
          x: 806,
          width: 240,
          baseline: 1283,
          textAlign: "right",
        }),
  ];
}

export function editorialCarousel(ph: Placeholders): DesignDocument {
  const bodyLh = lineHeightFor(46, 62.5);
  // Capa: "com" (196 px) + "propósito!" (362 px) centralizados na 3ª linha.
  const coverRow = Math.round((W - 196 - 362) / 2);
  // Página 2: "Identidade" (258 px) + " não é só um logo." (386 px) centralizados.
  const titleRow = Math.round((W - 258 - 386) / 2);
  return createDocument({
    preset: "carousel-portrait",
    carousel: true,
    pages: [
      {
        width: W,
        height: H,
        name: "Capa",
        background: "#B8B8B8",
        objects: [
          photo({
            id: "foto-capa",
            name: "Foto da capa (Trocar imagem)",
            src: ph.cover!,
            x: 0,
            y: 0,
            width: W,
            height: H,
          }),
          rect({
            name: "Sombra da capa",
            x: 0,
            y: 0,
            width: W,
            height: H,
            fill: {
              type: "linear",
              angle: 90,
              stops: [
                { offset: 0, color: "rgba(0,0,0,0.28)" },
                { offset: 0.3, color: "rgba(0,0,0,0)" },
                { offset: 0.5, color: "rgba(0,0,0,0.12)" },
                { offset: 1, color: "rgba(0,0,0,0.55)" },
              ],
            },
            locked: true,
          }),
          text({
            name: "Título",
            text: "Marcas lembradas\nsão construídas",
            fontFamily: "Inter",
            fontSize: 88,
            fontWeight: 600,
            letterSpacing: -30,
            lineHeight: lineHeightFor(88, 91),
            color: "#FFFFFF",
            textAlign: "center",
            x: 40,
            width: 1000,
            baseline: 815,
          }),
          text({
            name: "Título: linha 3",
            text: "com",
            fontFamily: "Inter",
            fontSize: 88,
            fontWeight: 600,
            letterSpacing: -30,
            color: "#FFFFFF",
            x: coverRow,
            width: 210,
            baseline: 1002,
          }),
          text({
            ...SERIF,
            name: "Título: destaque",
            text: "propósito!",
            fontSize: 100,
            color: "#FFFFFF",
            x: coverRow + 196,
            width: 420,
            baseline: 1002,
          }),
          text({
            name: "Subtítulo",
            text: "Quanto mais coerente você aparece,\nmais fácil é ser escolhido.",
            fontFamily: "Inter",
            fontSize: 26,
            fontWeight: 500,
            lineHeight: lineHeightFor(26, 36),
            color: "#FFFFFF",
            textAlign: "center",
            x: 140,
            width: 800,
            baseline: 1114,
          }),
          ...chrome("#FFFFFF", "brand"),
        ],
      },
      {
        width: W,
        height: H,
        name: "Ideia",
        background: PAPER,
        objects: [
          text({
            ...SERIF,
            name: "Título: destaque",
            text: "Identidade",
            fontSize: 66,
            color: INK,
            x: titleRow,
            width: 290,
            baseline: 279,
          }),
          text({
            ...BODY,
            name: "Título",
            text: "não é só um logo.",
            x: titleRow + 258 + 12,
            width: 420,
            baseline: 279,
          }),
          text({
            ...BODY,
            name: "Texto",
            text: "É tudo o que faz o público\nreconhecer você de longe.",
            lineHeight: lineHeightFor(46, 62),
            textAlign: "center",
            x: 140,
            width: 800,
            baseline: 408,
          }),
          photo({
            id: "imagem-destaque",
            name: "Imagem de destaque (Trocar imagem — de preferência PNG sem fundo)",
            src: ph.object!,
            x: 254,
            y: 566,
            width: 572,
            height: 784,
            radius: 24,
          }),
          ...chrome(INK, "brand"),
        ],
      },
      {
        width: W,
        height: H,
        name: "Desenvolvimento",
        background: PAPER,
        objects: [
          text({
            ...BODY,
            name: "Texto",
            text: "Quando cada post tem uma\ncara diferente, o seu feed\nvira um mural de testes.\n\nE ninguém cria vínculo com\nquem muda o tempo todo.",
            lineHeight: bodyLh,
            x: 51,
            width: 940,
            baseline: 529,
          }),
          ...chrome(INK, "brand"),
        ],
      },
      {
        width: W,
        height: H,
        name: "Exemplo",
        background: PAPER,
        objects: [
          photo({
            id: "imagem-bloco",
            name: "Imagem do exemplo (Trocar imagem)",
            src: ph.block!,
            x: 51,
            y: 185,
            width: 981,
            height: 398,
            radius: 18,
          }),
          text({
            ...BODY,
            name: "Texto",
            text: "Lembre das marcas que você\nreconhece só pela cor.\n\nIsso é resultado de método.\n\nRepetir cores, fontes e\nformas cria memória visual.",
            lineHeight: bodyLh,
            x: 51,
            width: 940,
            baseline: 713,
          }),
          ...chrome(INK, "brand"),
        ],
      },
      {
        width: W,
        height: H,
        name: "Final",
        background: PAPER,
        objects: [
          text({
            name: "Título",
            text: "Lembrança de marca\né construída com\nrepetição",
            fontFamily: "Inter",
            fontSize: 80,
            letterSpacing: -30,
            lineHeight: lineHeightFor(80, 91),
            color: INK,
            textAlign: "center",
            x: 40,
            width: 1000,
            baseline: 485,
          }),
          text({
            name: "Subtítulo",
            text: "Não com sorte.",
            fontFamily: "Inter",
            fontSize: 42,
            letterSpacing: -20,
            color: INK,
            textAlign: "center",
            x: 140,
            width: 800,
            baseline: 786,
          }),
          rect({
            name: "Chamada: contorno",
            x: 234,
            y: 864,
            width: 612,
            height: 132,
            radius: 66,
            fill: null,
            stroke: GREEN,
            strokeWidth: 6,
          }),
          path({
            name: "Chamada: ícone",
            d: BOOKMARK_D,
            viewBox: [0, 0, 24, 24],
            stroke: INK,
            strokeWidth: 2,
            lineJoin: "round",
            x: 298,
            y: 904,
            width: 52,
            height: 52,
          }),
          text({
            name: "Chamada",
            text: "Salve este post para revisar a\nidentidade visual da sua marca.",
            fontFamily: "Inter",
            fontSize: 27,
            fontWeight: 700,
            letterSpacing: -10,
            lineHeight: lineHeightFor(27, 36),
            color: INK,
            x: 374,
            width: 460,
            baseline: 921,
          }),
          ...chrome(INK, "handle"),
        ],
      },
    ],
  });
}
