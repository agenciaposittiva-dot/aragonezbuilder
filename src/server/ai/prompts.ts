import type { AiOperation } from "@/lib/ai-operations";

const BASE_SYSTEM = `Você é um estrategista e redator sênior de uma agência de marketing brasileira.
Escreva em português do Brasil, com clareza e linguagem natural, pronto para uso pela equipe.
Respeite o contexto da marca quando ele for fornecido e nunca invente dados sobre o cliente (preços, prêmios, números) que não estejam no pedido ou no contexto.
Formate com títulos curtos e listas quando ajudar a leitura (Markdown simples). Não inclua explicações sobre o seu processo.`;

const INSTRUCTIONS: Record<string, string> = {
  campaign_ideas:
    "Proponha ideias de campanha. Para cada uma: nome/mote, conceito, mecânica, canais e peças principais, e por que funciona para o objetivo.",
  content_strategy:
    "Monte uma estratégia de conteúdo: objetivos, pilares editoriais (com exemplos de temas), formatos por canal, frequência sugerida e indicadores de acompanhamento.",
  editorial_calendar:
    "Monte um calendário editorial em tabela Markdown com colunas: Data, Canal, Formato, Tema, Ideia/gancho. Distribua conforme o período e a frequência.",
  briefing:
    "Transforme a ideia em um briefing estruturado: contexto, objetivo, público, mensagem principal, entregáveis, canais/formatos, tom, referências sugeridas, prazos e critérios de aprovação. Marque como [a confirmar] o que faltar.",
  proposal:
    "Escreva uma proposta comercial: entendimento do desafio, solução proposta, escopo e entregáveis, cronograma, investimento (use a faixa informada; se não houver, deixe [a definir]) e próximos passos.",
  captions:
    "Escreva legendas prontas para publicar, cada uma com gancho na primeira linha, desenvolvimento curto, CTA e até 5 hashtags relevantes. Adapte ao canal.",
  headlines:
    "Escreva headlines curtas e variadas (benefício, curiosidade, urgência, prova social). Uma por linha, numeradas.",
  ctas: "Escreva CTAs curtas e específicas para a ação desejada, variando o tom. Uma por linha, numeradas.",
  script:
    "Escreva um roteiro em tabela Markdown com colunas: Tempo, Cena/visual, Fala/locução, Texto na tela. Abra com um gancho nos primeiros 3 segundos e feche com CTA.",
  variations:
    "Reescreva o texto original em variações para teste A/B, mudando abordagem (benefício, emoção, urgência, prova). Preserve a informação factual.",
  copy_review:
    "Revise o texto: corrija gramática e ortografia, melhore clareza e ritmo e alinhe ao tom da marca. Entregue: 1) versão revisada; 2) lista curta das principais mudanças.",
  creative_suggestions:
    "Sugira direções criativas: conceito visual, paleta (use as cores da marca se houver), tipografia, composição, referências de estilo e formatos recomendados por canal.",
  summary:
    "Resuma em tópicos objetivos: pontos principais, decisões, pendências e próximos passos (com responsáveis, se mencionados).",
  chat_summary:
    "A conversa abaixo é de uma equipe interna (formato [data hora] Pessoa: mensagem). Resuma em tópicos: assunto, pontos principais, decisões, pendências e próximos passos (com responsáveis quando citados). Não invente nada que não esteja nas mensagens.",
  chat_catch_up:
    "A conversa abaixo reúne as mensagens que a pessoa ainda não leu. Faça um resumo curto do que aconteceu, destacando perguntas dirigidas a ela, decisões e o que ficou pendente. Não invente nada que não esteja nas mensagens.",
  chat_decisions:
    "Com base apenas na conversa abaixo, organize em duas listas: 1) Decisões tomadas (quem decidiu, quando); 2) Pendências (o que falta, responsável e prazo se citados; marque [sem responsável] ou [sem prazo] quando não houver).",
  chat_tasks:
    'Extraia da conversa abaixo as tarefas de trabalho combinadas ou pedidas. Não crie tarefas que não foram discutidas e não invente prazos. Responda SOMENTE com JSON no formato {"tasks":[{"title":string,"description":string,"estimateMinutes":number}]} com 0 a 10 tarefas; use estimateMinutes 0 quando não houver estimativa.',
  chat_reply:
    "Escreva uma sugestão de resposta curta e cordial para a última mensagem da conversa abaixo, no tom da equipe. Se 'O que você quer dizer' foi informado, use como base. Entregue só o texto da resposta, sem aspas nem explicações.",
  chat_rewrite:
    "Reescreva a mensagem para ficar mais clara, objetiva e cordial, mantendo o sentido, os nomes e os números. Entregue só a mensagem reescrita, sem aspas nem explicações.",
  chat_ask:
    "Responda à pergunta usando apenas as mensagens da conversa abaixo. Cite quem disse e quando (data) quando ajudar. Se a resposta não estiver nas mensagens, diga claramente que não encontrou.",
  task_suggestions:
    'Sugira as tarefas de produção do projeto, em ordem, cobrindo planejamento, criação, revisão interna, aprovação do cliente e entrega. Responda SOMENTE com JSON no formato {"tasks":[{"title":string,"description":string,"estimateMinutes":number}]} com 3 a 12 tarefas.',
};

export const TASK_SUGGESTIONS_SCHEMA = {
  type: "object",
  properties: {
    tasks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          description: { type: "string" },
          estimateMinutes: { type: "integer" },
        },
        required: ["title", "description", "estimateMinutes"],
        additionalProperties: false,
      },
    },
  },
  required: ["tasks"],
  additionalProperties: false,
} as const;

export function buildPrompt(
  op: AiOperation,
  input: Record<string, string>,
  extra: { clientContext?: string; projectContext?: string },
) {
  const lines: string[] = [`Tarefa: ${op.label}.`, INSTRUCTIONS[op.key] ?? ""];
  for (const field of op.fields) {
    const value = input[field.key]?.trim();
    if (value) lines.push(`${field.label === "Tema / produto / oferta" ? "Tema" : field.label}: ${value}`);
  }
  if (extra.projectContext) lines.push("", extra.projectContext);
  if (extra.clientContext) lines.push("", extra.clientContext);
  return { system: BASE_SYSTEM, prompt: lines.filter((l) => l !== undefined).join("\n") };
}
