/*
 * Formatação das mensagens do chat (compartilhada entre servidor e interface).
 *
 * O texto é guardado como digitado, com menções no formato <@idDoUsuario>.
 * A interface transforma em elementos React a partir destes nós — nunca em
 * HTML cru —, então nada que alguém digite é interpretado pelo navegador.
 *
 * Suportado: **negrito**, _itálico_, ~riscado~, `código`, blocos ```código```,
 * links http(s) e caminhos internos (/w/...), menções e quebras de linha.
 */

export type ChatNode =
  | { t: "text"; v: string }
  | { t: "bold" | "italic" | "strike"; c: ChatNode[] }
  | { t: "code"; v: string }
  | { t: "pre"; v: string }
  | { t: "link"; href: string; v: string }
  | { t: "mention"; id: string }
  | { t: "br" };

export const MENTION_RE = /<@([A-Za-z0-9_-]{1,64})>/g;

/** Ids mencionados (sem repetição, na ordem em que aparecem). */
export function extractMentions(body: string): string[] {
  const out: string[] = [];
  for (const m of body.matchAll(MENTION_RE)) if (!out.includes(m[1]!)) out.push(m[1]!);
  return out;
}

const INLINE =
  /(`[^`\n]+`)|(<@[A-Za-z0-9_-]{1,64}>)|(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]])|((?<![\w/])\/w\/[a-z0-9-]+(?:\/[A-Za-z0-9._~%-]+)+)|(\*\*[^*\n]+\*\*)|((?<![\w])_[^_\n]+_(?![\w]))|(~[^~\n]+~)/g;

function parseInline(text: string, depth = 0): ChatNode[] {
  const nodes: ChatNode[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    const i = m.index ?? 0;
    if (i > last) nodes.push({ t: "text", v: text.slice(last, i) });
    const [whole, code, mention, url, internal, bold, italic, strike] = m;
    if (code) nodes.push({ t: "code", v: code.slice(1, -1) });
    else if (mention) nodes.push({ t: "mention", id: mention.slice(2, -1) });
    else if (url) nodes.push({ t: "link", href: url, v: url });
    else if (internal) nodes.push({ t: "link", href: internal, v: internal });
    else if (depth < 2 && bold) nodes.push({ t: "bold", c: parseInline(bold.slice(2, -2), depth + 1) });
    else if (depth < 2 && italic) nodes.push({ t: "italic", c: parseInline(italic.slice(1, -1), depth + 1) });
    else if (depth < 2 && strike) nodes.push({ t: "strike", c: parseInline(strike.slice(1, -1), depth + 1) });
    else nodes.push({ t: "text", v: whole });
    last = i + whole.length;
  }
  if (last < text.length) nodes.push({ t: "text", v: text.slice(last) });
  return nodes;
}

export function parseMessage(body: string): ChatNode[] {
  const nodes: ChatNode[] = [];
  const parts = body.split(/```/);
  parts.forEach((part, idx) => {
    // Partes ímpares estão dentro de ```bloco```.
    if (idx % 2 === 1 && idx < parts.length - 1) {
      nodes.push({ t: "pre", v: part.replace(/^\n/, "").replace(/\n$/, "") });
      return;
    }
    const text = idx % 2 === 1 ? "```" + part : part;
    text.split("\n").forEach((line, li) => {
      if (li > 0) nodes.push({ t: "br" });
      if (line) nodes.push(...parseInline(line));
    });
  });
  return nodes;
}

/** Texto simples (avisos, IA, resumo na lista): menções viram @Nome. */
export function plainText(body: string, nameOf: (userId: string) => string | undefined): string {
  return body
    .replace(MENTION_RE, (_, id: string) => `@${nameOf(id) ?? "alguém"}`)
    .replace(/```/g, "")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1");
}

/** Prévia curta para listas e notificações. */
export function excerpt(body: string, nameOf: (userId: string) => string | undefined, max = 120): string {
  const flat = plainText(body, nameOf).replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** Reações permitidas (lista fechada: evita texto arbitrário como "reação"). */
export const CHAT_REACTIONS = ["👍", "❤️", "😂", "🎉", "😮", "😢", "🙏", "👀", "✅", "🔥", "👏", "💡"] as const;

export const CHAT_DEPARTMENTS = ["Geral", "Criação", "Atendimento", "Comercial", "Produção"] as const;

export const CHAT_LIMITS = {
  bodyMax: 8000,
  attachmentsPerMessage: 10,
  historyPage: 50,
} as const;
