import { readFileSync } from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Actor } from "@/server/authz";
import { withOrg } from "@/server/db";
import { trendObservations, trends, trendSources } from "@/server/db/schema";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { createClient } from "@/server/services/clients";
import {
  createCollection,
  deleteSource,
  getTrend,
  growthEvidence,
  listSources,
  listTrends,
  refreshDueSources,
  refreshSources,
  saveRssSource,
  setCollectionMembership,
  setSourceEnabled,
  setTrendState,
} from "@/server/services/trends";
import { brDatesForYear, easter, upcomingBrDates } from "@/server/trends/br-dates";
import { parseGoogleTrendsRss } from "@/server/trends/connectors/google-trends";
import { parseFeed, validateFeedUrl } from "@/server/trends/connectors/rss";
import { ConnectorError } from "@/server/trends/connectors/types";
import { parseWikimediaTop } from "@/server/trends/connectors/wikimedia";
import { parseYoutubePopular } from "@/server/trends/connectors/youtube";
import { findAll, parseXml } from "@/server/trends/xml";
import { addMember, as, createOrgWithOwner, resetDb } from "./helpers";

/*
 * Os hosts das fontes não são alcançáveis neste ambiente: os conectores são
 * testados com respostas GRAVADAS (tests/fixtures/trends, marcadas como
 * fixtures, formato real e conteúdo fictício) injetadas no lugar do fetch.
 */
const fx = (name: string) => readFileSync(path.join(__dirname, "fixtures", "trends", name), "utf8");
const GOOGLE = fx("google-trends-br.xml");
const WIKI = fx("wikimedia-top.json");
const YOUTUBE = fx("youtube-popular.json");
const RSS = fx("feed-rss.xml");
const ATOM = fx("feed-atom.xml");
const RSS_URL = "https://blog.exemplo.com.br/feed";

function fakeFetch(overrides: { google?: string; fail?: RegExp } = {}) {
  const calls: string[] = [];
  const fetchText = async (url: string) => {
    calls.push(url);
    if (overrides.fail?.test(url)) throw new ConnectorError("A fonte respondeu 503.");
    if (url.startsWith("https://trends.google.com/trending/rss")) return overrides.google ?? GOOGLE;
    if (url.startsWith("https://wikimedia.org/api/rest_v1/metrics/pageviews/top/")) return WIKI;
    if (url.startsWith("https://www.googleapis.com/youtube/v3/videos")) return YOUTUBE;
    if (url === RSS_URL) return RSS;
    throw new ConnectorError("A fonte respondeu 404.");
  };
  return { fetchText, calls };
}

const spec = { kind: "google_trends" as const, config: { geo: "BR" }, region: "BR", language: "pt", niche: null };

describe("conectores (respostas gravadas)", () => {
  it("Google Trends: tráfego aproximado exatamente como informado", () => {
    const items = parseGoogleTrendsRss(GOOGLE, spec);
    expect(items.map((i) => i.title)).toEqual([
      "Festival de Café Fictício",
      "Lançamento do Aplicativo Exemplo",
      "Clássico Regional Exemplo",
    ]);
    const [first, , third] = items;
    expect(first!.externalId).toBe("BR:festival-de-cafe-ficticio");
    expect(first!.metrics).toEqual([
      expect.objectContaining({ key: "approx_traffic", value: "2000+", numeric: 2000, asOf: "2026-10-16" }),
    ]);
    expect(third!.metrics[0]).toMatchObject({ value: "10.000+", numeric: 10000 });
    expect(first!.rank).toBe(1);
    expect(first!.url).toBe("https://noticias.exemplo.invalid/festival-cafe");
    expect(first!.related[1]!.title).toBe("Programação do festival & horários");
    // Sem notícias relacionadas: sem link nem resumo inventados.
    expect(third!.url).toBeNull();
    expect(third!.related).toEqual([]);
  });

  it("Wikimedia: contagens reais do dia informado e páginas de sistema ignoradas", () => {
    const r = parseWikimediaTop(WIKI, { config: { project: "pt.wikipedia" } });
    expect(r.dataDate).toBe("2026-10-16");
    expect(r.items.map((i) => i.title)).toEqual(["Festival de Café Fictício", "Cidade Exemplo", "Banda Exemplo"]);
    expect(r.items[0]!.metrics).toEqual([
      expect.objectContaining({ key: "pageviews", numeric: 48210, asOf: "2026-10-16" }),
      expect.objectContaining({ key: "rank", numeric: 3 }),
    ]);
    expect(r.items[0]!.url).toContain("pt.wikipedia.org/wiki/");
  });

  it("YouTube: só as estatísticas que a API devolve", () => {
    const r = parseYoutubePopular(
      YOUTUBE,
      { config: { region: "BR" }, region: "BR" },
      new Date("2026-10-17T12:00:00Z"),
    );
    expect(r.items).toHaveLength(2);
    expect(r.items[0]!.metrics.map((m) => [m.key, m.numeric])).toEqual([
      ["views", 154320],
      ["likes", 9876],
      ["comments", 432],
    ]);
    // O segundo vídeo não informa curtidas nem comentários: nada é preenchido.
    expect(r.items[1]!.metrics.map((m) => m.key)).toEqual(["views"]);
    expect(r.items[1]!.niche).toBe("tecnologia");
    expect(() =>
      parseYoutubePopular('{"error":{"message":"quota"}}', { config: {}, region: "BR" }, new Date()),
    ).toThrow(ConnectorError);
  });

  it("RSS e Atom: título, resumo, link e data — sem números de popularidade", () => {
    const rss = parseFeed(RSS, { region: "BR", language: "pt", niche: "marketing" });
    expect(rss).toHaveLength(2);
    expect(rss[0]).toMatchObject({
      title: "Nova ferramenta de vídeos curtos (exemplo)",
      url: "https://blog.exemplo.invalid/ferramenta-videos",
    });
    expect(rss[0]!.summary).toBe("Rede social fictícia lança recurso para criadores.");
    expect(rss[1]!.publishedAt?.toISOString()).toBe("2026-10-14T12:00:00.000Z");
    expect(rss.every((i) => i.metrics.length === 0)).toBe(true);
    const atom = parseFeed(ATOM, { region: "BR", language: "pt", niche: null });
    expect(atom).toHaveLength(1);
    expect(atom[0]!.url).toBe("https://revista.exemplo.invalid/paletas");
    expect(() =>
      parseFeed("<html><body>não é feed</body></html>", { region: null, language: null, niche: null }),
    ).toThrow();
  });

  it("o leitor de XML descarta DOCTYPE e nunca expande entidades declaradas", () => {
    const doc = parseXml(
      '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><x>&e; &amp; ok</x>',
    );
    const [x] = findAll(doc, "x");
    expect(x!.text).toBe("&e; & ok");
    expect(doc.text.trim()).toBe("");
  });

  it("valida endereços de feed (sem rede interna nem credenciais)", () => {
    expect(validateFeedUrl("https://blog.exemplo.com.br/feed")).toBe("https://blog.exemplo.com.br/feed");
    for (const bad of [
      "file:///etc/passwd",
      "ftp://exemplo.com/feed",
      "http://localhost:3000/feed",
      "http://127.0.0.1/feed",
      "http://10.0.0.5/feed",
      "http://192.168.0.1/rss",
      "http://169.254.169.254/latest/meta-data",
      "https://usuario:senha@exemplo.com/feed",
    ]) {
      expect(() => validateFeedUrl(bad), bad).toThrow();
    }
  });
});

describe("calendário de datas comemorativas", () => {
  it("calcula as datas móveis a partir da Páscoa", () => {
    expect(easter(2026).toISOString().slice(0, 10)).toBe("2026-04-05");
    expect(easter(2027).toISOString().slice(0, 10)).toBe("2027-03-28");
    const by = Object.fromEntries(brDatesForYear(2026).map((d) => [d.slug, d.date]));
    expect(by["carnaval"]).toBe("2026-02-17");
    expect(by["sexta-feira-santa"]).toBe("2026-04-03");
    expect(by["corpus-christi"]).toBe("2026-06-04");
    expect(by["dia-das-maes"]).toBe("2026-05-10");
    expect(by["dia-dos-pais"]).toBe("2026-08-09");
    expect(by["black-friday"]).toBe("2026-11-27");
    expect(by["cyber-monday"]).toBe("2026-11-30");
  });

  it("toda data cita a fonte e temas sensíveis são marcados", () => {
    const all = brDatesForYear(2026);
    expect(all.every((d) => d.source.length > 3)).toBe(true);
    expect(all.find((d) => d.slug === "finados")?.sensitive).toBe(true);
    const next = upcomingBrDates(new Date("2026-12-20T12:00:00Z"), 30).map((d) => d.date);
    expect(next).toContain("2026-12-25");
    expect(next).toContain("2027-01-01");
  });
});

describe("evidência de crescimento", () => {
  it("só compara números da própria fonte entre duas coletas", () => {
    const m = (n: number) => [{ key: "approx_traffic", label: "Tráfego", value: `${n}+`, numeric: n, asOf: null }];
    expect(growthEvidence([{ observedOn: "2026-10-17", rank: 1, metrics: m(2000) }]).growing).toBeNull();
    const up = growthEvidence([
      { observedOn: "2026-10-17", rank: 1, metrics: m(5000) },
      { observedOn: "2026-10-16", rank: 3, metrics: m(2000) },
    ]);
    expect(up.growing).toBe(true);
    expect(up.notes.join(" ")).toContain("de 2000+ (2026-10-16) para 5000+ (2026-10-17)");
    expect(up.notes.join(" ")).toContain("de 3º (2026-10-16) para 1º (2026-10-17)");
  });
});

/* ------------------------------------------------------------------ */

describe("coleta, consulta e isolamento", () => {
  let a: Awaited<ReturnType<typeof createOrgWithOwner>>;
  let b: Awaited<ReturnType<typeof createOrgWithOwner>>;
  let designer: Actor;
  const savedYt = process.env.YOUTUBE_API_KEY;

  beforeAll(async () => {
    await resetDb();
    delete process.env.YOUTUBE_API_KEY;
    a = await createOrgWithOwner("Agência Radar A");
    b = await createOrgWithOwner("Agência Radar B");
    designer = await addMember(a.org.slug, a.org.id, "designer");
  });

  afterEach(() => {
    if (savedYt === undefined) delete process.env.YOUTUBE_API_KEY;
    else process.env.YOUTUBE_API_KEY = savedYt;
  });

  it("cria as fontes padrão e mostra o YouTube indisponível sem chave", async () => {
    const sources = await as(a.actor, (s) => listSources(s));
    expect(sources.map((x) => x.key).sort()).toEqual([
      "calendar:BR",
      "google_trends:BR",
      "wikimedia:pt.wikipedia",
      "youtube:BR",
    ]);
    const yt = sources.find((x) => x.kind === "youtube")!;
    expect(yt.available).toBe(false);
    expect(yt.unavailableReason).toMatch(/YOUTUBE_API_KEY/);
    expect(sources.every((x) => x.info.terms && x.info.limits && x.info.cost)).toBe(true);
  });

  it("coleta com respostas gravadas, sem duplicar e com limite de frequência", async () => {
    const now = new Date();
    const f = fakeFetch();
    const first = await refreshSources(a.actor, { now, fetch: f.fetchText });
    const by = Object.fromEntries(first.map((r) => [r.name, r]));
    expect(by["Google Trends — Brasil"]).toMatchObject({ ok: true, count: 3 });
    expect(by["Wikipédia em português — mais vistos"]).toMatchObject({ ok: true, count: 3 });
    expect(by["YouTube — em alta no Brasil"]).toMatchObject({ ok: false });
    expect(by["YouTube — em alta no Brasil"]!.skipped).toMatch(/YOUTUBE_API_KEY/);
    expect(by["Datas comemorativas do Brasil"]!.ok).toBe(true);
    expect(f.calls.some((u) => u.includes("googleapis.com"))).toBe(false);

    // Botão apertado de novo logo em seguida: nada é buscado.
    const again = await refreshSources(a.actor, { now: new Date(now.getTime() + 60_000), fetch: f.fetchText });
    expect(again.every((r) => r.skipped)).toBe(true);
    expect(again.find((r) => r.name.startsWith("Google"))!.skipped).toMatch(/Tente em \d+ min/);

    // Depois do intervalo: mesma resposta não duplica tendências nem observações do dia.
    const later = new Date(now.getTime() + 16 * 60_000);
    await refreshSources(a.actor, { now: later, fetch: f.fetchText });
    const rows = await withOrg(a.org.id, (tx) => tx.select().from(trends).where(eq(trends.platform, "google_trends")));
    expect(rows).toHaveLength(3);
    const obs = await withOrg(a.org.id, (tx) =>
      tx.select().from(trendObservations).where(eq(trendObservations.trendId, rows[0]!.id)),
    );
    expect(obs.length).toBeLessThanOrEqual(2); // a janela de 16 min pode cruzar a meia-noite UTC
  });

  it("registra a falha real da fonte sem apagar o último sucesso", async () => {
    const [google] = await withOrg(a.org.id, (tx) =>
      tx
        .select()
        .from(trendSources)
        .where(and(eq(trendSources.organizationId, a.org.id), eq(trendSources.kind, "google_trends"))),
    );
    const before = google!.lastSuccessAt;
    const r = await refreshSources(a.actor, {
      sourceId: google!.id,
      now: new Date(Date.now() + 40 * 60_000),
      fetch: fakeFetch({ fail: /trends\.google\.com/ }).fetchText,
    });
    expect(r).toEqual([expect.objectContaining({ ok: false, error: "A fonte respondeu 503." })]);
    const [after] = await withOrg(a.org.id, (tx) =>
      tx.select().from(trendSources).where(eq(trendSources.id, google!.id)),
    );
    expect(after!.lastError).toBe("A fonte respondeu 503.");
    expect(after!.lastSuccessAt?.getTime()).toBe(before?.getTime());
    expect(after!.runningSince).toBeNull();
  });

  it("mostra crescimento só com duas coletas em dias diferentes", async () => {
    const [google] = await withOrg(a.org.id, (tx) =>
      tx.select().from(trendSources).where(eq(trendSources.kind, "google_trends")),
    );
    const tomorrow = new Date(Date.now() + 26 * 3_600_000);
    await refreshSources(a.actor, {
      sourceId: google!.id,
      now: tomorrow,
      fetch: fakeFetch({ google: GOOGLE.replace("<ht:approx_traffic>2000+", "<ht:approx_traffic>5000+") }).fetchText,
    });
    const list = await as(a.actor, (s) => listTrends(s, { platform: "google_trends" }));
    const festival = list.rows.find((r) => r.title === "Festival de Café Fictício")!;
    expect(festival.metrics[0]!.value).toBe("5000+");
    expect(festival.growth.growing).toBe(true);
    expect(festival.growth.notes[0]).toContain("de 2000+");
  });

  it("filtra por plataforma, nicho, período e abas pessoais", async () => {
    const all = await as(a.actor, (s) => listTrends(s, {}));
    expect(all.total).toBeGreaterThan(0);
    const wiki = await as(a.actor, (s) => listTrends(s, { platform: "wikipedia" }));
    expect(wiki.rows.every((r) => r.platform === "wikipedia")).toBe(true);
    const dates = await as(a.actor, (s) => listTrends(s, { period: "proximos" }));
    expect(dates.rows.length).toBeGreaterThan(0);
    expect(dates.rows.every((r) => r.platform === "calendar" && r.type === "sazonal")).toBe(true);
    const datesNiche = await as(a.actor, (s) => listTrends(s, { niche: "datas", period: "30d" }));
    expect(datesNiche.rows.every((r) => r.niche === "datas")).toBe(true);

    const target = wiki.rows[0]!;
    await as(a.actor, (s) => setTrendState(s, { trendId: target.id, saved: true, favorite: true }));
    const saved = await as(a.actor, (s) => listTrends(s, { tab: "saved" }));
    expect(saved.rows.map((r) => r.id)).toEqual([target.id]);
    // Estado é pessoal: outra pessoa da equipe não vê como salva.
    expect((await as(designer, (s) => listTrends(s, { tab: "saved" }))).rows).toHaveLength(0);

    await as(a.actor, (s) => setTrendState(s, { trendId: target.id, dismissed: true }));
    const visible = await as(a.actor, (s) => listTrends(s, { platform: "wikipedia" }));
    expect(visible.rows.map((r) => r.id)).not.toContain(target.id);
    expect((await as(a.actor, (s) => listTrends(s, { tab: "dismissed" }))).rows.map((r) => r.id)).toEqual([target.id]);

    const col = await as(a.actor, (s) => createCollection(s, { name: "Campanha de verão" }));
    await as(a.actor, (s) => setCollectionMembership(s, col.id, wiki.rows[1]!.id, true));
    const inCol = await as(a.actor, (s) => listTrends(s, { collectionId: col.id }));
    expect(inCol.rows.map((r) => r.id)).toEqual([wiki.rows[1]!.id]);
    expect(inCol.rows[0]!.collectionIds).toEqual([col.id]);
  });

  it("permissões: ver exige trends.read; atualizar e fontes exigem trends.manage", async () => {
    expect((await as(designer, (s) => listTrends(s, {}))).total).toBeGreaterThan(0);
    await expect(refreshSources(designer, { fetch: fakeFetch().fetchText })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(as(designer, (s) => saveRssSource(s, { name: "Blog", url: RSS_URL }))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    const finance = await addMember(a.org.slug, a.org.id, "finance");
    await expect(as(finance, (s) => listTrends(s, {}))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("clientes do portal não veem o Radar", async () => {
    const client = await as(a.actor, (s) => createClient(s, { name: "Cliente Portal Radar" }));
    const portal = await addMember(a.org.slug, a.org.id, "client", { clientIds: [client.id] });
    expect([...portal.permissions].some((p) => p.startsWith("trends.") || p.startsWith("content."))).toBe(false);
    await expect(as(portal, (s) => listTrends(s, {}))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(as(portal, (s) => listSources(s))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("feeds RSS por organização: validação, duplicidade, coleta e remoção", async () => {
    await expect(
      as(a.actor, (s) => saveRssSource(s, { name: "Interno", url: "http://localhost/feed" })),
    ).rejects.toBeInstanceOf(ValidationError);
    const { id } = await as(a.actor, (s) =>
      saveRssSource(s, { name: "Blog Exemplo", url: RSS_URL, niche: "Marketing" }),
    );
    await expect(as(a.actor, (s) => saveRssSource(s, { name: "De novo", url: RSS_URL }))).rejects.toBeInstanceOf(
      ValidationError,
    );
    const r = await refreshSources(a.actor, { sourceId: id, fetch: fakeFetch().fetchText });
    expect(r[0]).toMatchObject({ ok: true, count: 2 });
    const news = await as(a.actor, (s) => listTrends(s, { platform: "news" }));
    expect(news.rows).toHaveLength(2);
    expect(news.rows.every((n) => n.niche === "marketing" && n.metrics.length === 0)).toBe(true);
    await as(a.actor, (s) => setSourceEnabled(s, id, false));
    expect(
      (await refreshSources(a.actor, { sourceId: id, fetch: fakeFetch().fetchText }).catch((e) => e)) instanceof
        NotFoundError,
    ).toBe(true);
    const defaults = await as(a.actor, (s) => listSources(s));
    await expect(as(a.actor, (s) => deleteSource(s, defaults.find((x) => x.isDefault)!.id))).rejects.toBeInstanceOf(
      ValidationError,
    );
    await as(a.actor, (s) => deleteSource(s, id));
    expect((await as(a.actor, (s) => listTrends(s, { platform: "news" }))).rows).toHaveLength(0);
  });

  it("isolamento: outra agência não vê as tendências nem as fontes", async () => {
    const mine = await as(a.actor, (s) => listTrends(s, {}));
    const theirs = await as(b.actor, (s) => listTrends(s, {}));
    expect(theirs.total).toBe(0);
    await expect(as(b.actor, (s) => getTrend(s, mine.rows[0]!.id))).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      as(b.actor, (s) => setTrendState(s, { trendId: mine.rows[0]!.id, saved: true })),
    ).rejects.toBeInstanceOf(NotFoundError);
    const sources = await as(b.actor, (s) => listSources(s));
    expect(sources.every((x) => x.organizationId === b.org.id && !x.lastSuccessAt)).toBe(true);
  });

  it("rotina automática: coleta fontes vencidas de todas as agências, com cache por rodada", async () => {
    const f = fakeFetch();
    const r = await refreshDueSources({ now: new Date(Date.now() + 7 * 3_600_000), fetch: f.fetchText });
    expect(r.ok).toBeGreaterThan(0);
    // Google Trends BR é igual para as duas agências: uma só requisição na rodada.
    expect(f.calls.filter((u) => u.startsWith("https://trends.google.com")).length).toBe(1);
    const bTrends = await as(b.actor, (s) => listTrends(s, { platform: "google_trends" }));
    expect(bTrends.total).toBe(3);
  });

  it("YouTube com chave no servidor (só servidor; nunca no banco)", async () => {
    process.env.YOUTUBE_API_KEY = "chave-teste-servidor";
    const [yt] = await withOrg(a.org.id, (tx) =>
      tx.select().from(trendSources).where(eq(trendSources.kind, "youtube")),
    );
    const f = fakeFetch();
    const r = await refreshSources(a.actor, {
      sourceId: yt!.id,
      now: new Date(Date.now() + 9 * 3_600_000),
      fetch: f.fetchText,
    });
    expect(r[0]).toMatchObject({ ok: true, count: 2 });
    expect(f.calls[0]).toContain("key=chave-teste-servidor");
    const [saved] = await withOrg(a.org.id, (tx) => tx.select().from(trendSources).where(eq(trendSources.id, yt!.id)));
    expect(JSON.stringify(saved!.config)).not.toContain("chave-teste-servidor");
  });
});
