import { Sparkles } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Comments } from "@/components/app/comments";
import { DueDate } from "@/components/app/due-date";
import { HistoryList } from "@/components/app/history-list";
import { PriorityLabel } from "@/components/app/priority";
import { InfoList } from "@/components/app/stat";
import { FileAttachments } from "@/components/files/file-attachments";
import { BriefingAnswers } from "@/components/requests/briefing-answers";
import { RequestActions } from "@/components/requests/request-actions";
import { RequestStatusBadge } from "@/components/requests/request-status";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate, formatDateTime } from "@/lib/format";
import { BRIEFING_CATEGORY_LABEL } from "@/lib/validators/briefings";
import { can, inOrg } from "@/server/authz";
import { requireActor } from "@/server/auth/session";
import { NotFoundError } from "@/server/errors";
import { listComments } from "@/server/services/comments";
import { listInternalMembers } from "@/server/services/members";
import { projectOptions } from "@/server/services/projects";
import { canTriage, getRequest, requestHistory } from "@/server/services/requests";

export const metadata: Metadata = { title: "Solicitação" };

export default async function RequestDetailPage({ params }: PageProps<"/w/[org]/requests/[id]">) {
  const { org, id } = await params;
  const actor = await requireActor(org, { kind: "internal", permission: "requests.read" });
  const data = await inOrg(actor, async (s) => {
    try {
      const detail = await getRequest(s, id);
      return {
        detail,
        comments: await listComments(s, { requestId: id }),
        history: await requestHistory(s, id),
        members: await listInternalMembers(s),
        projects: await projectOptions(s, detail.request.clientId),
        triage: canTriage(s),
      };
    } catch (e) {
      if (e instanceof NotFoundError) return null;
      throw e;
    }
  });
  if (!data) notFound();
  const { detail } = data;
  const r = detail.request;
  const base = `/w/${actor.orgSlug}`;

  const standard = [
    { label: "Público-alvo", value: r.audience },
    { label: "Canal", value: r.channel },
    { label: "Formato", value: r.format },
    { label: "Quantidade de peças", value: r.piecesCount ? String(r.piecesCount) : null },
  ];

  return (
    <div className="grid gap-6">
      <div>
        <Breadcrumbs items={[{ label: "Solicitações", href: `${base}/requests` }, { label: `#${r.number}` }]} />
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight">
            <span className="text-fg-subtle">#{r.number}</span> {r.title}
          </h1>
          <RequestStatusBadge status={r.status} />
        </div>
        <p className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-fg-muted">
          <Link href={`${base}/clients/${r.clientId}`} className="hover:text-fg">
            {detail.clientName}
          </Link>
          <span>{detail.templateName ?? BRIEFING_CATEGORY_LABEL[r.category]}</span>
          <PriorityLabel priority={r.priority} />
          {r.desiredDueDate ? (
            <DueDate date={r.desiredDueDate} done={["delivered", "rejected", "cancelled"].includes(r.status)} />
          ) : null}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,340px)]">
        <div className="grid min-w-0 content-start gap-6">
          {r.status === "rejected" && r.rejectionReason ? (
            <div className="rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
              <strong className="font-medium">Recusada:</strong> {r.rejectionReason}
            </div>
          ) : null}
          <Card>
            <CardHeader>
              <CardTitle>Briefing</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-5">
              {r.objective ? (
                <div>
                  <p className="text-xs text-fg-subtle">Objetivo</p>
                  <p className="mt-0.5 text-sm whitespace-pre-wrap">{r.objective}</p>
                </div>
              ) : null}
              {r.description ? (
                <div>
                  <p className="text-xs text-fg-subtle">Descrição</p>
                  <p className="mt-0.5 text-sm leading-relaxed whitespace-pre-wrap text-fg-muted">{r.description}</p>
                </div>
              ) : null}
              <InfoList items={standard} />
              {detail.templateFields?.length ? (
                <div className="border-t border-border pt-4">
                  <BriefingAnswers fields={detail.templateFields} answers={r.briefing} />
                </div>
              ) : null}
              {r.references ? (
                <div>
                  <p className="text-xs text-fg-subtle">Referências</p>
                  <p className="mt-0.5 text-sm break-words whitespace-pre-wrap">{r.references}</p>
                </div>
              ) : null}
              {r.copyText ? (
                <div>
                  <p className="text-xs text-fg-subtle">Textos</p>
                  <p className="mt-0.5 rounded-md bg-surface-2 px-3 py-2 text-sm whitespace-pre-wrap">{r.copyText}</p>
                </div>
              ) : null}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <FileAttachments target={{ requestId: r.id }} canUpload={can(actor, "files.write")} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Conversa</CardTitle>
            </CardHeader>
            <CardContent>
              <Comments
                target={{ requestId: r.id }}
                comments={data.comments}
                allowInternal={can(actor, "comments.internal")}
                defaultInternal={false}
              />
            </CardContent>
          </Card>
        </div>
        <div className="grid content-start gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Triagem</CardTitle>
            </CardHeader>
            <CardContent>
              <RequestActions
                request={{
                  id: r.id,
                  number: r.number,
                  title: r.title,
                  status: r.status,
                  assigneeMembershipId: r.assigneeMembershipId,
                  projectId: r.projectId,
                  desiredDueDate: r.desiredDueDate,
                  createdByUserId: r.createdByUserId,
                }}
                members={data.members.map((m) => ({ membershipId: m.membershipId, name: m.name }))}
                projects={data.projects.map((p) => ({ id: p.id, name: p.name }))}
                canTriage={data.triage}
              />
              {data.triage &&
              can(actor, "tasks.write") &&
              can(actor, "ai.use") &&
              !["draft", "rejected", "cancelled", "delivered"].includes(r.status) ? (
                <Link
                  href={`/w/${actor.orgSlug}/tasks?assistente=solicitacao&solicitacao=${r.id}`}
                  className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-accent-text hover:underline"
                >
                  <Sparkles className="size-4" /> Planejar tarefas com IA
                </Link>
              ) : null}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Informações</CardTitle>
            </CardHeader>
            <CardContent>
              <InfoList
                items={[
                  { label: "Aberta por", value: detail.createdByName },
                  { label: "Enviada em", value: r.submittedAt ? formatDateTime(r.submittedAt) : "Rascunho" },
                  { label: "Responsável", value: detail.assigneeName },
                  {
                    label: "Projeto",
                    value: r.projectId ? (
                      <Link href={`${base}/projects/${r.projectId}`} className="text-accent-text hover:underline">
                        {detail.projectName}
                      </Link>
                    ) : null,
                  },
                  { label: "Prazo desejado", value: r.desiredDueDate ? formatDate(r.desiredDueDate) : null },
                ]}
              />
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
