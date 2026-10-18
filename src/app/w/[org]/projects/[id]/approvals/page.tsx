import { ApprovalList } from "@/components/approvals/approval-list";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { inOrg } from "@/server/authz";
import { requireActor } from "@/server/auth/session";
import { listApprovals } from "@/server/services/approvals";
import { getProject } from "@/server/services/projects";

export default async function ProjectApprovalsPage({ params }: PageProps<"/w/[org]/projects/[id]/approvals">) {
  const { org, id } = await params;
  const actor = await requireActor(org, { kind: "internal", permission: "files.read" });
  const data = await inOrg(actor, async (s) => {
    await getProject(s, id);
    return {
      internal: await listApprovals(s, { tab: "internal", projectId: id }),
      client: await listApprovals(s, { tab: "client", projectId: id }),
      decided: await listApprovals(s, { tab: "decided", projectId: id }),
    };
  });
  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Aguardando revisão interna</CardTitle>
        </CardHeader>
        <ApprovalList rows={data.internal} emptyTitle="Nada aguardando revisão interna" />
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Aguardando o cliente</CardTitle>
        </CardHeader>
        <ApprovalList rows={data.client} emptyTitle="Nada aguardando o cliente" />
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Decididas recentemente</CardTitle>
        </CardHeader>
        <ApprovalList rows={data.decided} emptyTitle="Nenhuma decisão nos últimos 60 dias" />
      </Card>
    </div>
  );
}
