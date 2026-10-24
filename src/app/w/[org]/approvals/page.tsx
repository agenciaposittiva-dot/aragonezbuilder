import type { Metadata } from "next";
import { ApprovalList } from "@/components/approvals/approval-list";
import { ApprovalLinksTable, CreateApprovalLinkDialog } from "@/components/approvals/approval-links-manager";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { SegmentedNav } from "@/components/ui/segmented-nav";
import { approvalListParams } from "@/lib/validators/approvals";
import { can, inOrg } from "@/server/authz";
import { requireActor } from "@/server/auth/session";
import { listApprovalLinks } from "@/server/services/approval-links";
import { approvalCounts, listApprovals } from "@/server/services/approvals";
import { clientOptions } from "@/server/services/clients";

export const metadata: Metadata = { title: "Aprovações" };

export default async function ApprovalsPage({ params, searchParams }: PageProps<"/w/[org]/approvals">) {
  const { org } = await params;
  const sp = await searchParams;
  const actor = await requireActor(org, { kind: "internal", permission: "files.read" });
  const links = sp.tab === "links";
  const parsed = approvalListParams.safeParse({ tab: sp.tab });
  const tab = parsed.success ? parsed.data.tab : "internal";
  const canLink = can(actor, "approvals.request");
  const { rows, counts, linkRows, clients } = await inOrg(actor, async (s) => ({
    rows: links ? [] : await listApprovals(s, { tab }),
    counts: await approvalCounts(s),
    linkRows: links ? await listApprovalLinks(s) : [],
    clients: canLink ? await clientOptions(s) : [],
  }));
  const base = `/w/${actor.orgSlug}/approvals`;
  return (
    <>
      <PageHeader
        title="Aprovações"
        description="Cada decisão vale para uma versão específica do arquivo. Novas versões exigem nova aprovação."
        actions={canLink ? <CreateApprovalLinkDialog clients={clients} /> : null}
      >
        <SegmentedNav
          param="tab"
          items={[
            {
              label: `Revisão interna${counts.internal ? ` (${counts.internal})` : ""}`,
              href: base,
              value: "internal",
            },
            {
              label: `Com o cliente${counts.client ? ` (${counts.client})` : ""}`,
              href: `${base}?tab=client`,
              value: "client",
            },
            { label: "Decididas", href: `${base}?tab=decided`, value: "decided" },
            { label: "Links de aprovação", href: `${base}?tab=links`, value: "links" },
          ]}
        />
      </PageHeader>
      {links ? (
        <Card>
          <ApprovalLinksTable rows={linkRows} canManage={canLink} />
        </Card>
      ) : (
        <Card>
          <ApprovalList
            rows={rows}
            emptyTitle={
              tab === "internal"
                ? "Nada aguardando revisão interna"
                : tab === "client"
                  ? "Nada aguardando o cliente"
                  : "Nenhuma decisão recente"
            }
            emptyDescription={
              tab === "decided"
                ? "Decisões dos últimos 60 dias aparecem aqui."
                : "Envie versões para aprovação a partir da página do arquivo."
            }
          />
        </Card>
      )}
    </>
  );
}
