import type { BriefingField } from "@/server/db/schema";

type StatusSeed = {
  key: string;
  name: string;
  category: "backlog" | "todo" | "in_progress" | "review" | "done" | "cancelled";
  color: string;
  isDefault?: boolean;
};

export const DEFAULT_TASK_STATUSES: StatusSeed[] = [
  { key: "backlog", name: "Backlog", category: "backlog", color: "slate" },
  {
    key: "todo",
    name: "A fazer",
    category: "todo",
    color: "blue",
    isDefault: true,
  },
  {
    key: "doing",
    name: "Em produção",
    category: "in_progress",
    color: "amber",
  },
  {
    key: "internal_review",
    name: "Revisão interna",
    category: "review",
    color: "violet",
  },
  {
    key: "client_review",
    name: "Aprovação do cliente",
    category: "review",
    color: "pink",
  },
  {
    key: "adjustments",
    name: "Ajustes",
    category: "in_progress",
    color: "orange",
  },
  { key: "done", name: "Concluída", category: "done", color: "green" },
  { key: "cancelled", name: "Cancelada", category: "cancelled", color: "zinc" },
];

export const DEFAULT_PROJECT_STATUSES: StatusSeed[] = [
  {
    key: "planning",
    name: "Planejamento",
    category: "todo",
    color: "blue",
    isDefault: true,
  },
  {
    key: "active",
    name: "Em andamento",
    category: "in_progress",
    color: "amber",
  },
  { key: "review", name: "Em aprovação", category: "review", color: "violet" },
  { key: "paused", name: "Pausado", category: "backlog", color: "slate" },
  { key: "done", name: "Concluído", category: "done", color: "green" },
  { key: "cancelled", name: "Cancelado", category: "cancelled", color: "zinc" },
];

/** Transições válidas iniciais dos projetos (as organizações podem alterar). */
export const DEFAULT_PROJECT_TRANSITIONS: [string, string][] = [
  ["planning", "active"],
  ["planning", "paused"],
  ["planning", "cancelled"],
  ["active", "review"],
  ["active", "paused"],
  ["active", "done"],
  ["active", "cancelled"],
  ["review", "active"],
  ["review", "done"],
  ["paused", "planning"],
  ["paused", "active"],
  ["paused", "cancelled"],
  ["done", "active"],
  ["cancelled", "planning"],
];

const common: BriefingField[] = [
  {
    key: "mandatorios",
    label: "Informações obrigatórias",
    type: "textarea",
    help: "Logos, selos, textos legais, telefone, endereço...",
  },
];

export const DEFAULT_BRIEFING_TEMPLATES: {
  name: string;
  category:
    "design" | "social_media" | "video" | "campaign" | "presentation" | "branding" | "copy" | "website" | "other";
  description: string;
  fields: BriefingField[];
}[] = [
  {
    name: "Post para redes sociais",
    category: "social_media",
    description: "Peças de feed, stories e carrosséis.",
    fields: [
      {
        key: "redes",
        label: "Redes",
        type: "multiselect",
        required: true,
        options: ["Instagram", "Facebook", "LinkedIn", "TikTok", "X", "Pinterest"],
      },
      {
        key: "formatos",
        label: "Formatos",
        type: "multiselect",
        options: ["Feed 1:1", "Feed 4:5", "Stories 9:16", "Carrossel", "Reels"],
      },
      { key: "data_publicacao", label: "Data de publicação", type: "date" },
      {
        key: "legenda_pronta",
        label: "A legenda já está pronta?",
        type: "checkbox",
      },
      ...common,
    ],
  },
  {
    name: "Peça gráfica",
    category: "design",
    description: "Banners, flyers, anúncios, materiais impressos.",
    fields: [
      {
        key: "dimensoes",
        label: "Dimensões / formato",
        type: "text",
        required: true,
        placeholder: "Ex.: 1080×1350, A4, 3×1 m",
      },
      {
        key: "uso",
        label: "Onde a peça será usada",
        type: "select",
        options: ["Digital", "Impresso", "Ambos"],
      },
      { key: "acabamento", label: "Acabamento (se impresso)", type: "text" },
      ...common,
    ],
  },
  {
    name: "Vídeo",
    category: "video",
    description: "Roteiro, captação, edição e motion.",
    fields: [
      {
        key: "duracao",
        label: "Duração desejada",
        type: "select",
        required: true,
        options: ["Até 15 s", "15–30 s", "30–60 s", "1–3 min", "Mais de 3 min"],
      },
      {
        key: "proporcao",
        label: "Proporção",
        type: "multiselect",
        options: ["16:9", "9:16", "1:1", "4:5"],
      },
      { key: "tem_roteiro", label: "Já existe roteiro?", type: "checkbox" },
      { key: "trilha", label: "Referência de trilha", type: "url" },
      ...common,
    ],
  },
  {
    name: "Campanha",
    category: "campaign",
    description: "Campanhas integradas com várias peças e canais.",
    fields: [
      {
        key: "periodo",
        label: "Período da campanha",
        type: "text",
        required: true,
        placeholder: "Ex.: 01/11 a 30/11",
      },
      { key: "verba", label: "Verba de mídia prevista (R$)", type: "number" },
      { key: "kpis", label: "Indicadores de sucesso", type: "textarea" },
      {
        key: "oferta",
        label: "Oferta / mensagem principal",
        type: "textarea",
        required: true,
      },
      ...common,
    ],
  },
  {
    name: "Apresentação",
    category: "presentation",
    description: "Decks comerciais, institucionais e relatórios.",
    fields: [
      {
        key: "slides",
        label: "Quantidade aproximada de slides",
        type: "number",
      },
      {
        key: "conteudo_pronto",
        label: "O conteúdo já está escrito?",
        type: "checkbox",
      },
      {
        key: "formato_entrega",
        label: "Formato de entrega",
        type: "select",
        options: ["PDF", "PowerPoint", "Google Slides", "Keynote"],
      },
    ],
  },
  {
    name: "Identidade visual",
    category: "branding",
    description: "Criação ou revisão de marca.",
    fields: [
      {
        key: "historia",
        label: "História e valores da marca",
        type: "textarea",
        required: true,
      },
      { key: "concorrentes", label: "Concorrentes", type: "textarea" },
      {
        key: "entregaveis",
        label: "Entregáveis",
        type: "multiselect",
        options: ["Logotipo", "Paleta", "Tipografia", "Manual de marca", "Papelaria", "Templates"],
      },
    ],
  },
];
