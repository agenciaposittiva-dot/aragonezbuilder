/*
 * Respostas locais do modo demonstração para a Central de pré-visualização.
 * Nada vai a terceiros: a revisão sai dos avisos da verificação automática e
 * a conversão devolve o rascunho base que o próprio pedido traz.
 */

function line(prompt: string, label: string) {
  return prompt.match(new RegExp(`^${label}: (.*)$`, "m"))?.[1]?.trim() ?? "";
}

function review(prompt: string) {
  const alerts = [...prompt.matchAll(/^- \[(error|warning|suggestion)\] (.+)$/gm)].map((m) => m[2]!);
  const caption = line(prompt, "Legenda");
  const firstPage = prompt.match(/^- (P[áa]gina 1|Tela 1|Página|Tela)\b/m)?.[1] ?? null;
  const suggestions = [
    {
      area: "hierarquia",
      page: firstPage,
      text: "Modo demonstração: deixe o título com mais destaque que os demais textos e limite a capa a uma ideia.",
    },
    {
      area: "composicao",
      page: null,
      text: "Modo demonstração: mantenha margens iguais nas bordas e alinhe os textos pelo mesmo eixo.",
    },
    ...(alerts.length
      ? [
          {
            area: "formato",
            page: null,
            text: `Modo demonstração: comece pelos alertas da verificação (${alerts.length}), principalmente os que precisam de correção.`,
          },
        ]
      : []),
    {
      area: "consistencia",
      page: null,
      text: "Modo demonstração: confira se cores e fontes seguem a identidade do cliente em todas as páginas.",
    },
    {
      area: "legenda",
      page: null,
      text: "Modo demonstração: coloque a informação principal nas primeiras palavras da legenda e termine com a chamada para ação.",
    },
  ];
  return JSON.stringify({
    summary:
      "Modo demonstração: revisão de exemplo gerada localmente, sem análise real. Configure um provedor de IA para sugestões de verdade.",
    suggestions,
    caption:
      caption && caption !== "(sem legenda)"
        ? `${caption.replace(/\s+$/, "")}\n\n(Exemplo da demonstração: legenda alternativa.)`
        : null,
  });
}

function convert(prompt: string) {
  const raw = prompt.match(/^Rascunho base \(JSON\): (.+)$/m)?.[1];
  let base: {
    title?: string;
    slides?: { title: string; text: string }[];
    caption?: string | null;
    cta?: string | null;
  } = {};
  try {
    base = raw ? JSON.parse(raw) : {};
  } catch {
    base = {};
  }
  const slides = (base.slides?.length ? base.slides : [{ title: base.title ?? "Capa", text: "" }]).map((s, i) => ({
    title: s.title,
    text: i === 0 && !s.text ? "Exemplo da demonstração" : s.text,
  }));
  return JSON.stringify({
    title: base.title ?? "Nova versão",
    slides,
    caption: base.caption ?? null,
    cta: base.cta ?? null,
  });
}

export function demoPreviewJson(format: string, prompt: string): string | null {
  if (format === "preview_review") return review(prompt);
  if (format === "preview_convert") return convert(prompt);
  return null;
}
