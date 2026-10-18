import { CalendarDays, CalendarRange, LayoutList, Radar } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ClearFilters, FilterBar, SearchFilter, SelectFilter } from "@/components/app/filters";
import { MonthCalendar } from "@/components/app/month-calendar";
import { NewCampaignDialog } from "@/components/content/content-forms";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SegmentedNav } from "@/components/ui/segmented-nav";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import {
  CONTENT_FORMATS,
  CONTENT_STATUS,
  CONTENT_STATUS_COLOR,
  contentListParams,
  type ContentFormat,
  type ContentStatus,
} from "@/lib/content";
import { formatDate, todayISO } from "@/lib/format";
import { can, inOrg } from "@/server/authz";
import { requireActor } from "@/server/auth/session";
import { clientOptions } from "@/server/services/clients";
import { calendarMonth, listCampaigns, listContent, type ContentRow } from "@/server/services/content";

export const metadata: Metadata = { title: "Conteúdos" };

const str = (v: string | string[] | undefined) => (typeof v === "string" && v ? v : undefined);
const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

function addDays(iso: string, n: number) {
  return new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

function weekStart(iso: string) {
  const d = new Date(`${iso}T12:00:00Z`);
  return addDays(iso, -d.getUTCDay());
}

export default async function ContentPage({ params, searchParams }: PageProps<"/w/[org]/content">) {
  const { org } = await params;
  const sp = await searchParams;
  const actor = await requireActor(org, { kind: "internal", permission: "content.read" });
  const view = sp.view === "calendar" ? "calendar" : sp.view === "week" ? "week" : "list";
  const today = todayISO();
  const month = typeof sp.month === "string" && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : today.slice(0, 7);
  const week = weekStart(typeof sp.week === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.week) ? sp.week : today);
  const parsed = contentListParams.safeParse({
    clientId: str(sp.clientId),
    campaignId: str(sp.campaignId),
    status: str(sp.status),
    format: str(sp.format),
    q: str(sp.q),
  });
  const filters = parsed.success ? parsed.data : {};
  const data = await inOrg(actor, async (s) => ({
    rows:
      view === "calendar"
        ? await calendarMonth(s, month, filters)
        : view === "week"
          ? await listContent(s, { ...filters, from: week, to: addDays(week, 6) })
          : await listContent(s, filters),
    clients: await clientOptions(s),
    campaigns: await listCampaigns(s, filters.clientId),
  }));
  const base = `/w/${actor.orgSlug}/content`;
  const qs = (extra: Record<string, string>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && !["month", "week"].includes(k)) q.set(k, v);
    for (const [k, v] of Object.entries(extra)) q.set(k, v);
    return `${base}?${q.toString()}`;
  };
  const canWrite = can(actor, "content.write");
  const viewHref = (v: string) => {
    const q = new URLSearchParams();
    for (const [k, val] of Object.entries(sp))
      if (typeof val === "string" && !["view", "month", "week"].includes(k)) q.set(k, val);
    if (v !== "list") q.set("view", v);
    const s = q.toString();
    return s ? `${base}?${s}` : base;
  };

  return (
    <>
      <PageHeader
        title="Conteúdos"
        description="Peças de conteúdo por cliente e campanha, com calendário editorial. Cada peça aponta para as artes, arquivos, tarefa e briefing — nada é duplicado."
        actions={
          <>
            {canWrite ? <NewCampaignDialog clients={data.clients} /> : null}
            {can(actor, "trends.read") ? (
              <Button asChild variant="primary" size="sm">
                <Link href={`/w/${actor.orgSlug}/trends`}>
                  <Radar /> Criar a partir de tendências
                </Link>
              </Button>
            ) : null}
          </>
        }
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <SegmentedNav
            param="view"
            items={[
              { label: "Lista", href: viewHref("list"), value: "list", icon: <LayoutList /> },
              { label: "Calendário", href: viewHref("calendar"), value: "calendar", icon: <CalendarDays /> },
              { label: "Semana", href: viewHref("week"), value: "week", icon: <CalendarRange /> },
            ]}
          />
          <FilterBar>
            <SearchFilter placeholder="Buscar peça" />
            <SelectFilter
              param="clientId"
              label="Cliente"
              options={data.clients.map((c) => ({ value: c.id, label: c.name }))}
            />
            <SelectFilter
              param="campaignId"
              label="Campanha"
              options={data.campaigns.map((c) => ({ value: c.id, label: `${c.name} — ${c.clientName}` }))}
            />
            <SelectFilter
              param="status"
              label="Status"
              options={Object.entries(CONTENT_STATUS).map(([value, label]) => ({ value, label }))}
            />
            <SelectFilter
              param="format"
              label="Formato"
              options={Object.entries(CONTENT_FORMATS).map(([value, f]) => ({ value, label: f.label }))}
            />
            <ClearFilters keys={["q", "clientId", "campaignId", "status", "format"]} />
          </FilterBar>
        </div>
      </PageHeader>

      {view === "calendar" ? (
        <MonthCalendar
          month={month}
          hrefForMonth={(m) => qs({ view: "calendar", month: m })}
          events={data.rows
            .filter((r) => r.plannedDate)
            .map((r) => ({
              id: r.id,
              title: r.title,
              date: r.plannedDate!,
              color: CONTENT_STATUS_COLOR[r.status as ContentStatus],
              href: `${base}/${r.id}`,
              done: r.status === "published",
              subtitle: r.clientName,
            }))}
        />
      ) : view === "week" ? (
        <div className="grid gap-3">
          <div className="flex items-center justify-between text-sm">
            <Link href={qs({ view: "week", week: addDays(week, -7) })} className="text-fg-muted hover:text-fg">
              ← Semana anterior
            </Link>
            <span className="font-medium">
              {formatDate(week)} – {formatDate(addDays(week, 6))}
            </span>
            <Link href={qs({ view: "week", week: addDays(week, 7) })} className="text-fg-muted hover:text-fg">
              Próxima semana →
            </Link>
          </div>
          <ol className="grid gap-2 md:grid-cols-7">
            {Array.from({ length: 7 }, (_, i) => addDays(week, i)).map((day, i) => {
              const items = data.rows.filter((r) => r.plannedDate === day);
              return (
                <li
                  key={day}
                  className={`grid content-start gap-1.5 rounded-lg border p-2 ${day === today ? "border-accent" : "border-border"} bg-surface`}
                >
                  <p className="text-xs font-medium text-fg-muted">
                    {WEEKDAYS[i]} · {day.slice(8)}/{day.slice(5, 7)}
                  </p>
                  {items.map((r) => (
                    <Link
                      key={r.id}
                      href={`${base}/${r.id}`}
                      className="rounded-md bg-surface-2 px-2 py-1 text-xs hover:bg-surface-2/70"
                    >
                      <span className="block truncate font-medium">{r.title}</span>
                      <span className="block truncate text-fg-subtle">{r.clientName}</span>
                    </Link>
                  ))}
                </li>
              );
            })}
          </ol>
        </div>
      ) : data.rows.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface">
          <EmptyState
            icon={CalendarDays}
            title="Nenhuma peça de conteúdo"
            description="Crie peças a partir do Radar de Tendências: o conteúdo já sai ligado ao cliente, à campanha e às artes."
          />
        </div>
      ) : (
        <ContentTable rows={data.rows} base={base} />
      )}
    </>
  );
}

function ContentTable({ rows, base }: { rows: ContentRow[]; base: string }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-xs">
      <Table>
        <THead>
          <TR>
            <TH>Peça</TH>
            <TH>Cliente</TH>
            <TH className="hidden md:table-cell">Campanha</TH>
            <TH>Status</TH>
            <TH className="hidden sm:table-cell">Data</TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((r) => (
            <TR key={r.id}>
              <TD>
                <Link href={`${base}/${r.id}`} className="font-medium hover:underline">
                  {r.title}
                </Link>
                <p className="text-xs text-fg-subtle">
                  {CONTENT_FORMATS[r.format as ContentFormat]?.label ?? r.format}
                  {r.assets ? ` · ${r.assets} arquivo(s)/arte(s)` : ""}
                  {r.trendTitle ? ` · Tendência: ${r.trendTitle}` : ""}
                </p>
              </TD>
              <TD>{r.clientName}</TD>
              <TD className="hidden md:table-cell">{r.campaignName ?? "—"}</TD>
              <TD>
                <StatusBadge
                  name={CONTENT_STATUS[r.status as ContentStatus]}
                  color={CONTENT_STATUS_COLOR[r.status as ContentStatus]}
                />
              </TD>
              <TD className="hidden sm:table-cell">{r.plannedDate ? formatDate(r.plannedDate) : "—"}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  );
}
