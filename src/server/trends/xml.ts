/*
 * Leitor de XML mínimo e tolerante para feeds (RSS 2.0, Atom e o feed do
 * Google Trends). Não executa nada do documento: só monta uma árvore de
 * elementos com texto. Ignora DOCTYPE/entidades externas (sem XXE).
 */

export type XmlNode = { name: string; attrs: Record<string, string>; children: XmlNode[]; text: string };

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  laquo: "«",
  raquo: "»",
  ccedil: "ç",
  Ccedil: "Ç",
  atilde: "ã",
  otilde: "õ",
  aacute: "á",
  eacute: "é",
  iacute: "í",
  oacute: "ó",
  uacute: "ú",
  agrave: "à",
  acirc: "â",
  ecirc: "ê",
  ocirc: "ô",
  Aacute: "Á",
  Eacute: "É",
  Iacute: "Í",
  Oacute: "Ó",
  Uacute: "Ú",
  Atilde: "Ã",
};

/** Decodifica entidades (nomeadas comuns e numéricas). Desconhecidas ficam como estão. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);/g, (m, code: string) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return NAMED[code] ?? m;
  });
}

/** Remove HTML e espaços excedentes (descrições de feeds costumam vir em HTML). */
export function stripHtml(s: string): string {
  return decodeEntities(
    s
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<\/p>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function parseAttrs(src: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) attrs[m[1]!] = decodeEntities(m[3] ?? m[4] ?? "");
  return attrs;
}

export function parseXml(xml: string): XmlNode {
  const root: XmlNode = { name: "#root", attrs: {}, children: [], text: "" };
  const stack: XmlNode[] = [root];
  let i = 0;
  const len = xml.length;
  while (i < len) {
    const lt = xml.indexOf("<", i);
    const top = stack[stack.length - 1]!;
    if (lt === -1) {
      top.text += decodeEntities(xml.slice(i));
      break;
    }
    if (lt > i) top.text += decodeEntities(xml.slice(i, lt));
    if (xml.startsWith("<![CDATA[", lt)) {
      const end = xml.indexOf("]]>", lt + 9);
      top.text += xml.slice(lt + 9, end === -1 ? len : end);
      i = end === -1 ? len : end + 3;
    } else if (xml.startsWith("<!--", lt)) {
      const end = xml.indexOf("-->", lt + 4);
      i = end === -1 ? len : end + 3;
    } else if (/^<!DOCTYPE/i.test(xml.slice(lt, lt + 9))) {
      // DOCTYPE, inclusive o subconjunto interno [...], é descartado: entidades declaradas nunca são expandidas.
      const close = xml.indexOf(">", lt);
      const bracket = xml.indexOf("[", lt);
      const subset = bracket !== -1 && (close === -1 || bracket < close);
      const end = subset ? xml.indexOf("]>", bracket) : close;
      i = end === -1 ? len : end + (subset ? 2 : 1);
    } else if (xml.startsWith("<?", lt) || xml.startsWith("<!", lt)) {
      // Declaração, instrução de processamento ou DOCTYPE: ignorados (sem entidades externas).
      const end = xml.indexOf(">", lt + 2);
      i = end === -1 ? len : end + 1;
    } else if (xml[lt + 1] === "/") {
      const end = xml.indexOf(">", lt + 2);
      const name = xml.slice(lt + 2, end === -1 ? len : end).trim();
      // Fecha até o elemento correspondente (tolera fechamentos fora de ordem).
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k]!.name === name) {
          stack.length = k;
          break;
        }
      }
      i = end === -1 ? len : end + 1;
    } else {
      const end = xml.indexOf(">", lt + 1);
      if (end === -1) break;
      let inner = xml.slice(lt + 1, end);
      const selfClosing = inner.endsWith("/");
      if (selfClosing) inner = inner.slice(0, -1);
      const space = inner.search(/\s/);
      const name = (space === -1 ? inner : inner.slice(0, space)).trim();
      const node: XmlNode = {
        name,
        attrs: space === -1 ? {} : parseAttrs(inner.slice(space)),
        children: [],
        text: "",
      };
      top.children.push(node);
      if (!selfClosing) stack.push(node);
      i = end + 1;
    }
  }
  return root;
}

/** Nome sem prefixo de namespace ("ht:approx_traffic" → "approx_traffic"). */
export function localName(name: string): string {
  const c = name.indexOf(":");
  return c === -1 ? name : name.slice(c + 1);
}

export function children(node: XmlNode, name: string): XmlNode[] {
  return node.children.filter((c) => c.name === name || localName(c.name) === name);
}

export function child(node: XmlNode, name: string): XmlNode | undefined {
  return node.children.find((c) => c.name === name || localName(c.name) === name);
}

/** Texto de um filho (com prefixo exato, se informado, ou pelo nome local). */
export function childText(node: XmlNode, name: string): string {
  return (child(node, name)?.text ?? "").trim();
}

/** Busca em profundidade todos os elementos com o nome local informado. */
export function findAll(node: XmlNode, name: string, out: XmlNode[] = []): XmlNode[] {
  for (const c of node.children) {
    if (c.name === name || localName(c.name) === name) out.push(c);
    findAll(c, name, out);
  }
  return out;
}
