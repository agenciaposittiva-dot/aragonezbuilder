import type { Metadata } from "next";
import { ApprovalList } from "@/components/approvals/approval-list";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { SegmentedNav } from "@/components/ui/segmented-nav";
import { inOrg } from "@/server/authz";
import { requireActor } from "@/server/auth/session";
import { listApprovals } from "@/server/services/approvals";

export const metadata: Metadata = { title: "Aprovações" };

export default async function PortalApprovalsPage({ params, searchParams }: PageProps<"/portal/[org]/approvals">) {
  const { org } = await params;
  const sp = await searchParams;
  const actor = await requireActor(org, { kind: "client", permission: "approvals.decide_client" });
  const tab = sp.tab === "decided" ? "decided" : "client";
  const rows = await inOrg(actor, (s) => listApprovals(s, { tab }));
  const base = `/portal/${actor.orgSlug}/approvals`;
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
