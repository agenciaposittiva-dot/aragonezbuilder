/*
 * Respostas locais do modo demonstração para o assistente da Central de
 * Tarefas. Nada é enviado a terceiros: as tarefas saem do próprio texto
 * digitado, por regras simples, para que o fluxo possa ser testado sem chave.
 */

const between = (prompt: string) => prompt.match(/<<<\n([\s\S]*?)\n>>>/)?.[1] ?? "";
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function fragments(text: string) {
  const lines = text
    .split(/\n+/)
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter(
      (l) =>
        l &&
        !/^(solicitação #|objetivo:|público:|canal:|formato:|briefing:|prazo desejado|quantidade de peças|texto de apoio)/i.test(
          l,
        ),
    )
    .map((l) => l.replace(/^descrição:\s*/i, ""));
  let parts = lines.flatMap((l) => l.split(/;\s*|\.\s+(?=\p{Lu})/u));
  if (parts.length === 1 && (parts[0] ?? "").split(",").length >= 3) parts = parts[0]!.split(/,\s*(?:e\s+)?/);
  return parts.map((p) => p.replace(/[.;,]+$/, "").trim()).filter((p) => p.length >= 3);
}

function planFrom(prompt: string) {
  const source = between(prompt);
  const items = fragments(source)
    .slice(0, 12)
    .map((f) => {
      const date = f.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\b/);
      const today = prompt.match(/\((\d{4}-\d{2}-\d{2})\)/)?.[1] ?? new Date().toISOString().slice(0, 10);
      const iso = (year: string | number) => `${year}-${date![2]!.padStart(2, "0")}-${date![1]!.padStart(2, "0")}`;
      // Sem ano: este ano, ou o próximo se a data já passou (mesma regra da conferência de datas citadas).
      const dueDate = !date
        ? ""
        : date[3]
          ? iso(date[3])
          : iso(today.slice(0, 4)) < today
            ? iso(Number(today.slice(0, 4)) + 1)
            : iso(today.slice(0, 4));
      const who =
        f.match(/@([\p{L}]+)/u)?.[1] ?? f.match(/\b(?:para|com|responsável:?)\s+(\p{Lu}[\p{L}]+)/u)?.[1] ?? "";
      const title = capitalize(
        f
          .replace(/\s*(?:até|para)?\s*(?:o dia\s*)?\d{1,2}\/\d{1,2}(?:\/\d{4})?/g, "")
          .replace(/@[\p{L}]+/gu, "")
          .replace(/\s+/g, " ")
          .trim(),
      ).slice(0, 120);
      return {
        title: title || capitalize(f).slice(0, 120),
        description: "",
        priority: /urgent|urg[êe]ncia|hoje|asap/i.test(f)
          ? "urgent"
          : /importante|prioridade alta/i.test(f)
            ? "high"
            : "medium",
        dueDate,
        dueOrigin: dueDate ? "texto" : "nenhum",
        assigneeHint: who,
        estimateMinutes: 0,
        subtasks: [],
        checklist: [],
      };
    });
  return { items };
}

function breakdownFrom(prompt: string) {
  const title =
    between(prompt)
      .match(/Título:\s*(.+)/)?.[1]
      ?.trim() ?? "a tarefa";
  const subtask = /subtarefa abaixo/.test(prompt);
  return {
    subtasks: subtask
      ? []
      : [
          { title: `Levantar referências para ${title}`, estimateMinutes: 30 },
          { title: "Produzir a primeira versão", estimateMinutes: 120 },
          { title: "Revisão interna", estimateMinutes: 30 },
          { title: "Ajustes e entrega", estimateMinutes: 45 },
        ],
    checklist: ["Revisado por outra pessoa da equipe", "Dentro da identidade da marca", "Arquivo final no projeto"],
  };
}

function triageFrom(prompt: string) {
  const body = between(prompt);
  const urgent = /urgent|bloqueia outras/i.test(body);
  return {
    priority: urgent ? "high" : "medium",
    priorityReason: urgent
      ? "Modo demonstração: a tarefa bloqueia outras entregas."
      : "Modo demonstração: sem sinais de urgência nos dados da tarefa.",
    dueDate: "",
    dueReason: "Modo demonstração: nenhum prazo é sugerido sem um provedor de IA configurado.",
  };
}

function summaryFrom(prompt: string) {
  const lines = between(prompt)
    .split("\n")
    .map((l) => l.replace(/^\[[^\]]*\]\s*/, "").trim())
    .filter(Boolean);
  const people = new Set(lines.map((l) => l.split(":")[0]!.replace(" (interno)", "")));
  const body = (l: string) => l.slice(l.indexOf(":") + 1).trim();
  return {
    summary: `Modo demonstração: ${lines.length} comentário${lines.length === 1 ? "" : "s"} de ${people.size} pessoa${people.size === 1 ? "" : "s"}. Último: “${body(lines.at(-1) ?? "").slice(0, 160)}”.`,
    decisions: lines
      .filter((l) => /decid|aprovad|fechad|combinad/i.test(l))
      .map(body)
      .slice(0, 5),
    pending: lines
      .filter((l) => /\?|pendente|falta|precisa/i.test(l))
      .map(body)
      .slice(0, 5),
  };
}

/** Resposta de demonstração para os esquemas do assistente de tarefas (ou null se não for um deles). */
export function demoTaskJson(prompt: string, schema: Record<string, unknown>): string | null {
  const keys = Object.keys((schema.properties as Record<string, unknown> | undefined) ?? {});
  if (keys.includes("items")) return JSON.stringify(planFrom(prompt));
  if (keys.includes("subtasks")) return JSON.stringify(breakdownFrom(prompt));
  if (keys.includes("priorityReason")) return JSON.stringify(triageFrom(prompt));
  if (keys.includes("decisions")) return JSON.stringify(summaryFrom(prompt));
  return null;
}
