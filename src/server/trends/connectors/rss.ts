import { createHash } from "node:crypto";
import { child, childText, children, findAll, parseXml, stripHtml, type XmlNode } from "../xml";
import type { CollectedItem, CollectResult, SourceSpec, TrendConnector } from "./types";
import { ConnectorError } from "./types";

/*
 * Feeds RSS 2.0 / Atom escolhidos pela agência (veículos especializados por
 * nicho). Notícias não trazem indicadores de popularidade: o Radar não
 * inventa nenhum — mostra só título, resumo, link e data do veículo.
 */

/** Só endereços públicos http(s); bloqueia rede interna e credenciais embutidas. */
export function validateFeedUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new ConnectorError("Endereço do feed inválido.");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new ConnectorError("Use um endereço http(s).");
  if (u.username || u.password) throw new ConnectorError("O endereço não pode conter usuário ou senha.");
  const host = u.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".internal") ||
    host.endsWith(".local") ||
    /^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) ||
    host === "[::1]" ||
    /^\[?(fc|fd|fe80)/i.test(host)
  ) {
    throw new ConnectorError("Endereços de rede interna não são permitidos.");
  }
  return u.toString();
}

function hashId(s: string) {
  return createHash("sha256").update(s).digest("hex").slice(0, 32);
}

function parseDate(s: string): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function atomLink(entry: XmlNode): string | null {
  const links = children(entry, "link");
  const alt = links.find((l) => !l.attrs.rel || l.attrs.rel === "alternate") ?? links[0];
  return alt?.attrs.href ?? (alt?.text.trim() || null);
}

export function parseFeed(
  xml: string,
  spec: Pick<SourceSpec, "niche" | "region" | "language">,
  limit = 30,
): CollectedItem[] {
  const doc = parseXml(xml);
  const rssItems = findAll(doc, "item");
  const atomEntries = rssItems.length ? [] : findAll(doc, "entry");
  if (!rssItems.length && !atomEntries.length) {
    if (!findAll(doc, "rss").length && !findAll(doc, "feed").length && !findAll(doc, "RDF").length) {
      throw new ConnectorError("O endereço não devolveu um feed RSS ou Atom.");
    }
  }
  const base = { niche: spec.niche, region: spec.region, language: spec.language, platform: "news" as const };
  const out: CollectedItem[] = [];
  for (const it of rssItems) {
    const title = stripHtml(childText(it, "title"));
    if (!title) continue;
    const link = childText(it, "link") || null;
    const guid = childText(it, "guid");
    const body = child(it, "encoded")?.text || childText(it, "description");
    out.push({
      ...base,
      externalId: guid ? `guid:${hashId(guid)}` : link ? `link:${hashId(link)}` : `title:${hashId(title)}`,
      title,
      summary: stripHtml(body).slice(0, 500) || null,
      url: link,
      publishedAt: parseDate(childText(it, "pubDate") || childText(it, "date")),
      eventDate: null,
      rank: null,
      metrics: [],
      related: [],
    });
  }
  for (const e of atomEntries) {
    const title = stripHtml(childText(e, "title"));
    if (!title) continue;
    const link = atomLink(e);
    const id = childText(e, "id");
    out.push({
      ...base,
      externalId: id ? `id:${hashId(id)}` : link ? `link:${hashId(link)}` : `title:${hashId(title)}`,
      title,
      summary: stripHtml(childText(e, "summary") || childText(e, "content")).slice(0, 500) || null,
      url: link,
      publishedAt: parseDate(childText(e, "published") || childText(e, "updated")),
      eventDate: null,
      rank: null,
      metrics: [],
      related: [],
    });
  }
  return out.slice(0, limit);
}

export const rssConnector: TrendConnector = {
  kind: "rss",
  info: {
    label: "Feeds RSS/Atom de veículos",
    endpoint: "Endereço do feed informado pela agência (RSS 2.0 ou Atom).",
    terms:
      "Use apenas feeds que o próprio veículo oferece publicamente e respeite os termos de cada site. O Radar guarda título, resumo curto e link — o conteúdo completo fica no site do veículo.",
    limits:
      "Definidos por cada veículo. O Radar consulta cada feed a cada 6 horas (rotina) e, à mão, no máximo a cada 15 minutos.",
    cost: "Gratuito (depende do veículo).",
    freshness: "Conforme o veículo publica; a data de publicação de cada notícia é mostrada.",
    indicators: "Nenhum: notícias não trazem números de audiência. Aparecer em uma notícia não torna um assunto viral.",
    docs: "https://www.rssboard.org/rss-specification",
  },
  availability: () => ({ ok: true }),
  async collect(spec, fetchText): Promise<CollectResult> {
    const url = validateFeedUrl(spec.config.url ?? "");
    return { items: parseFeed(await fetchText(url), spec), dataDate: null };
  },
};
