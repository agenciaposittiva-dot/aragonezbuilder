import { createDocument, type DesignDocument, type DesignObject } from "@/lib/design-doc";
import { lineHeightFor, photo, rect, text, type Placeholders } from "./kit";

/*
 * Minimal escuro: fundo preto, rótulos no topo e no rodapé, selo do perfil,
 * título que mistura peso fino e negrito, caixa de apoio e chamada para a legenda.
 * Larguras medidas com as fontes reais para os trechos lado a lado.
 */

const W = 1080;
const H = 1350;
const ORANGE = "#F08A24";
const LABEL = { fontFamily: "Inter", fontSize: 27, fontWeight: 300, color: "#EDEDED" };
const HEAD = {
  fontFamily: "Inter",
  fontSize: 107,
  letterSpacing: -30,
  lineHeight: lineHeightFor(107, 96),
  color: "#FFFFFF",
};
const BOX = { fontFamily: "Inter", fontSize: 34, letterSpacing: -10, color: "#FFFFFF" };
const CTA = { fontFamily: "Inter", fontSize: 30, letterSpacing: 200 };

function labels(baseline: number, prefix: string): DesignObject[] {
  return [
    text({ ...LABEL, name: `${prefix}: esquerda`, text: "Design", x: 102, width: 280, baseline }),
    text({ ...LABEL, name: `${prefix}: centro`, text: "Marca", x: 390, width: 300, baseline, textAlign: "center" }),
    text({ ...LABEL, name: `${prefix}: direita`, text: "Seu nome", x: 695, width: 280, baseline, textAlign: "right" }),
  ];
}

export function minimalDark(ph: Placeholders): DesignDocument {
  const X = 196;
  const boxText = 222;
  return createDocument({
    preset: "ig-portrait",
    pages: [
      {
        width: W,
        height: H,
        name: "Post",
        background: {
          type: "radial",
          stops: [
            { offset: 0, color: "#171717" },
            { offset: 1, color: "#090909" },
          ],
        },
        objects: [
          ...labels(104, "Topo"),
          rect({
            name: "Selo do perfil",
            x: X,
            y: 406,
            width: 130,
            height: 37,
            radius: 18.5,
            fill: "rgba(255,255,255,0.03)",
            stroke: "rgba(255,255,255,0.75)",
            strokeWidth: 1.5,
          }),
          photo({
            id: "foto-perfil",
            name: "Foto do perfil (Trocar imagem)",
            src: ph.avatar!,
            x: X + 6,
            y: 411,
            width: 27,
            height: 27,
            radius: 13.5,
          }),
          text({
            name: "@ do perfil",
            text: "@seuperfil",
            fontFamily: "Inter",
            fontSize: 15,
            color: "#DADADA",
            x: X + 41,
            width: 120,
            baseline: 429,
          }),
          // Linha 1 e 2 em peso fino; "o que" em negrito ao lado de "compram" (442 px medidos + espaço).
          text({
            ...HEAD,
            name: "Título: fino",
            text: "Pessoas não\ncompram",
            fontWeight: 200,
            x: X,
            width: 760,
            baseline: 558,
          }),
          text({
            ...HEAD,
            name: "Título: negrito ao lado",
            text: "o que",
            fontWeight: 700,
            x: X + 470,
            width: 400,
            baseline: 654,
          }),
          text({
            ...HEAD,
            name: "Título: negrito",
            text: "não entendem.",
            fontWeight: 700,
            x: X,
            width: 820,
            baseline: 750,
          }),
          rect({
            name: "Caixa de apoio",
            x: X,
            y: 794,
            width: 26 + 150 + 334 + 26,
            height: 84,
            radius: 20,
            fill: "rgba(255,255,255,0.07)",
            stroke: "rgba(255,255,255,0.6)",
            strokeWidth: 1.5,
          }),
          text({
            ...BOX,
            name: "Apoio: leve",
            text: "E clareza",
            fontWeight: 300,
            x: boxText,
            width: 160,
            baseline: 846,
          }),
          text({
            ...BOX,
            name: "Apoio: negrito",
            text: "começa pelo design.",
            fontWeight: 600,
            x: boxText + 150,
            width: 360,
            baseline: 846,
          }),
          text({
            ...CTA,
            name: "Chamada: destaque",
            text: "Leia",
            fontWeight: 700,
            color: ORANGE,
            x: X,
            width: 110,
            baseline: 938,
          }),
          text({
            ...CTA,
            name: "Chamada",
            text: "a legenda",
            fontWeight: 300,
            color: "#FFFFFF",
            x: X + 98,
            width: 220,
            baseline: 938,
          }),
          text({
            name: "Chamada: seta",
            text: "↘",
            fontFamily: "Inter",
            fontSize: 30,
            color: ORANGE,
            x: X + 98 + 205,
            width: 40,
            baseline: 938,
          }),
          ...labels(1265, "Rodapé"),
        ],
      },
    ],
  });
}
