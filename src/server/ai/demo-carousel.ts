/*
 * Respostas do modo demonstração para o gerador de carrosséis (sem IA real,
 * sem enviar dados a terceiros). O roteiro é montado por regras a partir do
 * tema, objetivo e público digitados; a sequência de slides e as frases mudam
 * com o tema. Números só aparecem se estiverem nas referências enviadas.
 * Tudo sai marcado como exemplo (legenda e avisos).
 */

function line(prompt: string, label: string) {
  const m = prompt.match(new RegExp(`^${label}:\\s*(.+)$`, "mi"));
  return m?.[1]?.trim() ?? "";
}

function block(prompt: string, label: string) {
  const i = prompt.indexOf(`${label}:\n`);
  if (i < 0) return "";
  const rest = prompt.slice(i + label.length + 2);
  const end = rest.search(/\n\n/);
  return (end >= 0 ? rest.slice(0, end) : rest).trim();
}

function hash(text: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const pick = <T>(list: readonly T[], seed: number, salt = 0) => list[(seed + salt * 7919) % list.length]!;

const cap = (t: string) => (t ? t[0]!.toUpperCase() + t.slice(1) : t);
const low = (t: string) => (t ? t[0]!.toLowerCase() + t.slice(1) : t);

type Slide = {
  role: string;
  kicker: string;
  title: string;
  body: string;
  bullets: string[];
  columns: { label: string; items: string[] }[];
  stat: { value: string; label: string; source: string };
  chart: { unit: string; source: string; items: { label: string; value: number }[] };
  visual: { kind: string; prompt: string; icon: string };
};

const empty = (): Omit<Slide, "role" | "title"> => ({
  kicker: "",
  body: "",
  bullets: [],
  columns: [],
  stat: { value: "", label: "", source: "" },
  chart: { unit: "", source: "", items: [] },
  visual: { kind: "icon", prompt: "", icon: "" },
});

/** Primeira frase das referências que contém um número (para o slide de dado). */
function referenceStat(refs: string) {
  for (const sentence of refs.split(/(?<=[.!?])\s+|\n+/)) {
    const m = sentence.match(/(\d+(?:[.,]\d+)?\s?%|\d+(?:[.,]\d+)?\s?(?:mil|milhões|x))/i);
    if (m) {
      const source = sentence.match(/\(([^)]+)\)\s*[.!?]?\s*$/)?.[1] ?? "";
      return {
        value: m[1]!.replace(/\s+/g, ""),
        label: sentence
          .replace(/\([^)]*\)\s*[.!?]?\s*$/, "")
          .replace(m[1]!, "")
          .replace(/\s+/g, " ")
          .trim()
          .replace(/^[-—:,\s]+/, ""),
        source,
      };
    }
  }
  return null;
}

const SEQUENCES = [
  ["cover", "problem", "insight", "list", "steps", "summary", "cta"],
  ["cover", "context", "comparison", "insight", "list", "cta"],
  ["cover", "problem", "steps", "insight", "summary", "cta"],
  ["cover", "context", "insight", "list", "comparison", "summary", "cta"],
  ["cover", "problem", "context", "steps", "list", "cta"],
] as const;

function imagePrompt(topic: string, scene: string) {
  return `Fotografia editorial sobre ${topic}: ${scene}. Luz natural, composição limpa com espaço livre para texto, sem texto escrito na imagem, sem logotipos e sem pessoas identificáveis.`;
}

function demoSlide(
  role: string,
  ctx: { topic: string; objective: string; audience: string; seed: number; n: number; variant: number },
): Slide {
  const { seed, variant } = ctx;
  // Núcleo do tema para usar dentro das frases ("Clareamento dental: mitos" → "clareamento dental").
  const T = ctx.topic.split(/[:—–|]/)[0]!.trim() || ctx.topic;
  const aud = ctx.audience ? low(ctx.audience) : "quem está começando";
  const v = seed + variant * 31;
  switch (role) {
    case "cover":
      return {
        ...empty(),
        role,
        kicker: pick(["Guia rápido", "Salve para depois", "Direto ao ponto", "Entenda de uma vez"], v),
        title: ctx.topic.includes(":")
          ? cap(ctx.topic)
          : pick(
              [
                `${cap(T)}: o que ninguém te conta`,
                `${cap(T)} sem complicação`,
                `Tudo o que você precisa saber sobre ${low(T)}`,
                `${cap(T)} na prática`,
              ],
              v,
              1,
            ),
        body: pick(
          [`Um passo a passo para ${aud}.`, `Arraste e veja como aplicar hoje.`, `O essencial em poucos slides.`],
          v,
          2,
        ),
        visual: { kind: "image", prompt: imagePrompt(T, "cena principal que represente o tema"), icon: "" },
      };
    case "problem":
      return {
        ...empty(),
        role,
        kicker: "O problema",
        title: pick(
          [`Por que ${low(T)} parece tão difícil?`, `O erro mais comum com ${low(T)}`, `Onde a maioria tropeça`],
          v,
          3,
        ),
        body: pick(
          [
            `Muita gente começa sem um plano claro e desiste antes de ver resultado. Não é falta de esforço: é falta de método.`,
            `Informação demais, prática de menos. Sem prioridade, ${low(T)} vira mais uma tarefa adiada.`,
            `O problema raramente é o "o quê" — é o "como" e o "quando". Vamos organizar isso.`,
          ],
          v,
          4,
        ),
        visual: { kind: "icon", prompt: "", icon: "alert" },
      };
    case "context":
      return {
        ...empty(),
        role,
        kicker: "Contexto",
        title: pick(
          [
            `O que muda quando você entende ${low(T)}`,
            `${cap(T)} em uma frase`,
            `Antes de começar, um ponto importante`,
          ],
          v,
          5,
        ),
        body: pick(
          [
            `Com o básico bem feito, as decisões ficam mais simples e os resultados aparecem com consistência.`,
            `Pense em ${low(T)} como um hábito, não como um evento: pequenas ações repetidas valem mais que um grande esforço isolado.`,
          ],
          v,
          6,
        ),
        visual: { kind: "image", prompt: imagePrompt(T, "detalhe do dia a dia ligado ao tema"), icon: "" },
      };
    case "insight":
      return {
        ...empty(),
        role,
        kicker: "A virada",
        title: pick(
          [`Comece pelo que dá resultado rápido`, `Menos volume, mais constância`, `O segredo está na rotina`],
          v,
          7,
        ),
        body: pick(
          [
            `Escolha uma ação simples, repita por uma semana e só então acrescente a próxima. É assim que ${low(T)} vira parte do seu dia.`,
            `Registrar o que você faz ajuda a enxergar o progresso e a ajustar o caminho sem frustração.`,
          ],
          v,
          8,
        ),
        visual: { kind: "icon", prompt: "", icon: "bulb" },
      };
    case "list":
      return {
        ...empty(),
        role,
        kicker: pick(["Checklist", "Na prática", "Para aplicar"], v, 9),
        title: pick([`O básico de ${low(T)}`, `O que não pode faltar`, `Comece por aqui`], v, 10),
        bullets: pick(
          [
            [
              "Defina um objetivo simples e mensurável",
              "Reserve um horário fixo na agenda",
              "Acompanhe o progresso toda semana",
              "Peça ajuda de quem entende do assunto",
            ],
            [
              "Entenda o seu ponto de partida",
              "Escolha uma prioridade por vez",
              "Evite comparar o seu ritmo com o dos outros",
              "Celebre as pequenas conquistas",
            ],
            [
              "Organize o que você já tem",
              "Corte o que não faz diferença",
              "Repita o que funcionou",
              "Revise o plano a cada mês",
            ],
          ],
          v,
          11,
        ),
        visual: { kind: "icon", prompt: "", icon: "check" },
      };
    case "steps":
      return {
        ...empty(),
        role,
        kicker: "Passo a passo",
        title: pick(
          [`Como começar ${low(T)} em 3 passos`, `Seu plano para esta semana`, `Do zero ao primeiro resultado`],
          v,
          12,
        ),
        bullets: pick(
          [
            [
              "Escolha um objetivo para a próxima semana",
              "Separe alguns minutos por dia para a primeira ação",
              "No fim da semana, revise e ajuste",
            ],
            ["Liste o que já funciona hoje", "Escolha uma melhoria e aplique", "Meça e repita o que deu certo"],
          ],
          v,
          13,
        ),
        visual: { kind: "diagram", prompt: "", icon: "" },
      };
    case "comparison":
      return {
        ...empty(),
        role,
        title: pick([`Mito × verdade sobre ${low(T)}`, `Antes e depois de ter um método`], v, 14),
        columns: pick(
          [
            [
              {
                label: "Mito",
                items: ["Precisa de muito tempo", "Só funciona para especialistas", "Resultado vem rápido"],
              },
              {
                label: "Verdade",
                items: ["Pouco tempo, todo dia, funciona", "Qualquer pessoa pode começar", "Constância vence a pressa"],
              },
            ],
            [
              { label: "Sem método", items: ["Começa e para", "Não sabe o que priorizar", "Desanima fácil"] },
              { label: "Com método", items: ["Ritmo constante", "Prioridades claras", "Progresso visível"] },
            ],
          ],
          v,
          15,
        ),
        visual: { kind: "diagram", prompt: "", icon: "" },
      };
    case "summary":
      return {
        ...empty(),
        role,
        kicker: "Resumo",
        title: "Para lembrar",
        bullets: ["Comece simples", "Seja constante", "Acompanhe o progresso", "Ajuste sem culpa"],
        visual: { kind: "icon", prompt: "", icon: "check" },
      };
    case "data":
      return {
        ...empty(),
        role,
        title: `Um dado sobre ${low(T)}`,
        body: "",
        visual: { kind: "chart", prompt: "", icon: "" },
      };
    default:
      return {
        ...empty(),
        role: "cta",
        title: pick([`Gostou? Salve para não esquecer`, `Vamos juntos nessa?`, `Ficou com alguma dúvida?`], v, 16),
        body: ctx.objective
          ? `${cap(ctx.objective).replace(/\.$/, "")}. Fale com a gente.`
          : "Comente sua maior dúvida e compartilhe com quem precisa ver isso.",
        visual: { kind: "icon", prompt: "", icon: "bookmark" },
      };
  }
}

export function demoCarouselJson(format: string, prompt: string): string | null {
  const topic = line(prompt, "Tema") || "seu tema";
  const objective = line(prompt, "Objetivo");
  const audience = line(prompt, "Público");
  const refs = block(prompt, "Referências da equipe");
  const seed = hash(topic.toLowerCase());
  if (format === "carousel_plan") {
    const wanted = Number(line(prompt, "Quantidade de slides")) || 0;
    let roles: string[] = [...pick(SEQUENCES, seed)];
    const stat = referenceStat(refs);
    if (stat) roles.splice(2, 0, "data");
    if (wanted) {
      while (roles.length < wanted)
        roles.splice(roles.length - 1, 0, pick(["insight", "list", "context"], seed, roles.length));
      if (roles.length > wanted) roles = [...roles.slice(0, wanted - 1), "cta"];
    }
    const slides = roles.map((role, i) => {
      const s = demoSlide(role, { topic, objective, audience, seed, n: i, variant: i });
      if (role === "data" && stat) {
        s.title = `O que os números mostram`;
        s.stat = { value: stat.value, label: stat.label.slice(0, 150), source: stat.source };
        s.visual = { kind: "typographic", prompt: "", icon: "" };
      }
      return s;
    });
    return JSON.stringify({
      title: topic,
      angle: `Modo demonstração: abordagem educativa e prática sobre ${topic}, com linguagem próxima.`,
      objective: objective || `Educar o público sobre ${topic} e gerar salvamentos.`,
      audience: audience || "Público geral interessado no tema.",
      narrative: "Gancho na capa → problema → virada → aplicação prática → resumo → chamada para ação.",
      caption: `Modo demonstração — legenda de exemplo sobre ${topic}. Salve este post e compartilhe com quem precisa ver.`,
      hashtags: [
        "#dicas",
        "#conteudo",
        `#${topic
          .split(/\s+/)[0]!
          .toLowerCase()
          .normalize("NFD")
          .replace(/[^a-z0-9]/g, "")}`,
      ],
      cta: pick(["Salve este post", "Compartilhe com alguém", "Comente sua dúvida"], seed, 17),
      slides,
      claims: [],
      direction: { style: "", mood: "Modo demonstração: direção escolhida pelo tema.", palette: [] },
    });
  }
  if (format === "carousel_slide") {
    const role = line(prompt, "Papel do slide") || "insight";
    const version = Number(line(prompt, "Versão")) || 2;
    const s = demoSlide(role, { topic, objective, audience, seed, n: 0, variant: version + 3 });
    const ask = line(prompt, "Pedido de ajuste");
    if (ask && /curt|menor|resum/i.test(ask)) s.body = s.body.split(/(?<=[.!?])\s/)[0] ?? s.body;
    return JSON.stringify({ slide: s, claims: [] });
  }
  return null;
}
