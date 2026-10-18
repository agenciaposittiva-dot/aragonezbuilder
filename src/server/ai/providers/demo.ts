import type { AiProvider, GenerateRequest, GenerateResult } from "../types";

/**
 * Provedor de demonstração: responde localmente, sem enviar dados a terceiros.
 * Útil para testar fluxos sem chave de API. O texto deixa claro que é um exemplo.
 */
export function createDemoProvider(): AiProvider {
  async function generate(req: GenerateRequest): Promise<GenerateResult> {
    const text = req.jsonSchema ? demoJson(req.prompt) : demoText(req.prompt);
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

function demoJson(prompt: string) {
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
