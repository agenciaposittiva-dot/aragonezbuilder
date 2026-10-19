import type { DesignDocument } from "@/lib/design-doc";
import { editorialCarousel } from "./editorial-carousel";
import { impactCover } from "./impact-cover";
import type { PlaceholderSpec, Placeholders } from "./kit";
import { minimalDark } from "./minimal-dark";
import { neonPhoto } from "./neon-photo";

/*
 * Biblioteca de modelos prontos do Estúdio. Cada modelo é um documento editável
 * (textos, formas e imagens em camadas) montado a partir de referências enviadas
 * pela agência — sem copiar nomes, perfis, logos ou fotos de terceiros: textos e
 * imagens são de exemplo, para trocar. Ao adicionar, as imagens de exemplo são
 * geradas e salvas em Arquivos da agência e o modelo vira um template dela.
 */

export type LibraryTemplate = {
  key: string;
  /** Sobe quando o modelo muda (permite oferecer a versão nova). */
  version: number;
  name: string;
  description: string;
  category: string;
  pages: number;
  width: number;
  height: number;
  placeholders: Record<string, PlaceholderSpec>;
  build: (ph: Placeholders) => DesignDocument;
};

const PORTRAIT = { width: 1080, height: 1350 };

export const TEMPLATE_LIBRARY: LibraryTemplate[] = [
  {
    key: "capa-impacto",
    version: 1,
    name: "Capa de impacto",
    description: "Foto de fundo, selo do perfil e título grande condensado com a última linha em destaque.",
    category: "Capas",
    pages: 1,
    ...PORTRAIT,
    placeholders: {
      photo: { kind: "photo-dusk", ...PORTRAIT },
      avatar: { kind: "avatar", width: 240, height: 240 },
    },
    build: impactCover,
  },
  {
    key: "minimal-escuro",
    version: 1,
    name: "Minimal escuro",
    description: "Fundo preto, título com peso fino e negrito, caixa de apoio e chamada para a legenda.",
    category: "Frases",
    pages: 1,
    ...PORTRAIT,
    placeholders: { avatar: { kind: "avatar", width: 240, height: 240 } },
    build: minimalDark,
  },
  {
    key: "foto-neon",
    version: 1,
    name: "Foto escura com neon",
    description: "Perfil e serviços no topo, título em minúsculas com marcação neon e botão de contato.",
    category: "Serviços",
    pages: 1,
    ...PORTRAIT,
    placeholders: {
      photo: { kind: "photo-night", ...PORTRAIT },
      avatar: { kind: "avatar", width: 240, height: 240 },
    },
    build: neonPhoto,
  },
  {
    key: "carrossel-editorial-claro",
    version: 1,
    name: "Carrossel editorial claro",
    description:
      "5 páginas: capa com foto, ideia com imagem, desenvolvimento, exemplo e final com chamada para salvar.",
    category: "Carrosséis",
    pages: 5,
    ...PORTRAIT,
    placeholders: {
      cover: { kind: "photo-light", ...PORTRAIT },
      object: { kind: "object", width: 572, height: 784 },
      block: { kind: "block", width: 981, height: 398 },
    },
    build: editorialCarousel,
  },
];

export function findLibraryTemplate(key: string) {
  return TEMPLATE_LIBRARY.find((t) => t.key === key) ?? null;
}

export type { PlaceholderKind, PlaceholderSpec, Placeholders } from "./kit";
