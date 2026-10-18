import type { Metadata } from "next";
import { cookies } from "next/headers";
import { AppHeader } from "@/components/shell/app-header";
import { ChatUnreadProvider } from "@/components/chat/chat-unread";
import { CommandMenu } from "@/components/shell/command-menu";
import { RememberOrg } from "@/components/shell/remember-org";
import { Sidebar } from "@/components/shell/sidebar";
import { WorkspaceProvider } from "@/components/shell/workspace-context";
import { can, inOrg } from "@/server/authz";
import { listUserOrganizations } from "@/server/authz/actor";
import { requireActor } from "@/server/auth/session";
import { getChatAlertPrefs } from "@/server/services/notification-preferences";
import { getShellCounts } from "@/server/services/shell";

export async function generateMetadata({ params }: LayoutProps<"/w/[org]">): Promise<Metadata> {
  const { org } = await params;
  return { title: { default: "Início", template: `%s · ${org}` } };
}

/** Avisos de mensagens só para o que chegar depois de abrir a página (relógio do servidor). */
function openedAt() {
  return Date.now();
}

export default async function WorkspaceLayout({ children, params }: LayoutProps<"/w/[org]">) {
  const { org } = await params;
  const actor = await requireActor(org, { kind: "internal" });
  const chat = can(actor, "chat.use");
  const [orgs, counts, alerts, cookieStore] = await Promise.all([
    listUserOrganizations(actor.userId),
    inOrg(actor, getShellCounts),
    chat ? inOrg(actor, getChatAlertPrefs) : null,
    cookies(),
  ]);
  const since = openedAt();
  const base = `/w/${actor.orgSlug}`;
  const collapsed = cookieStore.get("sidebar_collapsed")?.value === "1";

  return (
    <WorkspaceProvider
      value={{
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
      }}
    >
      <RememberOrg slug={actor.orgSlug} />
      <ChatUnreadProvider org={actor.orgSlug} enabled={chat} initial={counts.badges.chat} alerts={alerts} since={since}>
        <div className="flex min-h-dvh">
          <Sidebar
            nav="workspace"
            base={base}
            badges={counts.badges}
            orgs={orgs.map((o) => ({ slug: o.slug, name: o.name, logoUrl: o.logoSrc, kind: o.kind }))}
            defaultCollapsed={collapsed}
          />
          <div className="flex min-w-0 flex-1 flex-col">
            <AppHeader
              nav="workspace"
              base={base}
              badges={counts.badges}
              orgs={orgs.map((o) => ({ slug: o.slug, name: o.name, logoUrl: o.logoSrc, kind: o.kind }))}
              unread={counts.unread}
              accountHref={`${base}/account`}
            />
            <main id="conteudo" className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6 lg:px-8">
              {children}
            </main>
          </div>
        </div>
      </ChatUnreadProvider>
      <CommandMenu nav="workspace" base={base} />
    </WorkspaceProvider>
  );
}
