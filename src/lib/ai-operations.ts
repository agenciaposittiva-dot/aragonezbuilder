/** Catálogo de operações do assistente (compartilhado com a interface). */

export type AiField = {
  key: string;
  label: string;
  type: "text" | "textarea" | "select" | "number";
  placeholder?: string;
  options?: string[];
  required?: boolean;
};

export type AiOperation = {
  key: string;
  label: string;
  description: string;
  group: "Planejamento" | "Conteúdo" | "Gestão" | "Chat";
  fields: AiField[];
  /** Saída estruturada (lista de tarefas) que exige revisão antes de criar registros. */
  structured?: boolean;
  needsProject?: boolean;
};

const CHANNELS = [
  "Instagram",
  "TikTok",
  "LinkedIn",
  "Facebook",
  "YouTube",
  "X",
  "E-mail",
  "Site / blog",
  "Google Ads",
  "Meta Ads",
];
const TONES = [
  "Da marca (perfil do cliente)",
  "Inspirador",
  "Divertido",
  "Profissional",
  "Urgente",
  "Educativo",
  "Emocional",
];

const topic: AiField = {
  key: "topic",
  label: "Tema / produto / oferta",
  type: "textarea",
  required: true,
  placeholder: "Ex.: lançamento do panetone artesanal para o Natal",
};
const channel: AiField = { key: "channel", label: "Canal", type: "select", options: CHANNELS };
const tone: AiField = { key: "tone", label: "Tom", type: "select", options: TONES };
const count: AiField = { key: "count", label: "Quantidade", type: "number", placeholder: "5" };

export const AI_OPERATIONS: AiOperation[] = [
  {
    key: "campaign_ideas",
    label: "Ideias de campanha",
    description: "Conceitos criativos com mote, mecânica e canais.",
    group: "Planejamento",
    fields: [
      topic,
      { key: "goal", label: "Objetivo", type: "text", placeholder: "Ex.: vender 300 unidades em dezembro" },
      count,
    ],
  },
  {
    key: "content_strategy",
    label: "Estratégia de conteúdo",
    description: "Pilares, formatos, frequência e indicadores.",
    group: "Planejamento",
    fields: [topic, { key: "period", label: "Período", type: "text", placeholder: "Ex.: próximo trimestre" }],
  },
  {
    key: "editorial_calendar",
    label: "Calendário editorial",
    description: "Pauta por data, canal, formato e tema.",
    group: "Planejamento",
    fields: [
      topic,
      channel,
      { key: "period", label: "Período", type: "text", placeholder: "Ex.: 1 a 31 de dezembro" },
      { key: "frequency", label: "Frequência", type: "text", placeholder: "Ex.: 3 posts por semana" },
    ],
  },
  {
    key: "briefing",
    label: "Briefing",
    description: "Briefing estruturado a partir de uma ideia solta.",
    group: "Planejamento",
    fields: [topic],
  },
  {
    key: "proposal",
    label: "Proposta comercial",
    description: "Escopo, entregáveis, cronograma e próximos passos.",
    group: "Planejamento",
    fields: [topic, { key: "budget", label: "Faixa de investimento", type: "text" }],
  },
  {
    key: "captions",
    label: "Legendas",
    description: "Legendas com gancho, desenvolvimento e CTA.",
    group: "Conteúdo",
    fields: [topic, channel, tone, count],
  },
  {
    key: "headlines",
    label: "Headlines",
    description: "Títulos curtos para anúncios, posts e páginas.",
    group: "Conteúdo",
    fields: [topic, tone, count],
  },
  {
    key: "ctas",
    label: "CTAs",
    description: "Chamadas para ação por objetivo.",
    group: "Conteúdo",
    fields: [topic, { key: "goal", label: "Ação desejada", type: "text", placeholder: "Ex.: agendar visita" }, count],
  },
  {
    key: "script",
    label: "Roteiro",
    description: "Roteiro de vídeo/reels com cenas e falas.",
    group: "Conteúdo",
    fields: [
      topic,
      { key: "duration", label: "Duração", type: "select", options: ["15 s", "30 s", "60 s", "3 min"] },
      channel,
      tone,
    ],
  },
  {
    key: "variations",
    label: "Variações de texto",
    description: "Versões de um texto para testes A/B.",
    group: "Conteúdo",
    fields: [{ key: "text", label: "Texto original", type: "textarea", required: true }, count, tone],
  },
  {
    key: "copy_review",
    label: "Revisão de texto",
    description: "Correção, clareza e aderência ao tom da marca.",
    group: "Conteúdo",
    fields: [{ key: "text", label: "Texto para revisar", type: "textarea", required: true }],
  },
  {
    key: "creative_suggestions",
    label: "Sugestões criativas",
    description: "Direção de arte, referências visuais e formatos.",
    group: "Conteúdo",
    fields: [topic, channel],
  },
  {
    key: "summary",
    label: "Resumo",
    description: "Resumo objetivo de reunião, briefing ou documento.",
    group: "Gestão",
    fields: [{ key: "text", label: "Conteúdo", type: "textarea", required: true }],
  },
  {
    key: "task_suggestions",
    label: "Sugestão de tarefas",
    description: "Etapas de produção para um projeto (você revisa antes de criar).",
    group: "Gestão",
    structured: true,
    needsProject: true,
    fields: [
      { key: "notes", label: "Observações", type: "textarea", placeholder: "Opcional: escopo, entregáveis, prazos" },
    ],
  },
];

/*
 * Operações do Chat da Equipe. Não aparecem no Assistente IA: o servidor monta
 * a conversa (só mensagens que a pessoa pode ver) e chama a geração.
 */
const transcript: AiField = { key: "transcript", label: "Conversa", type: "textarea", required: true };

export const CHAT_AI_OPERATIONS: AiOperation[] = [
  {
    key: "chat_summary",
    label: "Resumo da conversa",
    description: "Pontos principais, decisões e pendências.",
    group: "Chat",
    fields: [transcript],
  },
  {
    key: "chat_catch_up",
    label: "Resumo desde a última visita",
    description: "O que aconteceu enquanto você esteve fora.",
    group: "Chat",
    fields: [transcript],
  },
  {
    key: "chat_decisions",
    label: "Decisões e pendências",
    description: "Organiza o que foi decidido e o que falta fazer.",
    group: "Chat",
    fields: [transcript],
  },
  {
    key: "chat_tasks",
    label: "Tarefas sugeridas da conversa",
    description: "Tarefas extraídas da discussão (você revisa antes de criar).",
    group: "Chat",
    structured: true,
    fields: [transcript],
  },
  {
    key: "chat_reply",
    label: "Sugestão de resposta",
    description: "Rascunho de resposta para a conversa.",
    group: "Chat",
    fields: [transcript, { key: "draft", label: "O que você quer dizer", type: "textarea" }],
  },
  {
    key: "chat_rewrite",
    label: "Reescrever mensagem",
    description: "Mais clara e cordial, sem mudar o sentido.",
    group: "Chat",
    fields: [{ key: "draft", label: "Mensagem", type: "textarea", required: true }],
  },
  {
    key: "chat_ask",
    label: "Pergunta sobre as conversas",
    description: "Responde com base nas mensagens que você pode ver.",
    group: "Chat",
    fields: [transcript, { key: "question", label: "Pergunta", type: "textarea", required: true }],
  },
];

export function getOperation(key: string) {
  return AI_OPERATIONS.find((o) => o.key === key) ?? CHAT_AI_OPERATIONS.find((o) => o.key === key);
}
