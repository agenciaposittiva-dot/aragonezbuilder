import { Download } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Comments } from "@/components/app/comments";
import { HistoryList } from "@/components/app/history-list";
import { InfoList } from "@/components/app/stat";
import { ApprovalsPanel } from "@/components/approvals/approvals-panel";
import { fileUrl } from "@/components/files/file-icon";
import { FilePreview } from "@/components/files/file-preview";
import { FileStatusBadge } from "@/components/files/file-status";
import { VersionsList } from "@/components/files/versions-list";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/format";
import { FILE_CATEGORY_LABEL } from "@/lib/validators/files";
import { inOrg } from "@/server/authz";
import { requireActor } from "@/server/auth/session";
import { NotFoundError } from "@/server/errors";
import { fileApprovals } from "@/server/services/approvals";
import { listComments } from "@/server/services/comments";
import { fileHistory, getFile } from "@/server/services/files";

export const metadata: Metadata = { title: "Material" };

export default async function PortalFileDetailPage({ params }: PageProps<"/portal/[org]/files/[id]">) {
  const { org, id } = await params;
  const actor = await requireActor(org, { kind: "client", permission: "files.read" });
  const data = await inOrg(actor, async (s) => {
    try {
      const detail = await getFile(s, id);
      return {
        detail,
        rounds: await fileApprovals(s, id),
        comments: await listComments(s, { fileId: id }),
        history: await fileHistory(s, id),
      };
    } catch (e) {
      if (e instanceof NotFoundError) return null;
      throw e;
    }
  });
  if (!data) notFound();
  const { detail } = data;
  const { file } = detail;
  const current = detail.versions.find((v) => v.id === file.currentVersionId) ?? detail.versions[0] ?? null;
  const base = `/portal/${actor.orgSlug}`;

  return (
    <div className="grid gap-6">
      <div>
        <Breadcrumbs items={[{ label: "Materiais", href: `${base}/files` }, { label: file.name }]} />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-xl font-semibold tracking-tight">{file.name}</h1>
              <FileStatusBadge status={file.status} />
            </div>
            <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-fg-muted">
              <span>{FILE_CATEGORY_LABEL[file.category]}</span>
              {actor.clientIds.length > 1 && detail.clientName ? <span>{detail.clientName}</span> : null}
              {detail.projectName && file.projectId ? (
                <Link href={`${base}/projects/${file.projectId}`} className="hover:text-fg">
                  {detail.projectName}
                </Link>
              ) : null}
              {detail.requestNumber && file.requestId ? (
                <Link href={`${base}/requests/${file.requestId}`} className="hover:text-fg">
                  Solicitação #{detail.requestNumber}
                </Link>
              ) : null}
            </p>
          </div>
          {current ? (
            <Button asChild variant="primary">
              <a href={fileUrl(current.id, { download: true })}>
                <Download /> Baixar v{current.versionNumber}
              </a>
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,340px)]">
        <div className="grid min-w-0 content-start gap-6">
          {current ? <FilePreview versionId={current.id} mimeType={current.mimeType} name={file.name} /> : null}
          <ApprovalsPanel
            fileId={file.id}
            rounds={data.rounds}
            currentVersion={current ? { id: current.id, versionNumber: current.versionNumber } : null}
            hasClient
          />
          <Card>
            <CardHeader>
              <CardTitle>Comentários</CardTitle>
            </CardHeader>
            <CardContent>
              <Comments
                target={{ fileId: file.id, fileVersionId: current?.id }}
                comments={data.comments}
                allowInternal={false}
              />
            </CardContent>
          </Card>
        </div>
        <div className="grid content-start gap-6">
          {file.description ? (
            <Card>
              <CardHeader>
                <CardTitle>Sobre este material</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm whitespace-pre-wrap text-fg-muted">{file.description}</p>
              </CardContent>
            </Card>
          ) : null}
          <Card>
            <CardHeader>
              <CardTitle>Informações</CardTitle>
            </CardHeader>
            <CardContent>
              <InfoList
                items={[
                  { label: "Atualizado em", value: formatDateTime(file.updatedAt) },
                  { label: "Versões", value: String(detail.versions.length) },
                ]}
              />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <VersionsList versions={detail.versions} currentId={file.currentVersionId} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Histórico</CardTitle>
            </CardHeader>
            <CardContent>
              <HistoryList entries={data.history} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
