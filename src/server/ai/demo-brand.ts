/*
 * Respostas estruturadas de exemplo do Radar de Marca (provedor de
 * demonstração). São determinísticas, não trazem números e se identificam
 * como "Modo demonstração": servem para testar o fluxo sem chave de IA.
 * Lê do pedido apenas as linhas montadas por brand-radar-ai.ts.
 */

function line(prompt: string, label: string) {
  return prompt.match(new RegExp(`^${label}: (.+)$`, "m"))?.[1]?.trim() ?? "";
}

function listLine(prompt: string, label: string) {
  const v = line(prompt, label);
  return !v || /^\(nenhum/.test(v) ? [] : v.split(/\s*[|,]\s*/).filter(Boolean);
}

const DEMO = "Modo demonstração";

function bioVersions(handle: string, niche: string, limit: number) {
  const subject = niche || "o seu negócio";
  const fit = (text: string) =>
    Array.from(text).length <= limit ? text : Array.from(text).slice(0, limit).join("").trim();
  return [
    {
      style: "direct",
      text: fit(
        `${subject.charAt(0).toUpperCase()}${subject.slice(1)} sem complicação.\nAtendimento próximo e resultado claro.\nFale com a gente pelo link`,
      ),
      objective: "Dizer em poucos segundos o que a marca faz e levar ao contato.",
      strengths: ["Clareza imediata", "Chamada para ação direta"],
      cta: "Fale com a gente pelo link",
      warnings: [`${DEMO}: texto de exemplo, confirme a oferta com o cliente.`],
    },
    {
      style: "strategic",
      text: fit(
        `Ajudamos quem busca ${subject} a decidir com segurança.\nConteúdo útil toda semana.\nAgende uma conversa`,
      ),
      objective: "Posicionar a marca como referência e reforçar a promessa principal.",
      strengths: ["Promessa de valor", "Diferencial explícito"],
      cta: "Agende uma conversa",
      warnings: [`${DEMO}: texto de exemplo, confirme o diferencial com o cliente.`],
    },
    {
      style: "creative",
      text: fit(`Onde ${subject} ganha personalidade.\nBastidores, dicas e novidades da @${handle}.\nVem ver no link`),
      objective: "Gerar identificação e curiosidade com um tom mais leve.",
      strengths: ["Tom memorável", "Convite à interação"],
      cta: "Vem ver no link",
      warnings: [`${DEMO}: texto de exemplo, valide o tom de voz com o cliente.`],
    },
  ];
}

const BIO_AUDIT = [
  { criterion: "Clareza do que a marca faz", assessment: "improve", note: `${DEMO}: avaliação de exemplo.` },
  { criterion: "Público e promessa", assessment: "improve", note: `${DEMO}: avaliação de exemplo.` },
  { criterion: "Chamada para ação", assessment: "missing", note: `${DEMO}: avaliação de exemplo.` },
];

function recommendations(handle: string) {
  return [
    {
      area: "bio",
      category: "fix_now",
      title: "Deixar a bio clara e com chamada para ação",
      problem: `${DEMO}: a bio precisa dizer o que a marca faz e o que a pessoa deve fazer em seguida.`,
      evidence: "Bio informada pela equipe.",
      evidenceSource: "Dados informados",
      basis: "hypothesis",
      impact: "alto",
      effort: "baixo",
      priority: 1,
      confidence: "medio",
      nextAction: "Escolher uma das versões sugeridas e enviar para aprovação do cliente.",
      howToTest: "Comparar os cliques no link nas duas semanas antes e depois da troca.",
    },
    {
      area: "highlights",
      category: "improve_soon",
      title: "Organizar os destaques por jornada do cliente",
      problem: `${DEMO}: os destaques devem responder às dúvidas de quem chega ao perfil.`,
      evidence: "Nomes dos destaques informados.",
      evidenceSource: "Dados informados",
      basis: "hypothesis",
      impact: "medio",
      effort: "medio",
      priority: 2,
      confidence: "medio",
      nextAction: "Criar as capas e os primeiros Stories dos destaques sugeridos.",
      howToTest: "Acompanhar se as perguntas repetidas no direct diminuem.",
    },
    {
      area: "content",
      category: "strategic",
      title: "Testar uma série de conteúdos de prova social",
      problem: `${DEMO}: hipótese de que depoimentos reais aumentam a confiança de quem visita @${handle}.`,
      evidence: "",
      evidenceSource: "",
      basis: "hypothesis",
      impact: "medio",
      effort: "medio",
      priority: 3,
      confidence: "baixo",
      nextAction: "Pedir autorização a clientes e montar um carrossel de depoimentos.",
      howToTest: "Publicar a série por quatro semanas e comparar salvamentos e mensagens com o período anterior.",
    },
    {
      area: "profile",
      category: "insufficient",
      title: "Conectar a conta para medir resultados",
      problem: "Sem métricas reais não é possível avaliar desempenho nem comparar períodos.",
      evidence: "",
      evidenceSource: "",
      basis: "insufficient",
      impact: "medio",
      effort: "baixo",
      priority: 3,
      confidence: "alto",
      nextAction: "Conectar a conta profissional pela integração oficial ou informar as métricas manualmente.",
      howToTest: "",
    },
  ];
}

function diagnosis(prompt: string) {
  const handle = line(prompt, "Perfil").replace(/^@/, "") || "perfil";
  const niche = line(prompt, "Nicho");
  const limit = Number(line(prompt, "Limite da bio").match(/\d+/)?.[0] ?? 150);
  const evaluable = listLine(prompt, "Dimensões que você pode avaliar");
  const highlights = listLine(prompt, "Destaques atuais");
  const hasPosts = !/^Publicações: nenhuma/m.test(prompt);
  const base: Record<string, number> = {
    positioning: 55,
    bio: 50,
    visual: 60,
    highlights: 45,
    content: 55,
    cta: 40,
    audience: 50,
    consistency: 55,
  };
  return {
    summary: `${DEMO}: diagnóstico de exemplo para @${handle}, gerado localmente sem análise real. Configure um provedor de IA para um diagnóstico de verdade.`,
    strengths: [{ text: `${DEMO}: o perfil já tem uma base para trabalhar.`, basis: "hypothesis", evidence: "" }],
    problems: [{ text: "A bio pode deixar mais claro o que a marca oferece.", basis: "hypothesis", evidence: "" }],
    opportunities: [
      { text: "Usar os destaques como vitrine das dúvidas mais comuns.", basis: "hypothesis", evidence: "" },
    ],
    dimensions: Object.keys(base).map((key) => ({
      key,
      score: evaluable.includes(key) ? base[key]! : null,
      rationale: evaluable.includes(key) ? `${DEMO}: nota de exemplo.` : "Sem dados suficientes para avaliar.",
      evidence: "",
    })),
    bio: { audit: BIO_AUDIT, versions: bioVersions(handle, niche, limit) },
    highlights: {
      assessment: highlights.length
        ? `${DEMO}: os destaques atuais (${highlights.join(", ")}) podem seguir a jornada de quem chega ao perfil.`
        : "Os destaques atuais não foram informados.",
      basis: highlights.length ? "observed" : "insufficient",
      recommended: [
        {
          name: "Comece aqui",
          objective: "Apresentar a marca para quem acabou de chegar.",
          order: 1,
          storyIdeas: ["Quem somos em uma frase", "O que oferecemos", "Como falar com a gente"],
          coverDirection: "Ícone simples sobre a cor principal da marca.",
          coverPrompt: "Ícone minimalista de casa, traço fino, fundo liso na cor principal da marca, sem texto",
        },
        {
          name: "Clientes",
          objective: "Mostrar prova social real.",
          order: 2,
          storyIdeas: ["Depoimento autorizado", "Antes e depois", "Bastidores de uma entrega"],
          coverDirection: "Ícone de coração ou estrela, mesmo estilo da capa anterior.",
          coverPrompt: "Ícone minimalista de estrela, traço fino, fundo liso na cor principal da marca, sem texto",
        },
        {
          name: "Dúvidas",
          objective: "Responder às perguntas que chegam no direct.",
          order: 3,
          storyIdeas: ["Pergunta frequente e resposta curta", "Caixa de perguntas", "Como funciona o atendimento"],
          coverDirection: "Ícone de balão de conversa, mesmo estilo das outras capas.",
          coverPrompt:
            "Ícone minimalista de balão de conversa, traço fino, fundo liso na cor principal da marca, sem texto",
        },
      ],
    },
    visual: { note: "Não avaliado na demonstração.", items: [] },
    content: {
      categories: [
        { key: "education", presence: hasPosts ? "low" : "unknown", note: `${DEMO}: avaliação de exemplo.` },
        { key: "social_proof", presence: hasPosts ? "absent" : "unknown", note: `${DEMO}: avaliação de exemplo.` },
        { key: "behind_scenes", presence: hasPosts ? "low" : "unknown", note: `${DEMO}: avaliação de exemplo.` },
        { key: "conversion", presence: hasPosts ? "low" : "unknown", note: `${DEMO}: avaliação de exemplo.` },
      ],
      recommendations: [
        {
          idea: "Série semanal de dúvidas frequentes",
          hypothesis: "Responder dúvidas reais aproxima o público e reduz objeções.",
          howToTest: "Publicar por quatro semanas e comparar salvamentos e mensagens.",
        },
      ],
    },
    recommendations: recommendations(handle),
    plan30: [
      { week: 1, focus: "Bio e link", actions: ["Aprovar a nova bio com o cliente", "Revisar o link da bio"] },
      { week: 2, focus: "Destaques", actions: ["Criar as capas", "Publicar os Stories de cada destaque"] },
      { week: 3, focus: "Conteúdo", actions: ["Publicar a série de dúvidas frequentes"] },
      { week: 4, focus: "Revisão", actions: ["Reavaliar o perfil com o Radar de Marca"] },
    ],
  };
}

function niche(prompt: string) {
  const competitors = listLine(prompt, "Concorrentes");
  const nicheName = line(prompt, "Nicho") || "o nicho informado";
  return {
    summary: `${DEMO}: leitura de exemplo de ${nicheName}, gerada localmente.`,
    facts: competitors.length
      ? [`Concorrentes cadastrados pela equipe: ${competitors.join(", ")}.`]
      : ["Nenhum concorrente cadastrado."],
    hypotheses: ["Perfis do nicho que mostram bastidores tendem a gerar mais proximidade (hipótese a testar)."],
    opportunities: ["Ocupar o espaço de conteúdo educativo, pouco explorado nos perfis informados (hipótese)."],
    competitors: competitors.map((c) => ({
      handle: c.replace(/^@/, ""),
      positioning: `${DEMO}: posicionamento não analisado.`,
      differences: "Comparação de exemplo.",
      basis: "insufficient",
    })),
    recommendations: [
      {
        area: "niche",
        category: "strategic",
        title: "Diferenciar a marca pelo conteúdo educativo",
        problem: `${DEMO}: hipótese de espaço livre no nicho.`,
        evidence: "",
        evidenceSource: "",
        basis: "hypothesis",
        impact: "medio",
        effort: "medio",
        priority: 3,
        confidence: "baixo",
        nextAction: "Planejar uma série educativa de quatro semanas.",
        howToTest: "Comparar salvamentos e compartilhamentos com as quatro semanas anteriores.",
      },
    ],
  };
}

export function demoBrandJson(format: string, prompt: string): string | null {
  if (format === "brand_diagnosis") return JSON.stringify(diagnosis(prompt));
  if (format === "brand_bio") {
    const handle = line(prompt, "Perfil").replace(/^@/, "") || "perfil";
    const limit = Number(line(prompt, "Limite da bio").match(/\d+/)?.[0] ?? 150);
    return JSON.stringify({ audit: BIO_AUDIT, versions: bioVersions(handle, line(prompt, "Nicho"), limit) });
  }
  if (format === "brand_niche") return JSON.stringify(niche(prompt));
  return null;
}
