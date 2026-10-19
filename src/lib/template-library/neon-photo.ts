import { createDocument, type DesignDocument } from "@/lib/design-doc";
import { circle, lineHeightFor, path, photo, rect, SEND_D, text, type Placeholders } from "./kit";

/*
 * Foto escura com detalhes neon: perfil e serviços no topo, título em minúsculas
 * com uma linha marcada como seleção, frase de apoio e botão de contato.
 */

const W = 1080;
const H = 1350;
const LIME = "#C6F432";
const INK = "#10210F";
const HEAD = { fontFamily: "Plus Jakarta Sans", fontSize: 84, fontWeight: 800 };
const PILL = {
  fontFamily: "Plus Jakarta Sans",
  fontSize: 21,
  fontWeight: 500,
  color: INK,
  textAlign: "center" as const,
};
const CTA = { fontFamily: "Plus Jakarta Sans", fontSize: 19, letterSpacing: -20, color: INK };

export function neonPhoto(ph: Placeholders): DesignDocument {
  // Pílulas: largura do texto (medida) + 32, alinhadas à direita em x = 972.
  const pills = [
    { label: "Social Media", w: 160 },
    { label: "Filmmaker", w: 136 },
    { label: "Fotógrafo", w: 134 },
  ];
  let px = 972 - pills.reduce((n, p) => n + p.w, 0) - 24 * (pills.length - 1);
  const pillObjects = pills.flatMap((p, i) => {
    const x = px;
    px += p.w + 24;
    return [
      rect({ name: `Serviço ${i + 1}: fundo`, x, y: 117, width: p.w, height: 32, radius: 16, fill: LIME }),
      text({ ...PILL, name: `Serviço ${i + 1}`, text: p.label, x, width: p.w, baseline: 140 }),
    ];
  });
  const X = 189;
  const pitch = 78;
  const first = 560;
  const ctaX = 665;
  return createDocument({
    preset: "ig-portrait",
    pages: [
      {
        width: W,
        height: H,
        name: "Post",
        background: "#071314",
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
            name: "Sombra do texto",
            x: 0,
            y: 0,
            width: W,
            height: H,
            fill: {
              type: "linear",
              angle: 0,
              stops: [
                { offset: 0, color: "rgba(0,0,0,0.55)" },
                { offset: 0.7, color: "rgba(0,0,0,0.15)" },
                { offset: 1, color: "rgba(0,0,0,0.05)" },
              ],
            },
            locked: true,
          }),
          photo({
            id: "foto-perfil",
            name: "Foto do perfil (Trocar imagem)",
            src: ph.avatar!,
            x: 108,
            y: 101,
            width: 64,
            height: 64,
            radius: 32,
            stroke: LIME,
            strokeWidth: 4,
          }),
          text({
            name: "@ do perfil",
            text: "@seuperfil",
            fontFamily: "Plus Jakarta Sans",
            fontSize: 24,
            fontWeight: 500,
            color: "#FFFFFF",
            x: 184,
            width: 260,
            baseline: 141,
          }),
          ...pillObjects,
          // Marcação da 2ª linha ("não é gasto", 472 px), como uma seleção.
          rect({
            name: "Destaque: marcação",
            x: X - 8,
            y: first + pitch - 72,
            width: 488,
            height: 92,
            fill: "rgba(198,244,50,0.55)",
            stroke: LIME,
            strokeWidth: 2,
          }),
          circle({ name: "Destaque: ponto 1", x: X - 15, y: first + pitch - 79, width: 14, height: 14, fill: LIME }),
          circle({ name: "Destaque: ponto 2", x: X + 473, y: first + pitch + 13, width: 14, height: 14, fill: LIME }),
          text({
            ...HEAD,
            name: "Título",
            text: "design bom\nnão é gasto\né o que faz\nseu cliente\nvoltar",
            color: "#FFFFFF",
            lineHeight: lineHeightFor(84, pitch),
            x: X,
            width: 700,
            baseline: first,
          }),
          text({
            name: "Frase de apoio",
            text: "e indicar você pra outros",
            fontFamily: "Plus Jakarta Sans",
            fontSize: 32,
            color: LIME,
            x: X,
            width: 640,
            baseline: first + pitch * 4 + 46,
          }),
          rect({ name: "Contato: fundo", x: ctaX, y: 1196, width: 335, height: 70, radius: 14, fill: LIME }),
          text({
            ...CTA,
            name: "Contato: linha 1",
            text: "entre em contato pelo",
            x: ctaX + 22,
            width: 300,
            baseline: 1225,
          }),
          text({ ...CTA, name: "Contato: linha 2", text: "link na bio e", x: ctaX + 22, width: 120, baseline: 1250 }),
          text({
            ...CTA,
            name: "Contato: destaque",
            text: "peça seu orçamento",
            fontWeight: 700,
            x: ctaX + 22 + 101,
            width: 210,
            baseline: 1250,
          }),
          circle({
            name: "Contato: ícone fundo",
            x: 965,
            y: 1168,
            width: 42,
            height: 42,
            fill: "#FFFFFF",
            stroke: LIME,
            strokeWidth: 3,
          }),
          path({
            name: "Contato: ícone",
            d: SEND_D,
            viewBox: [0, 0, 24, 24],
            stroke: "#1E7A3A",
            strokeWidth: 2.2,
            lineCap: "round",
            lineJoin: "round",
            x: 976,
            y: 1179,
            width: 20,
            height: 20,
          }),
        ],
      },
    ],
  });
}
