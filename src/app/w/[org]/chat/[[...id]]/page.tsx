import type { Metadata } from "next";
import { z } from "zod";
import { ChatApp } from "@/components/chat/chat-app";
import { can, inOrg } from "@/server/authz";
import { requireActor } from "@/server/auth/session";
import { getPickerData } from "@/server/services/ai-models";
import { chatMembers, listConversations, myStatus } from "@/server/services/chat";
import { listInternalMembers } from "@/server/services/members";
import { getSettings } from "@/server/services/organizations";
import { projectOptions } from "@/server/services/projects";

export const metadata: Metadata = { title: "Chat da Equipe" };

export default async function ChatPage({ params, searchParams }: PageProps<"/w/[org]/chat/[[...id]]">) {
  const { org, id } = await params;
  const sp = await searchParams;
  // Clientes (kind=client) não chegam aqui: o chat é só da equipe interna.
  const actor = await requireActor(org, { kind: "internal", permission: "chat.use" });
  const activeId = z.uuid().safeParse(id?.[0]).data ?? null;
  const seq = Number(typeof sp.m === "string" ? sp.m : NaN);
  const canTasks = can(actor, "tasks.write");

  const data = await inOrg(actor, async (s) => {
    const settings = (await getSettings(s)).ai;
    const aiAllowed = settings.enabled && can(actor, "ai.use");
    return {
      conversations: await listConversations(s),
      members: await chatMembers(s),
      projects: canTasks ? await projectOptions(s) : [],
      assignees: canTasks ? await listInternalMembers(s) : [],
      status: await myStatus(s),
      picker: aiAllowed ? await getPickerData(s) : { providers: [], preferences: [] },
      aiAllowed,
      allowChatContext: settings.allowChatContext,
    };
  });

  return (
    <ChatApp
      org={actor.orgSlug}
      me={{ userId: actor.userId, membershipId: actor.membershipId }}
      initial={{
        conversations: data.conversations,
        activeId,
        focusSeq: activeId && Number.isInteger(seq) && seq > 0 ? seq : null,
      }}
      members={data.members.map((m) => ({
        userId: m.userId,
        name: m.name,
        image: m.image,
        jobTitle: m.jobTitle,
        roleName: m.roleName,
      }))}
      projects={data.projects.map((p) => ({ id: p.id, name: p.name, clientName: p.clientName }))}
      assignees={data.assignees.map((m) => ({ membershipId: m.membershipId, name: m.name }))}
      permissions={{
        canManageChannels: can(actor, "chat.manage_channels"),
        canAssign: can(actor, "tasks.assign"),
        canCreateTasks: canTasks,
      }}
      ai={{
        allowed: data.aiAllowed,
        contextAllowed: data.allowChatContext,
        canConfigure: can(actor, "ai.settings"),
        providers: data.picker.providers,
        preferences: data.picker.preferences,
      }}
      status={data.status}
    />
  );
}
