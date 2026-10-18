/*
 * Respostas de exemplo do chat de edição de artes (provedor de demonstração).
 * Regras simples e determinísticas sobre o contexto enviado — servem para
 * testar o fluxo sem chave de API. Toda resposta é identificada como exemplo.
 */

type SummaryObject = {
  id: string;
  type: string;
  name?: string;
  text?: string;
  fontSize?: number;
  color?: unknown;
  fill?: unknown;
  w?: number;
  h?: number;
  children?: SummaryObject[];
};
type SummaryPage = { id: string; number: number; background?: unknown; objects: SummaryObject[] };
type DemoContext = {
  document: { pages: SummaryPage[] };
  activePage?: number;
  selection?: string[];
  brand?: { colors?: string[]; fonts?: string[] } | null;
};

const ORDINALS: [string, number][] = [
  ["primeir", 1],
  ["segund", 2],
  ["terceir", 3],
  ["quart", 4],
  ["quint", 5],
  ["sext", 6],
  ["sétim", 7],
  ["setim", 7],
  ["oitav", 8],
  ["non", 9],
  ["décim", 10],
  ["decim", 10],
];

/** Erros comuns de digitação em português (sem acento) e a forma correta. */
const FIXES: [RegExp, string][] = [
  [/\bvoces\b/gi, "vocês"],
  [/\bvoce\b/gi, "você"],
  [/\bpromocao\b/gi, "promoção"],
  [/\bpromocoes\b/gi, "promoções"],
  [/\bnao\b/gi, "não"],
  [/\btambem\b/gi, "também"],
  [/\bfacil\b/gi, "fácil"],
  [/\bimperdivel\b/gi, "imperdível"],
  [/\bunico\b/gi, "único"],
  [/\bunica\b/gi, "única"],
  [/\bentao\b/gi, "então"],
  [/\batencao\b/gi, "atenção"],
  [/\binformacao\b/gi, "informação"],
  [/\bexperiencia\b/gi, "experiência"],
  [/\botimo\b/gi, "ótimo"],
  [/\bsao\b/gi, "são"],
  [/\bate\b/gi, "até"],
  [/\bja\b/gi, "já"],
  [/\bgratis\b/gi, "grátis"],
];

function keepCase(original: string, fixed: string) {
  return original[0] === original[0]!.toUpperCase() ? fixed[0]!.toUpperCase() + fixed.slice(1) : fixed;
}

export function demoSpellFix(text: string) {
  let out = text;
  for (const [re, good] of FIXES) out = out.replace(re, (m) => keepCase(m, good));
  return out;
}

function flatten(list: SummaryObject[]): SummaryObject[] {
  return list.flatMap((o) => [o, ...(o.children ? flatten(o.children) : [])]);
}

function pageFromMessage(msg: string, pages: SummaryPage[]): SummaryPage | null {
  const n = msg.match(/(?:slide|página|pagina)\s*(\d+)/)?.[1];
  if (n) return pages[Number(n) - 1] ?? null;
  for (const [stem, num] of ORDINALS) {
    if (new RegExp(`(^|\\s)${stem}[oa]?\\s+(slide|página|pagina)`).test(msg)) return pages[num - 1] ?? null;
  }
  return null;
}

const solid = (v: unknown) => (typeof v === "string" && /^#[0-9a-f]{3,8}$/i.test(v) ? v.toLowerCase() : null);
const area = (o: SummaryObject) => (o.w ?? 0) * (o.h ?? 0);

export function demoDesignEditJson(prompt: string): string | null {
  if (!/^Tarefa: editar_arte$/m.test(prompt)) return null;
  const raw = prompt.split("\nContexto (JSON):\n")[1]?.split("\n")[0];
  const out = (reply: string, ops: unknown[] = [], actions: unknown[] = [], question: string | null = null) =>
    JSON.stringify({ reply: `Exemplo (modo demonstração): ${reply}`, ops, actions, question });
  let ctx: DemoContext;
  try {
    ctx = JSON.parse(raw ?? "") as DemoContext;
  } catch {
    return out("não consegui ler a arte.");
  }
  const original = prompt.match(/^Pedido: (.+)$/m)?.[1]?.trim() ?? "";
  const msg = original.toLowerCase();
  const pages = ctx.document.pages;
  const named = pageFromMessage(msg, pages);
  const page = named ?? pages[(ctx.activePage ?? 1) - 1] ?? pages[0]!;
  const objects = flatten(page.objects);
  const texts = objects.filter((o) => o.type === "text" && o.text);
  const selected = new Set(ctx.selection ?? []);
  const biggest = [...texts].sort((a, b) => (b.fontSize ?? 0) - (a.fontSize ?? 0))[0];
  const target = texts.find((t) => selected.has(t.id)) ?? biggest;

  if (/corrij|ortograf|portugu|gramátic|gramatic|erros/.test(msg)) {
    const scope = named ? texts : pages.flatMap((p) => flatten(p.objects)).filter((o) => o.type === "text" && o.text);
    const ops = scope
      .map((t) => ({ t, fixed: demoSpellFix(t.text!) }))
      .filter(({ t, fixed }) => fixed !== t.text)
      .map(({ t, fixed }) => ({ op: "setText", id: t.id, text: fixed }));
    return ops.length
      ? out(`corrigi ${ops.length} texto(s). Os demais elementos não mudam.`, ops)
      : out("não encontrei erros de português nos textos desta arte.");
  }

  if (
    /imagem|foto|fundo/.test(msg) &&
    /troq|substitu|nova vers|premium|varia|mude|altere|edite|ilumina|cor/.test(msg)
  ) {
    const images = objects.filter((o) => o.type === "image");
    const img = images.find((o) => selected.has(o.id)) ?? [...images].sort((a, b) => area(b) - area(a))[0];
    if (!img) return out("não há imagem nesta página para editar.", [], [], "Qual imagem você quer alterar?");
    return out(
      "posso gerar uma nova versão desta imagem usando a original como referência. Revise antes de aplicar.",
      [],
      [{ tool: "image_edit", args: { targetId: img.id, instruction: original } }],
    );
  }

  if (/remov|apag|exclu|\btire\b/.test(msg)) {
    if (!selected.size) return out("selecione o elemento que deseja remover.", [], [], "Qual elemento devo remover?");
    return out(`vou remover ${selected.size} elemento(s) selecionado(s).`, [{ op: "remove", ids: [...selected] }]);
  }

  if (/paleta|cores da marca/.test(msg)) {
    const brand = (ctx.brand?.colors ?? []).map(solid).filter((c): c is string => !!c);
    if (!brand.length) return out("este cliente não tem cores de marca cadastradas.");
    const used = [...new Set(objects.flatMap((o) => [solid(o.color), solid(o.fill)]).filter((c): c is string => !!c))];
    const map = used
      .filter((c) => !brand.includes(c))
      .slice(0, brand.length)
      .map((from, i) => ({ from, to: brand[i]! }));
    if (!map.length) return out("esta página já usa as cores da marca.");
    return out(`troquei ${map.length} cor(es) pelas da marca nesta página.`, [
      { op: "changePalette", map, pageId: page.id },
    ]);
  }

  if (/aument|maior/.test(msg) && target) {
    const size = Math.round((target.fontSize ?? 48) * 1.25);
    return out(`aumentei "${target.name ?? "o texto"}" para ${size} px.`, [
      { op: "setStyle", ids: [target.id], style: { fontSize: size } },
    ]);
  }

  if (/título|titulo|frase|texto|cta|chamada|slide/.test(msg) && target) {
    const base = target.text!.trim().replace(/[.!…]+$/, "");
    const text = /comercial|persuasiv|vend/.test(msg)
      ? `${base} — aproveite hoje!`
      : /conect|ligar|continu/.test(msg)
        ? `Continuando: ${base}`
        : /impact/.test(msg)
          ? `Agora é a sua vez: ${base}!`
          : `${base} (versão revisada)`;
    return out(`reescrevi "${target.name ?? "o texto"}" mantendo fonte, cor e posição.`, [
      { op: "setText", id: target.id, text },
    ]);
  }

  return out(
    "não entendi o que mudar.",
    [],
    [],
    "Pode detalhar? Ex.: “Troque o título por uma frase mais impactante” ou “Corrija os erros de português”.",
  );
}
