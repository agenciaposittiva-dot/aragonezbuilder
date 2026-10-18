import { demoBrandJson } from "../demo-brand";
import { demoTaskJson } from "../demo-tasks";
import type { AiProvider, GenerateRequest, GenerateResult } from "../types";

/**
 * Provedor de demonstração: responde localmente, sem enviar dados a terceiros.
 * Útil para testar fluxos sem chave de API. O texto deixa claro que é um exemplo.
 */
export function createDemoProvider(): AiProvider {
  async function generate(req: GenerateRequest): Promise<GenerateResult> {
    // Formatos identificados no pedido (Radar de Tendências e Radar de Marca) têm prioridade sobre os do assistente de tarefas.
    const text = req.jsonSchema
      ? (demoFormatJson(req.prompt) ?? demoTaskJson(req.prompt, req.jsonSchema) ?? demoJson(req.prompt))
      : demoText(req.prompt);
    for (const chunk of text.match(/[\s\S]{1,24}/g) ?? []) {
      if (req.signal?.aborted) break;
      req.onText?.(chunk);
      await new Promise((r) => setTimeout(r, 8));
    }
    const inputTokens = Math.ceil((req.system.length + req.prompt.length) / 4);
    const outputTokens = Math.ceil(text.length / 4);
    return { text, model: "demo", inputTokens, outputTokens, costMicros: 0, stopReason: "end_turn" };
  }
  return {
    id: "demo",
    label: "Demonstração (local, sem custo)",
    defaultModel: "demo",
    models: [{ id: "demo", label: "Demonstração" }],
    generate,
  };
}

function topicOf(prompt: string) {
  const m = prompt.match(/Tema:\s*(.+)/i) ?? prompt.match(/Projeto:\s*(.+)/i);
  return (m?.[1] ?? "sua campanha").trim().slice(0, 80);
}

function demoText(prompt: string) {
  const topic = topicOf(prompt);
  return [
    `> Modo demonstração: este conteúdo foi gerado localmente como exemplo. Configure um provedor de IA em Configurações → Inteligência artificial para respostas reais.`,
    ``,
    `## Sugestões para: ${topic}`,
    ``,
    `1. **Bastidores que aproximam** — mostre o processo por trás de ${topic}, com linguagem próxima e um convite a comentar.`,
    `2. **Antes e depois** — um carrossel comparando o problema e a solução, fechando com uma chamada clara.`,
    `3. **Prova social** — depoimento curto de cliente real, com foto e destaque para o resultado.`,
    ``,
    `**CTA sugerida:** "Fale com a gente e descubra como começar ainda hoje."`,
  ].join("\n");
}

/* Respostas estruturadas de exemplo do Radar de Tendências (sem números, sempre identificadas). */
function demoTrendIds(prompt: string) {
  return [...prompt.matchAll(/^- id: ([0-9a-f-]{36})\n {2}assunto: (.+)\n {2}plataforma: (\w+)/gm)].map((m) => ({
    id: m[1]!,
    title: m[2]!.trim(),
    platform: m[3]!,
  }));
}

function demoTrendJson(format: string, prompt: string): string | null {
  const items = demoTrendIds(prompt);
  if (format === "trend_classification") {
    return JSON.stringify({
      items: items.map((t) => ({
        trendId: t.id,
        type: t.platform === "calendar" ? "sazonal" : "emergente",
        relevance: "media",
        velocity: "Não mensurável com os dados disponíveis.",
        niche: t.platform === "calendar" ? "datas" : "noticias",
        nicheFit: "Exemplo da demonstração: relação com o nicho não analisada.",
        audienceInterest: "media",
        saturation: "Sem evidência de saturação.",
        reputationRisk: "baixo",
        sensitivity: "baixa",
        lifespan: t.platform === "calendar" ? "recorrente" : "dias",
        confidence: "baixa",
        angles: [`Bastidores sobre ${t.title}`, `Perguntas frequentes sobre ${t.title}`],
        avoid: ["Afirmar dados que a fonte não informa"],
        rationale: "Modo demonstração: classificação de exemplo, gerada localmente sem análise real.",
      })),
    });
  }
  if (format === "trend_client_fit") {
    return JSON.stringify({
      recommendations: items.slice(0, 3).map((t, i) => ({
        trendId: t.id,
        recommended: i < 2,
        fit:
          i < 2
            ? `Modo demonstração: "${t.title}" pode render um conteúdo leve e próximo da marca.`
            : `Modo demonstração: "${t.title}" não combina com o posicionamento informado.`,
        angles: i < 2 ? [`Dica prática ligada a ${t.title}`] : [],
        avoid: ["Tom oportunista"],
        reputationRisk: i < 2 ? "baixo" : "medio",
        confidence: "baixa",
      })),
      notes: "Modo demonstração: recomendações de exemplo. Configure um provedor de IA para análises reais.",
    });
  }
  if (format === "trend_content") {
    const topic = prompt.match(/^ {2}assunto: (.+)$/m)?.[1]?.trim() ?? "o tema";
    const carousel = /Carrossel/i.test(prompt.split("\n")[1] ?? "");
    return JSON.stringify({
      title: `Conteúdo sobre ${topic}`,
      concept: `Modo demonstração: conceito de exemplo conectando a marca a ${topic}.`,
      strategy: "Aproveitar o interesse do momento com um conteúdo útil, sem tom oportunista.",
      copy: `Você já viu o que está acontecendo com ${topic}?`,
      caption: `Modo demonstração — legenda de exemplo sobre ${topic}. Conte para a gente o que você acha nos comentários.`,
      cta: "Comente e salve para ver depois",
      script: "",
      visualDirection: "Composição limpa, foco no título, cores da marca e bastante respiro.",
      imagePrompt: `Ilustração editorial minimalista sobre ${topic}, sem texto e sem pessoas identificáveis`,
      hashtags: ["#conteudo", "#marketing"],
      slides: carousel
        ? [
            { title: `O que é ${topic}`, text: "Contexto rápido (exemplo da demonstração)." },
            { title: "Por que importa", text: "Ligação com o dia a dia do público." },
            { title: "O que fazer agora", text: "Chamada para ação." },
          ]
        : [],
    });
  }
  return null;
}

function demoFormatJson(prompt: string) {
  const format = prompt.match(/^Formato da resposta: (\w+)/m)?.[1];
  return format ? (demoTrendJson(format, prompt) ?? demoBrandJson(format, prompt)) : null;
}

function demoJson(prompt: string) {
  const trend = demoFormatJson(prompt);
  if (trend) return trend;
  const topic = topicOf(prompt);
  return JSON.stringify({
    tasks: [
      {
        title: `Definir mensagem principal: ${topic}`,
        description: "Alinhar objetivo, público e oferta com o atendimento.",
        estimateMinutes: 60,
      },
      {
        title: "Criar roteiro e textos das peças",
        description: "Headlines, legendas e CTAs por canal.",
        estimateMinutes: 120,
      },
      { title: "Produzir as artes", description: "Versões para feed, stories e anúncios.", estimateMinutes: 240 },
      {
        title: "Revisão interna e envio para aprovação",
        description: "Checklist de marca antes de enviar ao cliente.",
        estimateMinutes: 45,
      },
    ],
  });
}
