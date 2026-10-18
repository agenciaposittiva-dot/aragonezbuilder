import type { Metadata } from "next";
import { InvitationsList } from "@/components/team/invitations-list";
import { InviteDialog } from "@/components/team/invite-dialog";
import { MembersTable } from "@/components/team/members-table";
import { WorkloadView } from "@/components/team/workload-view";
import { PageHeader } from "@/components/ui/page-header";
import { SegmentedNav } from "@/components/ui/segmented-nav";
import { can, inOrg } from "@/server/authz";
import { requireActor } from "@/server/auth/session";
import { clientOptions } from "@/server/services/clients";
import { listInvitations } from "@/server/services/invitations";
import { listMembers, listRoleOptions, workload } from "@/server/services/team";

export const metadata: Metadata = { title: "Equipe" };

export default async function TeamPage({ params, searchParams }: PageProps<"/w/[org]/team">) {
  const { org } = await params;
  const sp = await searchParams;
  const actor = await requireActor(org, { kind: "internal", permission: "members.read" });
  const tab = sp.tab === "invites" || sp.tab === "workload" ? sp.tab : "members";
  const canManage = can(actor, "members.manage");
  const base = `/w/${actor.orgSlug}/team`;

  const data = await inOrg(actor, async (s) => ({
    members: tab === "members" ? await listMembers(s) : [],
    invitations: tab === "invites" ? await listInvitations(s) : [],
    workload: tab === "workload" ? await workload(s) : null,
    roles: await listRoleOptions(s),
    clients: canManage ? await clientOptions(s) : [],
    pendingCount: tab === "invites" ? 0 : (await listInvitations(s)).length,
  }));
  const pending = tab === "invites" ? data.invitations.length : data.pendingCount;

  return (
    <>
      <PageHeader
        title="Equipe"
        description="Pessoas, papéis, convites e distribuição da carga de trabalho."
        actions={
          canManage ? (
            <InviteDialog roles={data.roles} clients={data.clients} canInviteOwner={actor.roleKey === "owner"} />
          ) : null
        }
      >
        <SegmentedNav
          param="tab"
          items={[
            { label: "Membros", value: "members", href: base },
            { label: pending ? `Convites (${pending})` : "Convites", value: "invites", href: `${base}?tab=invites` },
            { label: "Carga de trabalho", value: "workload", href: `${base}?tab=workload` },
          ]}
        />
      </PageHeader>
      {tab === "members" ? (
        <MembersTable
          members={data.members}
          roles={data.roles}
          clients={data.clients}
          canManage={canManage}
          canSeeCost={can(actor, "costs.read")}
          isOwner={actor.roleKey === "owner"}
        />
      ) : null}
      {tab === "invites" ? <InvitationsList invitations={data.invitations} canManage={canManage} /> : null}
      {tab === "workload" && data.workload ? <WorkloadView {...data.workload} /> : null}
    </>
  );
}
