import { createDocument, type DesignDocument } from "@/lib/design-doc";
import { CHECK_D, lineHeightFor, path, photo, rect, text, VERIFIED_D, type Placeholders } from "./kit";

/*
 * Capa de impacto: foto de fundo, faixa de informações no topo, selo do perfil
 * e título grande condensado com a última linha em destaque.
 */

const W = 1080;
const H = 1350;
const ACCENT = "#FF4A1C";
const HEAD = { fontFamily: "Anton", fontSize: 120, lineHeight: lineHeightFor(120, 120), textAlign: "center" as const };
const META = { fontFamily: "Inter", fontSize: 19, fontWeight: 500, letterSpacing: -20, color: "#FFFFFF" };
const SUB = { fontFamily: "Barlow Condensed", fontSize: 32, fontWeight: 600, lineHeight: lineHeightFor(32, 40) };

export function impactCover(ph: Placeholders): DesignDocument {
  // Selo: foto 58 + 15 + @perfil (150) + 10 + verificado 30, centralizado.
  const chipX = Math.round((W - 263) / 2);
  return createDocument({
    preset: "ig-portrait",
    pages: [
      {
        width: W,
        height: H,
        name: "Capa",
        background: "#1E2433",
        objects: [
          photo({
            id: "foto-fundo",
            name: "Foto de fundo (Trocar imagem)",
            src: ph.photo!,
            x: 0,
            y: 0,
            width: W,
            height: H,
          }),
          rect({
            name: "Sombra do topo",
            x: 0,
            y: 0,
            width: W,
            height: 260,
            fill: {
              type: "linear",
              angle: 90,
              stops: [
                { offset: 0, color: "rgba(0,0,0,0.45)" },
                { offset: 1, color: "rgba(0,0,0,0)" },
              ],
            },
            locked: true,
          }),
          rect({
            name: "Sombra do texto",
            x: 0,
            y: 480,
            width: W,
            height: H - 480,
            fill: {
              type: "linear",
              angle: 90,
              stops: [
                { offset: 0, color: "rgba(0,0,0,0)" },
                { offset: 0.45, color: "rgba(0,0,0,0.6)" },
                { offset: 1, color: "rgba(0,0,0,0.92)" },
              ],
            },
            locked: true,
          }),
          text({ ...META, name: "Topo: esquerda", text: "Powered by Sua Agência", x: 44, width: 420, baseline: 60 }),
          text({ ...META, name: "Topo: centro", text: "@seuperfil", x: 657, width: 240, baseline: 60 }),
          text({
            ...META,
            name: "Topo: direita",
            text: "Janeiro 2026®",
            x: 796,
            width: 240,
            baseline: 60,
            textAlign: "right",
          }),
          photo({
            id: "foto-perfil",
            name: "Foto do perfil (Trocar imagem)",
            src: ph.avatar!,
            x: chipX,
            y: 576,
            width: 58,
            height: 58,
            radius: 29,
          }),
          text({
            name: "@ do perfil",
            text: "@seuperfil",
            fontFamily: "Inter",
            fontSize: 30,
            fontWeight: 500,
            letterSpacing: -20,
            color: "#FFFFFF",
            x: chipX + 73,
            width: 200,
            baseline: 616,
          }),
          path({
            name: "Selo de verificado",
            d: VERIFIED_D,
            viewBox: [0, 0, 24, 24],
            fill: "#3897F0",
            x: chipX + 233,
            y: 590,
            width: 30,
            height: 30,
          }),
          path({
            name: "Visto do selo",
            d: CHECK_D,
            viewBox: [0, 0, 24, 24],
            stroke: "#FFFFFF",
            strokeWidth: 2.4,
            lineCap: "round",
            lineJoin: "round",
            x: chipX + 233,
            y: 590,
            width: 30,
            height: 30,
          }),
          text({
            ...HEAD,
            name: "Título",
            text: "O ALGORITMO\nMUDOU DE NOVO E\nQUEM SOBREVIVE É",
            color: "#FFFFFF",
            x: 40,
            width: 1000,
            baseline: 800,
          }),
          text({
            ...HEAD,
            name: "Título: destaque",
            text: "QUEM TEM MARCA",
            color: ACCENT,
            x: 40,
            width: 1000,
            baseline: 1160,
          }),
          // Seta à esquerda da 1ª linha do subtítulo (largura medida: 430 px).
          text({
            ...SUB,
            name: "Seta",
            text: "→",
            color: ACCENT,
            x: Math.round((W - 431) / 2) - 40,
            width: 40,
            baseline: 1228,
          }),
          text({
            ...SUB,
            name: "Subtítulo",
            text: "POR QUE SEGUIDORES SEM ESTRATÉGIA\nNÃO PAGAM AS CONTAS DA SUA EMPRESA",
            color: "#FFFFFF",
            textAlign: "center",
            x: 40,
            width: 1000,
            baseline: 1228,
          }),
        ],
      },
    ],
  });
}
