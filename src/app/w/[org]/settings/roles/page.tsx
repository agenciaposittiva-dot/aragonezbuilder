import type { Metadata } from "next";
import { RolesEditor } from "@/components/settings/roles-editor";
import { inOrg } from "@/server/authz";
import { requireActor } from "@/server/auth/session";
import { listRolesWithCounts } from "@/server/services/roles";

export const metadata: Metadata = { title: "Papéis e permissões" };

export default async function RolesPage({ params }: PageProps<"/w/[org]/settings/roles">) {
  const { org } = await params;
  const actor = await requireActor(org, { kind: "internal", permission: "roles.manage" });
  const roles = await inOrg(actor, listRolesWithCounts);
  return <RolesEditor roles={roles} currentRoleId={actor.roleId} />;
}
