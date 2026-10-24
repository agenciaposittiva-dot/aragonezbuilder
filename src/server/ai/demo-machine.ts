/*
 * Respostas do modo demonstração para a Máquina de Conteúdo: determinísticas,
 * mudam com o assunto, sem números, fontes ou métricas inventadas e sempre
 * marcadas como exemplo.
 */

function line(prompt: string, label: string) {
  const m = prompt.match(new RegExp(`^${label}:\\s*(.+)$`, "mi"));
  return m?.[1]?.trim() ?? "";
}

function hash(text: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const ANGLES: { type: string; hook: (t: string, n: string) => string; idea: (t: string, n: string) => string }[] = [
  {
    type: "belief",
    hook: (t) => `O que quase ninguém te conta sobre ${t}`,
    idea: (t) => `Questionar a ideia mais repetida sobre ${t} e mostrar o que realmente faz diferença.`,
  },
  {
    type: "mistakes",
    hook: (t) => `Erros comuns quando o assunto é ${t}`,
    idea: (t) => `Listar os deslizes mais frequentes sobre ${t} e como evitar cada um.`,
  },
  {
    type: "steps",
    hook: (t) => `Como colocar ${t} em prática, passo a passo`,
    idea: (t) => `Transformar ${t} em uma sequência simples de ações que o público consegue seguir hoje.`,
  },
  {
    type: "myths",
    hook: (t) => `Mitos e verdades sobre ${t}`,
    idea: (t) => `Separar o que é fato do que é suposição sobre ${t}, indicando o que precisa de fonte.`,
  },
  {
    type: "practical",
    hook: (t, n) => `${t}: o que muda para ${n || "o seu negócio"}`,
    idea: (t, n) => `Aplicar ${t} à realidade de ${n || "quem acompanha a marca"}, com exemplos do dia a dia.`,
  },
  {
    type: "problem_solution",
    hook: (t) => `O problema por trás de ${t} (e o que fazer)`,
    idea: (t) => `Nomear a dor que ${t} revela e apresentar um caminho de solução.`,
  },
  {
    type: "opinion",
    hook: (t) => `Nossa leitura sobre ${t}`,
    idea: (t) => `Posicionar a marca com uma opinião fundamentada sobre ${t}, sem exageros.`,
  },
  {
    type: "backstage",
    hook: (t) => `Bastidores: como lidamos com ${t}`,
    idea: (t) => `Mostrar o processo real da marca diante de ${t}, com transparência.`,
  },
];

export function demoMachineJson(format: string, prompt: string): string | null {
  const topic = (line(prompt, "Assunto") || "o tema escolhido").replace(/\.$/, "").slice(0, 120);
  const niche = line(prompt, "Segmento");
  const seed = hash(topic.toLowerCase());
  if (format === "machine_opportunity") {
    return JSON.stringify({
      title: topic,
      summary: `Modo demonstração: resumo de exemplo sobre "${topic}". Configure um provedor de IA para uma síntese real da fonte.`,
      relevance: `Assunto com potencial de conversa porque toca em dúvidas práticas do público (hipótese editorial da demonstração).`,
      nicheRelation: niche
        ? `Pode ser conectado a ${niche} mostrando impactos e aplicações concretas.`
        : "Relacione com os serviços e o público da marca antes de publicar.",
      angleHints: [
        "Explicar o contexto em linguagem simples",
        "Mostrar aplicação prática",
        "Corrigir uma ideia errada",
      ],
      risks: ["Confirme datas, números e nomes na fonte original antes de publicar.", "Evite prometer resultados."],
    });
  }
  if (format === "machine_angles") {
    const used = new Set(
      (line(prompt, "Tipos já sugeridos") || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    );
    const order = ANGLES.map((_, i) => ANGLES[(i + (seed % ANGLES.length)) % ANGLES.length]!).filter(
      (a) => !used.has(a.type),
    );
    const pickList = (order.length ? order : ANGLES).slice(0, 5);
    return JSON.stringify({
      angles: pickList.map((a) => ({
        type: a.type,
        hook: a.hook(topic, niche),
        idea: `${a.idea(topic, niche)} (exemplo da demonstração)`,
        audience: niche ? `Público de ${niche}` : "Público da marca",
        objective: "Educar e gerar conversa",
        differential: "Foco em aplicação prática, sem números não verificados.",
        format: "carousel",
        cta: "Salve para consultar depois e compartilhe com quem precisa.",
        sourcesNeeded: ["Fonte original do assunto para qualquer dado citado"],
      })),
    });
  }
  return null;
}
