import {
  ArrowRight,
  Bell,
  CalendarClock,
  CheckCheck,
  Inbox,
  Link2,
  Mail,
  MessageCircle,
  Phone,
  Plus,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { DueDate } from "@/components/app/due-date";
import { Stat, StatGrid } from "@/components/app/stat";
import { ApprovalList } from "@/components/approvals/approval-list";
import { FileCollection } from "@/components/files/file-collection";
import { PortalBanner } from "@/components/portal/portal-banner";
import { isExternalLink, resolvePortalLink } from "@/components/portal/portal-links";
import { RequestStatusBadge } from "@/components/requests/request-status";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDate, formatDateTime, todayISO } from "@/lib/format";
import { portalAssetUrl } from "@/lib/portal-assets";
import { bannerSlideKey } from "@/lib/portal-settings";
import { can, inOrg } from "@/server/authz";
import { requirePortal } from "@/server/auth/portal";
import { listApprovals } from "@/server/services/approvals";
import { getPublishedPortal } from "@/server/services/client-portal";
import { listFiles } from "@/server/services/files";
import { listNotifications } from "@/server/services/notifications";
import { listProjects } from "@/server/services/projects";
import { listRequests } from "@/server/services/requests";

export const metadata: Metadata = { title: "Início" };

function SeeAll({ href, label = "Ver todas" }: { href: string; label?: string }) {
  return (
    <Link href={href} className="flex items-center gap-1 text-xs font-medium text-accent-text hover:underline">
      {label} <ArrowRight className="size-3" />
    </Link>
  );
}

/** Data ISO (AAAA-MM-DD) somando dias a outra data ISO. */
function plusDays(iso: string, days: number) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Painel do cliente: só dados reais do cliente deste portal (o ator já vem
 * restrito a ele) e só as seções que a agência habilitou na personalização.
 * Nada interno: sem tarefas, comentários internos, custos ou financeiro.
 */
export default async function PortalHomePage({ params }: PageProps<"/portal/[org]/[client]">) {
  const { org, client: clientSlug } = await params;
  const portal = await requirePortal(org, clientSlug, { permission: "portal.access" });
  const { actor, base } = portal;
  const canApprove = can(actor, "approvals.decide_client") && can(actor, "files.read");
  const canRequests = can(actor, "requests.read") || can(actor, "requests.write");
  const canProjects = can(actor, "projects.read");
  const canFiles = can(actor, "files.read");
  const canCreateRequest = can(actor, "requests.write") && actor.settings.portal.allowRequestCreation;
  const showProgress = actor.settings.portal.showProjectProgress;

  const data = await inOrg(actor, async (s) => {
    const published = await getPublishedPortal(s, portal.client.id);
    const sec = published.settings.sections;
    return {
      published,
      approvals: canApprove ? await listApprovals(s, { tab: "client" }) : [],
      requests: canRequests ? await listRequests(s, { open: true, pageSize: 6 }) : null,
      projects: canProjects ? await listProjects(s, { view: "board" }) : null,
      deliveries: canFiles && sec.deliveries ? await listFiles(s, { pageSize: 6 }) : null,
      finals: canFiles && sec.files ? await listFiles(s, { status: "final", pageSize: 6 }) : null,
      notifications: sec.notifications ? await listNotifications(s, 6) : [],
    };
  });

  const { settings, version } = data.published;
  const sec = settings.sections;
  const brandName = settings.displayName ?? portal.client.name;
  const firstName = actor.name.split(" ")[0] || actor.name;
  const activeProjects = (data.projects?.rows ?? []).filter((p) => !p.completedAt);
  const deliveries = (data.deliveries?.rows ?? []).filter((f) => f.category !== "reference");

  // Próximos prazos (30 dias): aprovações pendentes, solicitações abertas e projetos ativos.
  const today = todayISO();
  const limit = plusDays(today, 30);
  const deadlines = [
    ...data.approvals
      .filter((a) => a.dueDate)
      .map((a) => ({
        key: `a-${a.id}`,
        date: a.dueDate!,
        label: `Aprovar ${a.fileName}`,
        href: `${base}/files/${a.fileId}`,
        kind: "Aprovação",
      })),
    ...(data.requests?.rows ?? [])
      .filter((r) => r.desiredDueDate)
      .map((r) => ({
        key: `r-${r.id}`,
        date: r.desiredDueDate!,
        label: `#${r.number} ${r.title}`,
        href: `${base}/requests/${r.id}`,
        kind: "Solicitação",
      })),
    ...activeProjects
      .filter((p) => p.dueDate)
      .map((p) => ({
        key: `p-${p.id}`,
        date: p.dueDate!,
        label: p.name,
        href: `${base}/projects/${p.id}`,
        kind: "Projeto",
      })),
  ]
    .filter((d) => d.date <= limit)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 6);

  const logoUrl = settings.logoAltFileId
    ? portalAssetUrl(portal.client.id, "logoAlt", { v: version })
    : settings.logoFileId || portal.clientLogoFileId
      ? portalAssetUrl(portal.client.id, "logo", { v: version })
      : null;

  const actions = [
    ...(canCreateRequest ? [{ label: "Solicitar nova demanda", url: "/requests/new", style: "primary" as const }] : []),
    ...(canApprove ? [{ label: "Ver aprovações", url: "/approvals", style: "secondary" as const }] : []),
    ...settings.actions,
  ];
  const contact = settings.contact;
  const hasContact = !!(contact.name || contact.email || contact.phone || contact.whatsapp || contact.hours);

  return (
    <div className="grid grid-cols-1 gap-6">
      {sec.banner && settings.banner.enabled ? (
        <PortalBanner
          settings={settings}
          name={brandName}
          base={base}
          imageUrl={settings.banner.imageFileId ? portalAssetUrl(portal.client.id, "banner", { v: version }) : null}
          slideUrls={settings.banner.slides.map((s, i) =>
            s.imageFileId ? portalAssetUrl(portal.client.id, bannerSlideKey(i), { v: version }) : null,
          )}
          logoUrl={logoUrl}
          fallbackTitle={`Olá, ${firstName}`}
          fallbackText={`Acompanhe aqui o que a ${actor.orgName} está produzindo para ${brandName}.`}
        />
      ) : (
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{settings.welcomeTitle ?? `Olá, ${firstName}`}</h1>
          <p className="mt-1 text-sm text-fg-muted">
            {settings.welcomeText ?? `Acompanhe aqui o que a ${actor.orgName} está produzindo para ${brandName}.`}
          </p>
        </div>
      )}

      {actions.length ? (
        <div className="flex flex-wrap gap-2">
          {actions.map((a, i) => {
            const href = resolvePortalLink(a.url, base);
            const external = isExternalLink(href);
            return (
              <Button key={`${a.label}-${i}`} asChild variant={a.style === "primary" ? "primary" : "secondary"}>
                <a
                  href={href}
                  target={external ? "_blank" : undefined}
                  rel={external ? "noopener noreferrer" : undefined}
                >
                  {a.url === "/requests/new" ? <Plus /> : a.url === "/approvals" ? <CheckCheck /> : null}
                  {a.label}
                </a>
              </Button>
            );
          })}
        </div>
      ) : null}

      {sec.stats ? (
        <StatGrid>
          {canApprove ? (
            <Stat
              label="Aguardando sua aprovação"
              value={data.approvals.length}
              tone={data.approvals.length ? "warning" : undefined}
              href={`${base}/approvals`}
            />
          ) : null}
          {data.requests ? (
            <Stat label="Solicitações em andamento" value={data.requests.total} href={`${base}/requests`} />
          ) : null}
          {data.projects ? (
            <Stat label="Projetos ativos" value={activeProjects.length} href={`${base}/projects`} />
          ) : null}
          {data.finals ? (
            <Stat label="Arquivos finais" value={data.finals.total} href={`${base}/files?status=final`} />
          ) : null}
        </StatGrid>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
        <div className="grid min-w-0 grid-cols-1 content-start gap-6">
          {canApprove && sec.approvals ? (
            <Card>
              <CardHeader>
                <CardTitle>Aguardando sua aprovação</CardTitle>
                {data.approvals.length > 5 ? <SeeAll href={`${base}/approvals`} /> : null}
              </CardHeader>
              <ApprovalList
                rows={data.approvals.slice(0, 5)}
                emptyTitle="Tudo em dia"
                emptyDescription="Quando a agência enviar um material para você aprovar, ele aparece aqui."
              />
            </Card>
          ) : null}

          {data.deliveries ? (
            <Card>
              <CardHeader>
                <CardTitle>Entregas recentes</CardTitle>
                {data.deliveries.total > deliveries.length ? <SeeAll href={`${base}/files`} label="Ver todos" /> : null}
              </CardHeader>
              {deliveries.length ? (
                <FileCollection files={deliveries} view="grid" />
              ) : (
                <p className="px-5 pb-6 text-sm text-fg-muted">
                  Os materiais que a agência compartilhar com você aparecem aqui.
                </p>
              )}
            </Card>
          ) : null}

          {data.finals ? (
            <Card>
              <CardHeader>
                <CardTitle>Arquivos finais</CardTitle>
                {data.finals.total > data.finals.rows.length ? (
                  <SeeAll href={`${base}/files?status=final`} label="Ver todos" />
                ) : null}
              </CardHeader>
              {data.finals.rows.length ? (
                <FileCollection files={data.finals.rows} view="grid" />
              ) : (
                <p className="px-5 pb-6 text-sm text-fg-muted">
                  Versões finais aprovadas ficam disponíveis aqui para download.
                </p>
              )}
            </Card>
          ) : null}
        </div>

        <div className="grid grid-cols-1 content-start gap-6">
          {data.requests && sec.requests ? (
            <Card>
              <CardHeader>
                <CardTitle>Solicitações em andamento</CardTitle>
                <SeeAll href={`${base}/requests`} />
              </CardHeader>
              {data.requests.rows.length ? (
                <ul className="divide-y divide-border">
                  {data.requests.rows.slice(0, 5).map((r) => (
                    <li key={r.id}>
                      <Link
                        href={`${base}/requests/${r.id}`}
                        className="flex items-start justify-between gap-3 px-4 py-3 transition-colors hover:bg-surface-2"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            <span className="text-fg-subtle">#{r.number}</span> {r.title}
                          </p>
                          <p className="mt-0.5 text-xs text-fg-muted">
                            {r.submittedAt ? `Enviada em ${formatDate(r.submittedAt)}` : "Rascunho"}
                          </p>
                        </div>
                        <RequestStatusBadge status={r.status} />
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState
                  compact
                  icon={Inbox}
                  title="Nenhuma solicitação em andamento"
                  description={
                    canCreateRequest ? "Precisa de algo novo? Abra uma solicitação com o briefing." : undefined
                  }
                  action={
                    canCreateRequest ? (
                      <Button asChild variant="secondary" size="sm">
                        <Link href={`${base}/requests/new`}>
                          <Plus /> Nova solicitação
                        </Link>
                      </Button>
                    ) : null
                  }
                />
              )}
            </Card>
          ) : null}

          {sec.deadlines && (canApprove || canRequests || canProjects) ? (
            <Card>
              <CardHeader>
                <CardTitle>Próximos prazos</CardTitle>
              </CardHeader>
              {deadlines.length ? (
                <ul className="divide-y divide-border">
                  {deadlines.map((d) => (
                    <li key={d.key}>
                      <Link
                        href={d.href}
                        className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-2"
                      >
                        <CalendarClock
                          className={d.date < today ? "size-4 shrink-0 text-danger" : "size-4 shrink-0 text-fg-subtle"}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm">{d.label}</span>
                          <span className="block text-xs text-fg-muted">{d.kind}</span>
                        </span>
                        <DueDate date={d.date} />
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-5 pb-5 text-sm text-fg-muted">Nenhum prazo nos próximos 30 dias.</p>
              )}
            </Card>
          ) : null}

          {data.projects && sec.projects ? (
            <Card>
              <CardHeader>
                <CardTitle>Projetos ativos</CardTitle>
                {activeProjects.length > 5 ? <SeeAll href={`${base}/projects`} label="Ver todos" /> : null}
              </CardHeader>
              {activeProjects.length ? (
                <ul className="divide-y divide-border">
                  {activeProjects.slice(0, 5).map((p) => {
                    const pct = p.tasksTotal ? Math.round((p.tasksDone / p.tasksTotal) * 100) : 0;
                    return (
                      <li key={p.id}>
                        <Link
                          href={`${base}/projects/${p.id}`}
                          className="block px-4 py-3 transition-colors hover:bg-surface-2"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <p className="truncate text-sm font-medium">{p.name}</p>
                            <StatusBadge name={p.statusName} color={p.statusColor} />
                          </div>
                          {showProgress ? (
                            <div className="mt-2 flex items-center gap-2">
                              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
                                <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
                              </div>
                              <span className="tabular text-xs text-fg-muted">{pct}%</span>
                            </div>
                          ) : null}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="px-5 pb-5 text-sm text-fg-muted">Nenhum projeto em andamento no momento.</p>
              )}
            </Card>
          ) : null}

          {sec.notifications ? (
            <Card>
              <CardHeader>
                <CardTitle>Notificações</CardTitle>
              </CardHeader>
              {data.notifications.length ? (
                <ul className="divide-y divide-border">
                  {data.notifications.map((n) => (
                    <li key={n.id}>
                      <Link
                        href={n.link ?? base}
                        className="flex items-start gap-3 px-4 py-2.5 transition-colors hover:bg-surface-2"
                      >
                        <Bell
                          className={n.readAt ? "mt-0.5 size-4 text-fg-subtle" : "mt-0.5 size-4 text-accent-text"}
                        />
                        <span className="min-w-0">
                          <span
                            className={
                              n.readAt ? "block truncate text-sm text-fg-muted" : "block truncate text-sm font-medium"
                            }
                          >
                            {n.title}
                          </span>
                          <span className="block text-xs text-fg-subtle">{formatDateTime(n.createdAt)}</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-5 pb-5 text-sm text-fg-muted">Sem notificações por enquanto.</p>
              )}
            </Card>
          ) : null}

          {sec.links && settings.links.length ? (
            <Card>
              <CardHeader>
                <CardTitle>Links úteis</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-1">
                {settings.links.map((l, i) => {
                  const href = resolvePortalLink(l.url, base);
                  const external = isExternalLink(href);
                  return (
                    <a
                      key={`${l.label}-${i}`}
                      href={href}
                      target={external ? "_blank" : undefined}
                      rel={external ? "noopener noreferrer" : undefined}
                      className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-fg hover:bg-surface-2"
                    >
                      <Link2 className="size-4 text-fg-subtle" />
                      <span className="truncate">{l.label}</span>
                    </a>
                  );
                })}
              </CardContent>
            </Card>
          ) : null}

          {sec.contact && hasContact ? (
            <Card>
              <CardHeader>
                <CardTitle>Fale com a agência</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2 text-sm">
                {contact.name ? <p className="font-medium">{contact.name}</p> : null}
                {contact.email ? (
                  <a href={`mailto:${contact.email}`} className="flex items-center gap-2 text-fg-muted hover:text-fg">
                    <Mail className="size-4" /> {contact.email}
                  </a>
                ) : null}
                {contact.phone ? (
                  <a
                    href={`tel:${contact.phone.replace(/[^\d+]/g, "")}`}
                    className="flex items-center gap-2 text-fg-muted hover:text-fg"
                  >
                    <Phone className="size-4" /> {contact.phone}
                  </a>
                ) : null}
                {contact.whatsapp ? (
                  <a
                    href={`https://wa.me/${contact.whatsapp.replace(/\D/g, "")}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-fg-muted hover:text-fg"
                  >
                    <MessageCircle className="size-4" /> WhatsApp {contact.whatsapp}
                  </a>
                ) : null}
                {contact.hours ? <p className="text-xs text-fg-subtle">{contact.hours}</p> : null}
                {contact.note ? <p className="text-xs text-fg-muted">{contact.note}</p> : null}
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
