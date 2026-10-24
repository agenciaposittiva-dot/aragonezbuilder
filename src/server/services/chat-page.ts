import { can, inOrg, type Actor } from "@/server/authz";
import { env } from "@/server/env";
import { getPickerData } from "./ai-models";
import { chatMembers, listConversations, myStatus } from "./chat";
import { listInternalMembers } from "./members";
import { getSettings } from "./organizations";
import { projectOptions } from "./projects";

/**
 * Dados do Chat da Equipe para a página inteira (/w/[org]/chat) e para a
 * janela flutuante (/chat-dock/[org]) — a mesma consulta, as mesmas regras.
 */
export async function chatAppProps(actor: Actor, activeId: string | null, seq: number) {
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
  return {
    org: actor.orgSlug,
    photoMaxBytes: env.CHAT_PHOTO_MAX_BYTES,
    me: { userId: actor.userId, membershipId: actor.membershipId },
    initial: {
      conversations: data.conversations,
      activeId,
      focusSeq: activeId && Number.isInteger(seq) && seq > 0 ? seq : null,
    },
    members: data.members.map((m) => ({
      userId: m.userId,
      name: m.name,
      image: m.image,
      jobTitle: m.jobTitle,
      roleName: m.roleName,
    })),
    projects: data.projects.map((p) => ({ id: p.id, name: p.name, clientName: p.clientName })),
    assignees: data.assignees.map((m) => ({ membershipId: m.membershipId, name: m.name })),
    permissions: {
      canManageChannels: can(actor, "chat.manage_channels"),
      canAssign: can(actor, "tasks.assign"),
      canCreateTasks: canTasks,
    },
    ai: {
      allowed: data.aiAllowed,
      contextAllowed: data.allowChatContext,
      canConfigure: can(actor, "ai.settings"),
      providers: data.picker.providers,
      preferences: data.picker.preferences,
    },
    status: data.status,
  };
}
