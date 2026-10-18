import { requireActor } from "@/server/auth/session";

export default async function SettingsGeneralPage({ params }: PageProps<"/w/[org]/settings">) {
  const { org } = await params;
  await requireActor(org, { kind: "internal", permission: "org.manage" });
  return <p className="text-sm text-fg-muted">Em construção.</p>;
}
