import type { Metadata } from "next";
import { ApprovalList } from "@/components/approvals/approval-list";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { SegmentedNav } from "@/components/ui/segmented-nav";
import { inOrg } from "@/server/authz";
import { requirePortal } from "@/server/auth/portal";
import { listApprovals } from "@/server/services/approvals";

export const metadata: Metadata = { title: "Aprovações" };

export default async function PortalApprovalsPage({
  params,
  searchParams,
}: PageProps<"/portal/[org]/[client]/approvals">) {
  const { org, client: clientSlug } = await params;
  const sp = await searchParams;
  const portal = await requirePortal(org, clientSlug, { permission: "approvals.decide_client" });
  const { actor } = portal;
  const tab = sp.tab === "decided" ? "decided" : "client";
  const rows = await inOrg(actor, (s) => listApprovals(s, { tab }));
  const base = `${portal.base}/approvals`;
  return (
    <>
      <PageHeader
        title="Aprovações"
        description="Revise cada material e aprove ou peça ajustes. A decisão vale para a versão que você está vendo."
      >
        <SegmentedNav
          param="tab"
          items={[
            { label: "Aguardando você", href: base, value: "client" },
            { label: "Decididas", href: `${base}?tab=decided`, value: "decided" },
          ]}
        />
      </PageHeader>
      <Card>
        <ApprovalList
          rows={rows}
          emptyTitle={tab === "client" ? "Nada aguardando sua aprovação" : "Nenhuma decisão recente"}
          emptyDescription={
            tab === "client"
              ? "Quando a agência enviar um material para você aprovar, ele aparece aqui."
              : "Suas decisões dos últimos 60 dias aparecem aqui."
          }
        />
      </Card>
    </>
  );
}
