import { createHash } from "node:crypto";
import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { normalizeNiche, TREND_NICHES, trendListParams, type TrendListParams } from "@/lib/trends";
import { todayISO } from "@/lib/format";
import { assertCan, assertInternal, clientScope, type Scope } from "@/server/authz";
import { withOrg, withSystem, type Tx } from "@/server/db";
import { inSequence } from "@/server/db/sequence";
import {
  clients,
  trendAnalyses,
  trendCollectionItems,
  trendCollections,
  trendObservations,
  trends,
  trendSources,
  trendUserStates,
  type TrendMetric,
} from "@/server/db/schema";
import { NotFoundError, ValidationError } from "@/server/errors";
import {
  CONNECTORS,
  ConnectorError,
  fetchText as defaultFetchText,
  type CollectedItem,
  type TrendSourceKind,
} from "@/server/trends/connectors";
import type { FetchText } from "@/server/trends/connectors/types";
import { validateFeedUrl } from "@/server/trends/connectors/rss";
import { recordActivity } from "./activity";

/*
 * Radar de Tendências: fontes, coleta e consulta. A coleta grava somente o
 * que a fonte devolveu (idempotente por fonte + id externo) e uma observação
 * por dia, que permite mostrar evidência de crescimento entre coletas.
 */

/** Intervalo mínimo entre coletas manuais de uma mesma fonte. */
export const MANUAL_INTERVAL_MIN = 15;
/** Intervalo entre coletas automáticas (rotina diária ou mais frequente). */
const AUTO_INTERVAL_MIN = 6 * 60;
/** Tempo máximo de uma coleta antes de a trava ser considerada abandonada. */
const LOCK_MIN = 5;

type SourceRow = typeof trendSources.$inferSelect;

/* ------------------------------------------------------------------ */
/* Fontes                                                              */
/* ------------------------------------------------------------------ */

const DEFAULT_SOURCES: {
  kind: TrendSourceKind;
  key: string;
  name: string;
  config: Record<string, string>;
  region: string;
  language: string;
  niche: string | null;
}[] = [
  {
    kind: "google_trends",
    key: "google_trends:BR",
    name: "Google Trends — Brasil",
    config: { geo: "BR" },
    region: "BR",
    language: "pt",
    niche: null,
  },
  {
    kind: "wikimedia",
    key: "wikimedia:pt.wikipedia",
    name: "Wikipédia em português — mais vistos",
    config: { project: "pt.wikipedia" },
    region: "BR",
    language: "pt",
    niche: null,
  },
  {
    kind: "youtube",
    key: "youtube:BR",
    name: "YouTube — em alta no Brasil",
    config: { region: "BR" },
    region: "BR",
    language: "pt",
    niche: null,
  },
  {
    kind: "calendar",
    key: "calendar:BR",
    name: "Datas comemorativas do Brasil",
    config: { days: "60" },
    region: "BR",
    language: "pt",
    niche: "datas",
  },
];

/** Cria as fontes padrão da organização (idempotente). */
export async function ensureDefaultSources(s: Scope) {
  await s.db
    .insert(trendSources)
    .values(DEFAULT_SOURCES.map((d) => ({ ...d, organizationId: s.actor.orgId, isDefault: true })))
    .onConflictDoNothing({ target: [trendSources.organizationId, trendSources.key] });
}

export async function listSources(s: Scope) {
  assertInternal(s.actor);
  assertCan(s.actor, "trends.read");
  await ensureDefaultSources(s);
  const rows = await s.db
    .select({
      source: trendSources,
      items: sql<number>`(select count(*)::int from ${trends} where ${trends.sourceId} = ${trendSources.id})`,
    })
    .from(trendSources)
    .orderBy(desc(trendSources.isDefault), asc(trendSources.name));
  return rows.map(({ source, items }) => {
    const connector = CONNECTORS[source.kind];
    const availability = connector.availability();
    return {
      ...source,
      items,
      info: connector.info,
      available: availability.ok,
      unavailableReason: availability.ok ? null : availability.reason,
    };
  });
}

export const rssSourceInput = z.object({
  name: z.string().trim().min(2, "Informe o nome do veículo").max(120),
  url: z.string().trim().min(8, "Informe o endereço do feed").max(1000),
  niche: z.string().trim().max(60).optional().nullable(),
  region: z.string().trim().max(10).optional().nullable(),
  language: z.string().trim().max(10).optional().nullable(),
});

export async function saveRssSource(s: Scope, raw: z.input<typeof rssSourceInput>) {
  assertInternal(s.actor);
  assertCan(s.actor, "trends.manage");
  const data = rssSourceInput.parse(raw);
  let url: string;
  try {
    url = validateFeedUrl(data.url);
  } catch (err) {
    throw new ValidationError((err as Error).message, { url: [(err as Error).message] });
  }
  const niche = data.niche ? normalizeNiche(data.niche) : null;
  const key = `rss:${createHash("sha256").update(url).digest("hex").slice(0, 24)}`;
  const [row] = await s.db
    .insert(trendSources)
    .values({
      organizationId: s.actor.orgId,
      kind: "rss",
      key,
      name: data.name,
      config: { url },
      niche,
      region: data.region || null,
      language: data.language || null,
      createdByUserId: s.actor.userId,
    })
    .onConflictDoNothing({ target: [trendSources.organizationId, trendSources.key] })
    .returning({ id: trendSources.id });
  if (!row) throw new ValidationError("Este feed já está cadastrado.", { url: ["Feed já cadastrado"] });
  await recordActivity(s, {
    action: "created",
    entityType: "trend_source",
    entityId: row.id,
    summary: `Fonte de tendências adicionada: ${data.name}`,
    event: false,
  });
  return { id: row.id };
}

async function loadSource(s: Scope, id: string): Promise<SourceRow> {
  const [row] = await s.db.select().from(trendSources).where(eq(trendSources.id, id));
  if (!row) throw new NotFoundError("Fonte não encontrada.");
  return row;
}

export async function setSourceEnabled(s: Scope, id: string, enabled: boolean) {
  assertInternal(s.actor);
  assertCan(s.actor, "trends.manage");
  const src = await loadSource(s, id);
  await s.db.update(trendSources).set({ enabled }).where(eq(trendSources.id, id));
  await recordActivity(s, {
    action: enabled ? "enabled" : "disabled",
    entityType: "trend_source",
    entityId: id,
    summary: `Fonte ${enabled ? "ativada" : "desativada"}: ${src.name}`,
    event: false,
  });
}

/** Só feeds cadastrados pela agência podem ser removidos (as tendências deles saem junto). */
export async function deleteSource(s: Scope, id: string) {
  assertInternal(s.actor);
  assertCan(s.actor, "trends.manage");
  const src = await loadSource(s, id);
  if (src.isDefault) throw new ValidationError("Fontes padrão não podem ser removidas; desative-as se preferir.");
  await s.db.delete(trendSources).where(eq(trendSources.id, id));
  await recordActivity(s, {
    action: "deleted",
    entityType: "trend_source",
    entityId: id,
    summary: `Fonte removida: ${src.name}`,
    event: false,
  });
}

/* ------------------------------------------------------------------ */
/* Coleta                                                              */
/* ------------------------------------------------------------------ */

export type RunResult = {
  sourceId: string;
  name: string;
  ok: boolean;
  count: number;
  skipped?: string;
  error?: string;
};

/** Grava os itens da fonte (idempotente) e uma observação por tendência e dia. */
export async function upsertItems(tx: Tx, orgId: string, sourceId: string, items: CollectedItem[], now: Date) {
  const day = now.toISOString().slice(0, 10);
  let count = 0;
  // Um item repetido na mesma coleta conta uma vez.
  const unique = [...new Map(items.map((i) => [i.externalId, i])).values()];
  for (const item of unique) {
    const [row] = await tx
      .insert(trends)
      .values({
        organizationId: orgId,
        sourceId,
        externalId: item.externalId.slice(0, 500),
        title: item.title.slice(0, 500),
        summary: item.summary?.slice(0, 2000) ?? null,
        url: item.url?.slice(0, 2000) ?? null,
        platform: item.platform,
        niche: item.niche,
        region: item.region,
        language: item.language,
        publishedAt: item.publishedAt,
        eventDate: item.eventDate,
        firstSeenAt: now,
        lastSeenAt: now,
        metrics: item.metrics,
        related: item.related,
      })
      .onConflictDoUpdate({
        target: [trends.organizationId, trends.sourceId, trends.externalId],
        set: {
          title: sql`excluded.title`,
          summary: sql`coalesce(excluded.summary, ${trends.summary})`,
          url: sql`coalesce(excluded.url, ${trends.url})`,
          publishedAt: sql`coalesce(excluded.published_at, ${trends.publishedAt})`,
          eventDate: sql`coalesce(excluded.event_date, ${trends.eventDate})`,
          niche: sql`coalesce(${trends.niche}, excluded.niche)`,
          lastSeenAt: now,
          metrics: sql`excluded.metrics`,
          related: sql`excluded.related`,
          updatedAt: now,
        },
      })
      .returning({ id: trends.id });
    if (!row) continue;
    await tx
      .insert(trendObservations)
      .values({
        organizationId: orgId,
        trendId: row.id,
        observedOn: day,
        observedAt: now,
        rank: item.rank,
        metrics: item.metrics,
      })
      .onConflictDoUpdate({
        target: [trendObservations.trendId, trendObservations.observedOn],
        set: { observedAt: now, rank: item.rank, metrics: item.metrics },
      });
    count++;
  }
  return count;
}

/**
 * Executa uma fonte: trava (sem coletas simultâneas), busca fora de
 * transação, grava em seguida e registra sucesso ou erro. A rede nunca fica
 * aberta dentro de uma transação do banco.
 */
export async function runSource(
  orgId: string,
  source: SourceRow,
  opts: { now?: Date; fetch?: FetchText; cache?: Map<string, Promise<CollectedItem[]>> } = {},
): Promise<RunResult> {
  const now = opts.now ?? new Date();
  const base = { sourceId: source.id, name: source.name };
  const connector = CONNECTORS[source.kind];
  const availability = connector.availability();
  if (!availability.ok) {
    await withOrg(orgId, (tx) =>
      tx.update(trendSources).set({ lastError: availability.reason }).where(eq(trendSources.id, source.id)),
    );
    return { ...base, ok: false, count: 0, skipped: availability.reason };
  }
  const lockCutoff = new Date(now.getTime() - LOCK_MIN * 60_000);
  const locked = await withOrg(orgId, (tx) =>
    tx
      .update(trendSources)
      .set({ runningSince: now })
      .where(
        and(
          eq(trendSources.id, source.id),
          or(isNull(trendSources.runningSince), lte(trendSources.runningSince, lockCutoff)),
        ),
      )
      .returning({ id: trendSources.id }),
  );
  if (!locked.length) return { ...base, ok: false, count: 0, skipped: "Coleta já em andamento." };
  try {
    const spec = {
      kind: source.kind,
      config: source.config,
      region: source.region,
      language: source.language,
      niche: source.niche,
    };
    // Fontes iguais em várias organizações (ex.: Google Trends BR) são buscadas uma vez por rodada.
    const cacheKey = source.kind === "rss" ? null : `${source.kind}:${JSON.stringify(source.config)}`;
    let pending = cacheKey ? opts.cache?.get(cacheKey) : undefined;
    if (!pending) {
      pending = connector.collect(spec, opts.fetch ?? defaultFetchText, now).then((r) => r.items);
      if (cacheKey) opts.cache?.set(cacheKey, pending);
    }
    const items = (await pending).map((i) => (source.niche && !i.niche ? { ...i, niche: source.niche } : i));
    const count = await withOrg(orgId, async (tx) => {
      const n = await upsertItems(tx, orgId, source.id, items, now);
      await tx
        .update(trendSources)
        .set({ runningSince: null, lastRunAt: now, lastSuccessAt: now, lastError: null, lastItemCount: n })
        .where(eq(trendSources.id, source.id));
      return n;
    });
    return { ...base, ok: true, count };
  } catch (err) {
    const message =
      err instanceof ConnectorError ? err.message : "Falha inesperada na coleta (detalhes no registro do servidor).";
    if (!(err instanceof ConnectorError)) console.error(`[tendências] falha na fonte ${source.id}`, err);
    await withOrg(orgId, (tx) =>
      tx
        .update(trendSources)
        .set({ runningSince: null, lastRunAt: now, lastError: message.slice(0, 500) })
        .where(eq(trendSources.id, source.id)),
    );
    return { ...base, ok: false, count: 0, error: message };
  }
}

/**
 * Coleta manual (botão "Atualizar" ou "Testar agora"). Respeita o intervalo
 * mínimo por fonte para não sobrecarregar as fontes nem estourar cotas.
 */
export async function refreshSources(
  actor: Scope["actor"],
  opts: { sourceId?: string; now?: Date; fetch?: FetchText } = {},
): Promise<RunResult[]> {
  const now = opts.now ?? new Date();
  const sources = await withOrg(actor.orgId, async (tx) => {
    const s: Scope = { db: tx, actor };
    assertInternal(actor);
    assertCan(actor, "trends.manage");
    await ensureDefaultSources(s);
    return tx
      .select()
      .from(trendSources)
      .where(and(eq(trendSources.enabled, true), opts.sourceId ? eq(trendSources.id, opts.sourceId) : undefined));
  });
  if (opts.sourceId && !sources.length) throw new NotFoundError("Fonte não encontrada ou desativada.");
  const minGap = MANUAL_INTERVAL_MIN * 60_000;
  const results: RunResult[] = [];
  for (const src of sources) {
    if (src.lastRunAt && now.getTime() - src.lastRunAt.getTime() < minGap) {
      const wait = Math.ceil((minGap - (now.getTime() - src.lastRunAt.getTime())) / 60_000);
      results.push({
        sourceId: src.id,
        name: src.name,
        ok: false,
        count: 0,
        skipped: `Atualizada há pouco. Tente em ${wait} min.`,
      });
      continue;
    }
    results.push(await runSource(actor.orgId, src, { now, fetch: opts.fetch }));
  }
  await withOrg(actor.orgId, (tx) =>
    recordActivity(
      { db: tx, actor },
      {
        action: "refreshed",
        entityType: "trend_source",
        entityId: opts.sourceId ?? null,
        summary: `Radar de Tendências atualizado (${results.filter((r) => r.ok).length} de ${results.length} fontes)`,
        event: false,
      },
    ),
  );
  return results;
}

/** Rotina automática (cron): todas as organizações, fontes vencidas, com orçamento de tempo. */
export async function refreshDueSources(opts: { now?: Date; fetch?: FetchText; budgetMs?: number } = {}) {
  const now = opts.now ?? new Date();
  const started = Date.now();
  const budget = opts.budgetMs ?? 35_000;
  const cutoff = new Date(now.getTime() - AUTO_INTERVAL_MIN * 60_000);
  const due = await withSystem((tx) =>
    tx
      .select()
      .from(trendSources)
      .where(
        and(
          eq(trendSources.enabled, true),
          or(isNull(trendSources.lastRunAt), lte(trendSources.lastRunAt, cutoff)),
          // Agências na lixeira não geram coletas (e as que nunca abriram o Radar não têm fontes).
          sql`exists (select 1 from organizations o where o.id = ${trendSources.organizationId} and o.deleted_at is null)`,
        ),
      )
      .orderBy(asc(trendSources.lastRunAt)),
  );
  const cache = new Map<string, Promise<CollectedItem[]>>();
  const result = { ran: 0, ok: 0, failed: 0, skipped: 0, deferred: 0 };
  for (const src of due) {
    if (Date.now() - started > budget) {
      result.deferred++;
      continue;
    }
    const r = await runSource(src.organizationId, src, { now, fetch: opts.fetch, cache });
    result.ran++;
    if (r.ok) result.ok++;
    else if (r.skipped) result.skipped++;
    else result.failed++;
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* Consulta                                                            */
/* ------------------------------------------------------------------ */

const DAY = 86_400_000;

function plusDays(iso: string, n: number) {
  return new Date(Date.parse(`${iso}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);
}

/** Classificação geral mais recente de cada tendência. */
const latestClassification = sql`(
  select row_to_json(a) from (
    select ${trendAnalyses.id} as id, ${trendAnalyses.trendType} as "trendType", ${trendAnalyses.relevance} as relevance,
      ${trendAnalyses.confidence} as confidence, ${trendAnalyses.reputationRisk} as "reputationRisk",
      ${trendAnalyses.suggestedNiche} as "suggestedNiche", ${trendAnalyses.angles} as angles,
      ${trendAnalyses.lifespan} as lifespan, ${trendAnalyses.demo} as demo, ${trendAnalyses.createdAt} as "createdAt"
    from ${trendAnalyses}
    where ${trendAnalyses.trendId} = ${trends.id} and ${trendAnalyses.kind} = 'classification'
    order by ${trendAnalyses.createdAt} desc limit 1
  ) a
)`;

export type TrendClassificationSummary = {
  id: string;
  trendType: string | null;
  relevance: string | null;
  confidence: string | null;
  reputationRisk: string | null;
  suggestedNiche: string | null;
  angles: string[];
  lifespan: string | null;
  demo: boolean;
  createdAt: string;
};

/** Tipo efetivo: datas do calendário são sazonais por definição; o resto vem da IA. */
const typeExpr = sql<string | null>`case when ${trends.platform} = 'calendar' then 'sazonal' else (
  select ${trendAnalyses.trendType} from ${trendAnalyses}
  where ${trendAnalyses.trendId} = ${trends.id} and ${trendAnalyses.kind} = 'classification'
  order by ${trendAnalyses.createdAt} desc limit 1) end`;

const nicheExpr = sql<string | null>`coalesce(${trends.niche}, (
  select ${trendAnalyses.suggestedNiche} from ${trendAnalyses}
  where ${trendAnalyses.trendId} = ${trends.id} and ${trendAnalyses.kind} = 'classification'
  order by ${trendAnalyses.createdAt} desc limit 1))`;

function periodFilter(period: string, today: string): SQL {
  const notCalendar = sql`${trends.platform} <> 'calendar'`;
  const isCalendar = sql`${trends.platform} = 'calendar'`;
  if (period === "proximos") {
    return and(isCalendar, gte(trends.eventDate, today), lte(trends.eventDate, plusDays(today, 60)))!;
  }
  const days = period === "24h" ? 1 : period === "30d" ? 30 : 7;
  const since = new Date(Date.parse(`${today}T00:00:00-03:00`) - (days - 1) * DAY);
  return or(
    and(notCalendar, gte(trends.lastSeenAt, since)),
    // Datas: as que acontecem a partir de ontem, dentro de uma janela proporcional ao período.
    and(
      isCalendar,
      gte(trends.eventDate, plusDays(today, -1)),
      lte(trends.eventDate, plusDays(today, Math.max(days, 14) * 2)),
    ),
  )!;
}

/** Evidência de crescimento entre as duas últimas coletas (só com números da própria fonte). */
export function growthEvidence(observations: { observedOn: string; rank: number | null; metrics: TrendMetric[] }[]) {
  const [latest, previous] = observations;
  if (!latest || !previous) return { growing: null as boolean | null, notes: [] as string[] };
  const notes: string[] = [];
  let growing: boolean | null = null;
  for (const m of latest.metrics) {
    if (m.key === "rank") continue;
    const before = previous.metrics.find((p) => p.key === m.key);
    if (m.numeric == null || before?.numeric == null || m.numeric === before.numeric) continue;
    const up = m.numeric > before.numeric;
    growing = growing === null ? up : growing || up;
    notes.push(
      `${m.label}: ${up ? "subiu" : "caiu"} de ${before.value} (${before.asOf ?? previous.observedOn}) para ${m.value} (${m.asOf ?? latest.observedOn}).`,
    );
  }
  if (latest.rank != null && previous.rank != null && latest.rank !== previous.rank) {
    const up = latest.rank < previous.rank;
    growing = growing === null ? up : growing || up;
    notes.push(
      `Posição na fonte: ${up ? "subiu" : "caiu"} de ${previous.rank}º (${previous.observedOn}) para ${latest.rank}º (${latest.observedOn}).`,
    );
  }
  return { growing, notes };
}

export async function listTrends(s: Scope, raw: TrendListParams) {
  assertInternal(s.actor);
  assertCan(s.actor, "trends.read");
  const p = trendListParams.parse(raw);
  const today = todayISO();
  const state = sql`(select row_to_json(st) from (select ${trendUserStates.saved} as saved, ${trendUserStates.favorite} as favorite, ${trendUserStates.following} as following, ${trendUserStates.dismissed} as dismissed from ${trendUserStates} where ${trendUserStates.trendId} = ${trends.id} and ${trendUserStates.userId} = ${s.actor.userId}) st)`;
  const stateCol = (col: string) =>
    sql`exists (select 1 from ${trendUserStates} where ${trendUserStates.trendId} = ${trends.id} and ${trendUserStates.userId} = ${s.actor.userId} and ${sql.raw(col)} = true)`;
  const where = and(
    p.tab === "all" ? sql`not ${stateCol("dismissed")}` : stateCol(p.tab),
    // Abas pessoais (salvas, favoritas…) mostram tudo o que foi marcado, sem limite de período.
    p.tab === "all" && !p.collectionId ? periodFilter(p.period, today) : undefined,
    p.q
      ? or(
          ilike(trends.title, `%${p.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`),
          ilike(trends.summary, `%${p.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`),
        )
      : undefined,
    p.niche ? sql`${nicheExpr} = ${p.niche}` : undefined,
    p.region ? eq(trends.region, p.region) : undefined,
    p.language ? eq(trends.language, p.language) : undefined,
    p.platform ? eq(trends.platform, p.platform) : undefined,
    p.type ? sql`${typeExpr} = ${p.type}` : undefined,
    p.collectionId
      ? sql`exists (select 1 from ${trendCollectionItems} where ${trendCollectionItems.trendId} = ${trends.id} and ${trendCollectionItems.collectionId} = ${p.collectionId})`
      : undefined,
  );
  const visibleClients = s.db.select({ id: clients.id }).from(clients).where(clientScope(s.actor));
  const [rows, [total]] = await inSequence(
    () =>
      s.db
        .select({
          id: trends.id,
          title: trends.title,
          summary: trends.summary,
          url: trends.url,
          platform: trends.platform,
          niche: nicheExpr,
          sourceNiche: trends.niche,
          region: trends.region,
          language: trends.language,
          publishedAt: trends.publishedAt,
          eventDate: trends.eventDate,
          firstSeenAt: trends.firstSeenAt,
          lastSeenAt: trends.lastSeenAt,
          metrics: trends.metrics,
          related: trends.related,
          sourceName: trendSources.name,
          sourceKind: trendSources.kind,
          type: typeExpr,
          classification: sql<TrendClassificationSummary | null>`${latestClassification}`,
          state: sql<{ saved: boolean; favorite: boolean; following: boolean; dismissed: boolean } | null>`${state}`,
          collectionIds: sql<
            string[]
          >`coalesce((select array_agg(${trendCollectionItems.collectionId}) from ${trendCollectionItems} where ${trendCollectionItems.trendId} = ${trends.id}), '{}')`,
          fitClients: sql<{ id: string; name: string }[]>`coalesce((
          select json_agg(distinct jsonb_build_object('id', c.id, 'name', c.name))
          from ${trendAnalyses} fa join ${clients} c on c.id = fa.client_id
          where fa.trend_id = ${trends.id} and fa.kind = 'client_fit' and fa.recommended = true
            and fa.client_id in (${visibleClients})
        ), '[]'::json)`,
        })
        .from(trends)
        .innerJoin(trendSources, eq(trendSources.id, trends.sourceId))
        .where(where)
        .orderBy(
          sql`case when ${trends.platform} = 'calendar' then 1 else 0 end`,
          desc(trends.lastSeenAt),
          asc(
            sql`coalesce((select o.rank from ${trendObservations} o where o.trend_id = ${trends.id} order by o.observed_on desc limit 1), 999)`,
          ),
          asc(trends.eventDate),
        )
        .limit(p.pageSize)
        .offset((p.page - 1) * p.pageSize),
    () =>
      s.db
        .select({ n: sql<number>`count(*)::int` })
        .from(trends)
        .innerJoin(trendSources, eq(trendSources.id, trends.sourceId))
        .where(where),
  );
  const evidence = await observationsFor(
    s,
    rows.map((r) => r.id),
    2,
  );
  return {
    rows: rows.map((r) => ({ ...r, growth: growthEvidence(evidence.get(r.id) ?? []) })),
    total: total?.n ?? 0,
    page: p.page,
    pageSize: p.pageSize,
  };
}

export type TrendRow = Awaited<ReturnType<typeof listTrends>>["rows"][number];

async function observationsFor(s: Scope, ids: string[], perTrend: number) {
  const map = new Map<string, { observedOn: string; rank: number | null; metrics: TrendMetric[] }[]>();
  if (!ids.length) return map;
  const rows = await s.db
    .select({
      trendId: trendObservations.trendId,
      observedOn: trendObservations.observedOn,
      rank: trendObservations.rank,
      metrics: trendObservations.metrics,
    })
    .from(trendObservations)
    .where(inArray(trendObservations.trendId, ids))
    .orderBy(asc(trendObservations.trendId), desc(trendObservations.observedOn));
  for (const r of rows) {
    const list = map.get(r.trendId) ?? [];
    if (list.length < perTrend) list.push(r);
    map.set(r.trendId, list);
  }
  return map;
}

export async function getTrend(s: Scope, id: string) {
  assertInternal(s.actor);
  assertCan(s.actor, "trends.read");
  const [row] = await s.db
    .select({ trend: trends, source: trendSources })
    .from(trends)
    .innerJoin(trendSources, eq(trendSources.id, trends.sourceId))
    .where(eq(trends.id, id));
  if (!row) throw new NotFoundError("Tendência não encontrada.");
  const observations = (await observationsFor(s, [id], 30)).get(id) ?? [];
  const visibleClients = s.db.select({ id: clients.id }).from(clients).where(clientScope(s.actor));
  const analyses = await s.db
    .select({ analysis: trendAnalyses, clientName: clients.name })
    .from(trendAnalyses)
    .leftJoin(clients, eq(clients.id, trendAnalyses.clientId))
    .where(
      and(
        eq(trendAnalyses.trendId, id),
        or(isNull(trendAnalyses.clientId), inArray(trendAnalyses.clientId, visibleClients)),
      ),
    )
    .orderBy(desc(trendAnalyses.createdAt))
    .limit(30);
  const [state] = await s.db
    .select()
    .from(trendUserStates)
    .where(and(eq(trendUserStates.trendId, id), eq(trendUserStates.userId, s.actor.userId)));
  const collectionIds = await s.db
    .select({ id: trendCollectionItems.collectionId })
    .from(trendCollectionItems)
    .where(eq(trendCollectionItems.trendId, id));
  const connector = CONNECTORS[row.source.kind];
  return {
    trend: row.trend,
    source: {
      id: row.source.id,
      name: row.source.name,
      kind: row.source.kind,
      lastSuccessAt: row.source.lastSuccessAt,
      info: connector.info,
    },
    observations,
    growth: growthEvidence(observations),
    classification: analyses.find((a) => a.analysis.kind === "classification")?.analysis ?? null,
    clientFits: analyses.filter((a) => a.analysis.kind === "client_fit"),
    state: state ?? null,
    collectionIds: collectionIds.map((c) => c.id),
  };
}

/* ------------------------------------------------------------------ */
/* Estados pessoais e coleções                                         */
/* ------------------------------------------------------------------ */

export const trendStateInput = z.object({
  trendId: z.uuid(),
  saved: z.boolean().optional(),
  favorite: z.boolean().optional(),
  following: z.boolean().optional(),
  dismissed: z.boolean().optional(),
});

async function assertTrend(s: Scope, id: string) {
  const [row] = await s.db.select({ id: trends.id, title: trends.title }).from(trends).where(eq(trends.id, id));
  if (!row) throw new NotFoundError("Tendência não encontrada.");
  return row;
}

export async function setTrendState(s: Scope, raw: z.input<typeof trendStateInput>) {
  assertInternal(s.actor);
  assertCan(s.actor, "trends.read");
  const data = trendStateInput.parse(raw);
  await assertTrend(s, data.trendId);
  const patch = Object.fromEntries(
    (["saved", "favorite", "following", "dismissed"] as const)
      .filter((k) => data[k] !== undefined)
      .map((k) => [k, data[k]]),
  ) as Partial<Record<"saved" | "favorite" | "following" | "dismissed", boolean>>;
  if (!Object.keys(patch).length) return;
  await s.db
    .insert(trendUserStates)
    .values({
      organizationId: s.actor.orgId,
      trendId: data.trendId,
      userId: s.actor.userId,
      ...patch,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [trendUserStates.trendId, trendUserStates.userId],
      set: { ...patch, updatedAt: new Date() },
    });
}

export async function listCollections(s: Scope) {
  assertInternal(s.actor);
  assertCan(s.actor, "trends.read");
  return s.db
    .select({
      id: trendCollections.id,
      name: trendCollections.name,
      items: sql<number>`(select count(*)::int from ${trendCollectionItems} where ${trendCollectionItems.collectionId} = ${trendCollections.id})`,
    })
    .from(trendCollections)
    .orderBy(asc(trendCollections.name));
}

export const collectionInput = z.object({ name: z.string().trim().min(2, "Informe o nome").max(80) });

export async function createCollection(s: Scope, raw: z.input<typeof collectionInput>) {
  assertInternal(s.actor);
  assertCan(s.actor, "trends.read");
  const data = collectionInput.parse(raw);
  const [row] = await s.db
    .insert(trendCollections)
    .values({ organizationId: s.actor.orgId, name: data.name, createdByUserId: s.actor.userId })
    .returning({ id: trendCollections.id });
  return { id: row!.id };
}

export async function deleteCollection(s: Scope, id: string) {
  assertInternal(s.actor);
  assertCan(s.actor, "trends.read");
  const res = await s.db
    .delete(trendCollections)
    .where(eq(trendCollections.id, id))
    .returning({ id: trendCollections.id });
  if (!res.length) throw new NotFoundError("Coleção não encontrada.");
}

export async function setCollectionMembership(s: Scope, collectionId: string, trendId: string, member: boolean) {
  assertInternal(s.actor);
  assertCan(s.actor, "trends.read");
  await assertTrend(s, trendId);
  const [col] = await s.db
    .select({ id: trendCollections.id })
    .from(trendCollections)
    .where(eq(trendCollections.id, collectionId));
  if (!col) throw new NotFoundError("Coleção não encontrada.");
  if (member) {
    await s.db
      .insert(trendCollectionItems)
      .values({ organizationId: s.actor.orgId, collectionId, trendId, addedByUserId: s.actor.userId })
      .onConflictDoNothing();
  } else {
    await s.db
      .delete(trendCollectionItems)
      .where(and(eq(trendCollectionItems.collectionId, collectionId), eq(trendCollectionItems.trendId, trendId)));
  }
}

/** Nichos com tendências (padrão + personalizados) para o filtro. */
export async function nicheOptions(s: Scope) {
  assertCan(s.actor, "trends.read");
  const rows = await s.db.selectDistinct({ niche: trends.niche }).from(trends).where(isNotNull(trends.niche));
  const custom = rows.map((r) => r.niche!).filter((n) => !(n in TREND_NICHES));
  return [
    ...Object.entries(TREND_NICHES).map(([value, label]) => ({ value, label })),
    ...custom.sort().map((n) => ({ value: n, label: n })),
  ];
}
