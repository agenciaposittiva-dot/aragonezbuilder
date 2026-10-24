import type { WorkspaceInfo } from "@/components/shell/workspace-context";
import type { Actor } from "./actor";

/** O que a interface precisa saber do ator (mesmo objeto na área da equipe e na janela do chat). */
export function workspaceInfo(actor: Actor): WorkspaceInfo {
  return {
    orgSlug: actor.orgSlug,
    orgName: actor.orgName,
    orgLogoUrl: actor.orgLogoSrc,
    userId: actor.userId,
    userName: actor.name,
    userEmail: actor.email,
    userImage: actor.image,
    membershipId: actor.membershipId,
    roleName: actor.roleName,
    kind: actor.kind,
    permissions: [...actor.permissions],
  };
}
