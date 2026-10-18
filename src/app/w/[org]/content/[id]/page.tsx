import { ExternalLink, Eye, FileImage, Palette } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RequestApprovalDialog } from "@/components/approvals/request-approval-dialog";
import { ContentEditor } from "@/components/content/content-forms";
import { StatusBadge } from "@/components/ui/badge";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import {
  CONTENT_FORMATS,
  CONTENT_STATUS,
  CONTENT_STATUS_COLOR,
  type ContentFormat,
  type ContentStatus,
} from "@/lib/content";
import { formatDateTime } from "@/lib/format";
import { can, inOrg } from "@/server/authz";
import { requireActor } from "@/server/auth/session";
import { NotFoundError } from "@/server/errors";
import { getContent, listCampaigns } from "@/server/services/content";

export const metadata: Metadata = { title: "Conteúdo" };

export default async function ContentItemPage({ params }: PageProps<"/w/[org]/content/[id]">) {
  const { org, id } = await params;
  const actor = await requireActor(org, { kind: "internal", permission: "content.read" });
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const data = await inOrg(actor, async (s) => {
    try {
      const c = await getContent(s, id);
      return { c, campaigns: await listCampaigns(s, c.item.clientId) };
    } catch (err) {
      if (err instanceof NotFoundError) return null;
      throw err;
    }
  });
  if (!data) notFound();
  const { c } = data;
  const it = c.item;
  const w = `/w/${actor.orgSlug}`;
  const canApprove = can(actor, "approvals.request");
  const designs = c.assets.filter((a) => a.designId);
  const images = c.assets.filter((a) => a.fileId);

  return (
    <>
      <Breadcrumbs items={[{ label: "Conteúdos", href: `${w}/content` }, { label: it.title }]} />
      <PageHeader
        title={it.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge
              name={CONTENT_STATUS[it.status as ContentStatus]}
              color={CONTENT_STATUS_COLOR[it.status as ContentStatus]}
            />
            <span>{CONTENT_FORMATS[it.format as ContentFormat]?.label}</span>
            <span>·</span>
            <Link href={`${w}/clients/${it.clientId}`} className="hover:underline">
              {c.clientName}
            </Link>
          </span>
        }
        actions={
          <Button asChild variant="primary" size="sm">
            <Link href={`${w}/content/${it.id}/preview`}>
              <Eye /> Visualizar publicação
            </Link>
          </Button>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="rounded-xl border border-border bg-surface p-4 shadow-xs">
          <ContentEditor
            canWrite={can(actor, "content.write")}
            campaigns={data.campaigns.map((x) => ({ id: x.id, name: x.name }))}
            value={{
              id: it.id,
              title: it.title,
              format: it.format as ContentFormat,
              status: it.status as ContentStatus,
              plannedDate: it.plannedDate,
              campaignId: it.campaignId,
              concept: it.concept,
              strategy: it.strategy,
              copy: it.copy,
              caption: it.caption,
              cta: it.cta,
              script: it.script,
              visualDirection: it.visualDirection,
              imagePrompt: it.imagePrompt,
              hashtags: it.hashtags,
              slides: it.slides,
            }}
          />
        </section>

        <aside className="grid content-start gap-4">
          <section
            className="grid gap-2 rounded-xl border border-border bg-surface p-4 text-sm shadow-xs"
            aria-label="Vínculos"
          >
            <h2 className="text-sm font-semibold">Vínculos</h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              <dt className="text-fg-muted">Tendência</dt>
              <dd>
                {it.trendId && c.trendTitle ? (
                  <Link href={`${w}/trends/${it.trendId}`} className="hover:underline">
                    {c.trendTitle}
                  </Link>
                ) : (
                  "—"
                )}
                {c.trendUrl ? (
                  <a
                    href={c.trendUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-1 inline-flex text-fg-subtle"
                    aria-label="Abrir fonte"
                  >
                    <ExternalLink className="size-3" />
                  </a>
                ) : null}
              </dd>
              <dt className="text-fg-muted">Campanha</dt>
              <dd>{c.campaignName ?? "—"}</dd>
              <dt className="text-fg-muted">Projeto</dt>
              <dd>
                {it.projectId && c.projectName ? (
                  <Link href={`${w}/projects/${it.projectId}`} className="hover:underline">
                    {c.projectName}
                  </Link>
                ) : (
                  "—"
                )}
              </dd>
              <dt className="text-fg-muted">Tarefa</dt>
              <dd>
                {it.taskId && c.taskTitle ? (
                  <Link href={`${w}/tasks/${it.taskId}`} className="hover:underline">
                    {c.taskTitle}
                  </Link>
                ) : (
                  "—"
                )}
              </dd>
              <dt className="text-fg-muted">Briefing</dt>
              <dd>
                {it.requestId && c.requestNumber ? (
                  <Link href={`${w}/requests/${it.requestId}`} className="hover:underline">
                    #{c.requestNumber} {c.requestTitle}
                  </Link>
                ) : (
                  "—"
                )}
              </dd>
              <dt className="text-fg-muted">Criado por</dt>
              <dd>
                {c.createdByName ?? "—"} · {formatDateTime(it.createdAt)}
              </dd>
            </dl>
          </section>

          <section className="grid gap-2 rounded-xl border border-border bg-surface p-4 shadow-xs" aria-label="Artes">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold">
              <Palette className="size-4 text-fg-subtle" /> Artes ({designs.length})
            </h2>
            {designs.length ? (
              <ul className="grid grid-cols-2 gap-2">
                {designs.map((d) => (
                  <li key={d.id} className="grid gap-1">
                    <Link
                      href={`${w}/studio/${d.designId}`}
                      className="flex aspect-[4/5] items-center justify-center overflow-hidden rounded-md border border-border bg-surface-2"
                    >
                      {d.designThumb ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={d.designThumb} alt="" className="max-h-full max-w-full object-contain" />
                      ) : (
                        <Palette className="size-6 text-fg-subtle" />
                      )}
                    </Link>
                    <p className="truncate text-xs" title={d.designName ?? ""}>
                      {d.designName}
                    </p>
                    <p className="text-[11px] text-fg-subtle">
                      {d.designWidth}×{d.designHeight}
                    </p>
                    <Button asChild size="xs" variant="secondary">
                      <Link href={`${w}/studio/${d.designId}`}>Abrir no editor</Link>
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-fg-muted">Nenhuma arte vinculada.</p>
            )}
          </section>

          <section
            className="grid gap-2 rounded-xl border border-border bg-surface p-4 shadow-xs"
            aria-label="Arquivos e aprovação"
          >
            <h2 className="flex items-center gap-1.5 text-sm font-semibold">
              <FileImage className="size-4 text-fg-subtle" /> Arquivos e aprovação
            </h2>
            {images.length || c.outputs.length ? (
              <ul className="grid gap-2 text-xs">
                {images.map((f) => (
                  <li key={f.id} className="flex flex-wrap items-center justify-between gap-2">
                    <Link href={`${w}/files/${f.fileId}`} className="min-w-0 truncate hover:underline">
                      Imagem: {f.fileName}
                    </Link>
                  </li>
                ))}
                {c.outputs.map((f) => (
                  <li key={f.id} className="flex flex-wrap items-center justify-between gap-2">
                    <Link href={`${w}/files/${f.id}`} className="min-w-0 truncate hover:underline">
                      Arte exportada: {f.name}
                    </Link>
                    {canApprove && f.versionNumber ? (
                      <RequestApprovalDialog fileId={f.id} versionNumber={f.versionNumber} stage="client" />
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="text-xs text-fg-muted">
              Para enviar ao cliente, exporte a arte no editor (ela vai para Arquivos e aparece aqui com o botão “Enviar
              ao cliente”).
            </p>
          </section>
        </aside>
      </div>
    </>
  );
}
