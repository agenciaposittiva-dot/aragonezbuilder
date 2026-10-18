import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { UnderlineTabs } from "@/components/ui/underline-tabs";
import { can } from "@/server/authz";
import { requireActor } from "@/server/auth/session";

export const metadata: Metadata = { title: "Financeiro" };

export default async function FinanceLayout({ children, params }: LayoutProps<"/w/[org]/finance">) {
  const { org } = await params;
  const actor = await requireActor(org, { kind: "internal", permission: "finance.read" });
  const base = `/w/${actor.orgSlug}/finance`;
  return (
    <>
      <PageHeader
        title="Financeiro"
        description="Contas a receber e a pagar, contratos recorrentes e rentabilidade por projeto e cliente."
      />
      <div className="mb-6 border-b border-border">
        <UnderlineTabs
          items={[
            { label: "Visão geral", href: base, exact: true },
            { label: "Faturas", href: `${base}/invoices` },
            { label: "Despesas", href: `${base}/expenses` },
            { label: "Contratos", href: `${base}/contracts` },
            ...(can(actor, "costs.read") ? [{ label: "Rentabilidade", href: `${base}/profitability` }] : []),
          ]}
        />
      </div>
      {children}
    </>
  );
}
