import { Download, Eye, Upload } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Comments } from "@/components/app/comments";
import { HistoryList } from "@/components/app/history-list";
import { ApprovalsPanel } from "@/components/approvals/approvals-panel";
import { FavoriteButton } from "@/components/files/favorite-button";
import { FileDetailsForm } from "@/components/files/file-details-form";
import { fileUrl } from "@/components/files/file-icon";
import { FilePreview } from "@/components/files/file-preview";
import { FileStatusBadge } from "@/components/files/file-status";
import { UploadDialog } from "@/components/files/upload-dialog";
import { VersionsList } from "@/components/files/versions-list";
import { Badge } from "@/components/ui/badge";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FILE_CATEGORY_LABEL } from "@/lib/validators/files";
import { can, inOrg } from "@/server/authz";
import { requireActor } from "@/server/auth/session";
import { NotFoundError } from "@/server/errors";
import { fileApprovals } from "@/server/services/approvals";
import { listComments } from "@/server/services/comments";
import { contentsForFile } from "@/server/services/content-preview";
import { fileHistory, getFile, listFolders, maxUploadBytes } from "@/server/services/files";

export const metadata: Metadata = { title: "Arquivo" };

export default async function FileDetailPage({ params }: PageProps<"/w/[org]/files/[id]">) {
  const { org, id } = await params;
  const actor = await requireActor(org, { kind: "internal", permission: "files.read" });
  const data = await inOrg(actor, async (s) => {
    try {
      const detail = await getFile(s, id);
      return {
        detail,
        rounds: await fileApprovals(s, id),
        comments: await listComments(s, { fileId: id }),
        history: await fileHistory(s, id),
        folders: await listFolders(s, detail.file.clientId ? { clientId: detail.file.clientId } : {}),
        maxBytes: maxUploadBytes(s),
        contents: await contentsForFile(s, id),
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
  const base = `/w/${actor.orgSlug}`;
  const canWrite = can(actor, "files.write");

  return (
    <div className="grid gap-6">
      <div>
        <Breadcrumbs
          items={[
            { label: "Arquivos", href: `${base}/files` },
            ...(file.clientId && detail.clientName
              ? [{ label: detail.clientName, href: `${base}/clients/${file.clientId}/files` }]
              : []),
            { label: file.name },
          ]}
        />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-xl font-semibold tracking-tight">{file.name}</h1>
              <FileStatusBadge status={file.status} />
              {file.sharedWithClient ? <Badge tone="info">Visível ao cliente</Badge> : null}
              <FavoriteButton fileId={file.id} initial={detail.favorite} />
            </div>
            <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-fg-muted">
              <span>{FILE_CATEGORY_LABEL[file.category]}</span>
              {detail.projectName && file.projectId ? (
                <Link href={`${base}/projects/${file.projectId}`} className="hover:text-fg">
                  {detail.projectName}
                </Link>
              ) : null}
              {detail.taskTitle && file.taskId ? (
                <Link href={`${base}/tasks/${file.taskId}`} className="hover:text-fg">
                  Tarefa: {detail.taskTitle}
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
            <div className="flex flex-wrap gap-2">
              {data.contents[0] ? (
                <Button asChild variant="secondary">
                  <Link href={`${base}/content/${data.contents[0].id}/preview`}>
                    <Eye /> Visualizar publicação
                  </Link>
                </Button>
              ) : null}
              {canWrite ? (
                <UploadDialog
                  newVersionOf={{ id: file.id, name: file.name }}
                  maxBytes={data.maxBytes}
                  trigger={
                    <Button variant="secondary">
                      <Upload /> Nova versão
                    </Button>
                  }
                />
              ) : null}
              <Button asChild variant="primary">
                <a href={fileUrl(current.id, { download: true })}>
                  <Download /> Baixar v{current.versionNumber}
                </a>
              </Button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
        <div className="grid min-w-0 content-start gap-6">
          {current ? <FilePreview versionId={current.id} mimeType={current.mimeType} name={file.name} /> : null}
          <ApprovalsPanel
            fileId={file.id}
            rounds={data.rounds}
            currentVersion={current ? { id: current.id, versionNumber: current.versionNumber } : null}
            hasClient={!!file.clientId}
          />
          <Card>
            <CardHeader>
              <CardTitle>Comentários</CardTitle>
            </CardHeader>
            <CardContent>
              <Comments
                target={{ fileId: file.id, fileVersionId: current?.id }}
                comments={data.comments}
                allowInternal={can(actor, "comments.internal")}
                defaultInternal={!file.sharedWithClient}
              />
            </CardContent>
          </Card>
        </div>
        <div className="grid content-start gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Detalhes</CardTitle>
            </CardHeader>
            <CardContent>
              <FileDetailsForm
                key={`${file.updatedAt.getTime()}-${file.status}`}
                file={{
                  id: file.id,
                  name: file.name,
                  description: file.description,
                  category: file.category,
                  tags: file.tags,
                  status: file.status,
                  folderId: file.folderId,
                  clientId: file.clientId,
                  sharedWithClient: file.sharedWithClient,
                }}
                folders={data.folders.map((f) => ({ id: f.id, name: f.name }))}
                canWrite={canWrite}
                canShare={can(actor, "files.share")}
                canDelete={can(actor, "files.delete")}
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
