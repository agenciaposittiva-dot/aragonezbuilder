import type { Metadata } from "next";
import { AiSettingsForm } from "@/components/settings/ai-settings-form";
import { inOrg } from "@/server/authz";
import { requireActor } from "@/server/auth/session";
import { aiUsageReport, getAiSettingsView } from "@/server/services/ai";

export const metadata: Metadata = { title: "Inteligência artificial" };

export default async function AiSettingsPage({ params }: PageProps<"/w/[org]/settings/ai">) {
  const { org } = await params;
  const actor = await requireActor(org, { kind: "internal", permission: "ai.settings" });
  const { view, report } = await inOrg(actor, async (s) => ({
    view: await getAiSettingsView(s),
    report: await aiUsageReport(s),
  }));
  return <AiSettingsForm view={view} report={report} />;
}
