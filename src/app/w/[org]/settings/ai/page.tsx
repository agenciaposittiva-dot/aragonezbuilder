import type { Metadata } from "next";
import { AiSettingsForm } from "@/components/settings/ai-settings-form";
import { inOrg } from "@/server/authz";
import { requireActor } from "@/server/auth/session";
import { aiUsageReport, getAiSettingsView } from "@/server/services/ai";
import { personalConnectionStats } from "@/server/services/ai-connections";
import { getPickerData } from "@/server/services/ai-models";
import { providerStates } from "@/server/services/ai-providers";

export const metadata: Metadata = { title: "Inteligência artificial" };

export default async function AiSettingsPage({ params }: PageProps<"/w/[org]/settings/ai">) {
  const { org } = await params;
  const actor = await requireActor(org, { kind: "internal", permission: "ai.settings" });
  const data = await inOrg(actor, async (s) => {
    // Valida credenciais ainda não verificadas para mostrar o estado real de cada provedor.
    const picker = await getPickerData(s, { refresh: true });
    const personal = await personalConnectionStats(s);
    return {
      view: await getAiSettingsView(s),
      report: await aiUsageReport(s),
      // Somente o final mascarado da chave da organização; a chave nunca vai ao navegador.
      providers: (await providerStates(s, { admin: true })).map((p) => ({
        id: p.id,
        label: p.label,
        kinds: p.kinds,
        needsKey: p.needsKey,
        keySource: p.keySource,
        keyMask: p.keyMask,
        enabled: p.enabled,
        status: p.status,
        lastError: p.lastError,
        lastCheckedAt: p.lastCheckedAt,
        models: p.models,
        ready: p.ready,
        params: p.params,
        notes: p.notes,
        userKeysAllowed: p.userKeysAllowed,
        personal: personal[p.id] ?? null,
      })),
      picker,
    };
  });
  return <AiSettingsForm {...data} />;
}
