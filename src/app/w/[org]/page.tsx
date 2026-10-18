import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { requireActor } from "@/server/auth/session";

export const metadata: Metadata = { title: "Início" };

export default async function DashboardPage({ params }: PageProps<"/w/[org]">) {
  const { org } = await params;
  const actor = await requireActor(org, { kind: "internal" });
  return <PageHeader title={`Olá, ${actor.name.split(" ")[0]}`} description="Visão geral da operação da agência." />;
}
