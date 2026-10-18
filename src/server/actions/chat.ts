"use server";

import { z } from "zod";
import { CHAT_DEPARTMENTS } from "@/lib/chat-format";
import { priorityEnum } from "@/lib/validators/common";
import {
  addParticipants,
  availabilityInput,
  channelInput,
  chatMembers,
  conversationAttachments,
  conversationTasks,
  conversationUpdateInput,
  createChannel,
  createDefaultChannels,
  createGroup,
  groupInput,
  joinConversation,
  linkMessageTask,
  listChannels,
  loadAccess,
  messageForTask,
  myStatus,
  openDirect,
  openProjectConversation,
  openTaskConversation,
  participantPrefsInput,
  projectMentions,
  removeParticipant,
  sendMessage,
  setAvailability,
  setParticipantPrefs,
  updateConversation,
} from "@/server/services/chat";
import { createTask, getTask, listTasks } from "@/server/services/tasks";
import { orgAction } from "./safe-action";

// O chat mantém o próprio estado (sincronização), então nenhuma ação re-renderiza a página.
const quiet = { refresh: false } as const;

export const openDirectAction = orgAction(
  z.object({ userId: z.string().min(1).max(64) }),
  (s, i) => openDirect(s, i.userId),
  quiet,
);
export const createGroupAction = orgAction(groupInput, (s, i) => createGroup(s, i), quiet);
export const createChannelAction = orgAction(channelInput, (s, i) => createChannel(s, i), quiet);
export const createDefaultChannelsAction = orgAction(
  z.object({}),
  (s) => createDefaultChannels(s, CHAT_DEPARTMENTS),
  quiet,
);
export const openProjectConversationAction = orgAction(
  z.object({ projectId: z.uuid() }),
  (s, i) => openProjectConversation(s, i.projectId),
  quiet,
);
export const openTaskConversationAction = orgAction(
  z.object({ taskId: z.uuid() }),
  (s, i) => openTaskConversation(s, i.taskId),
  quiet,
);
export const joinConversationAction = orgAction(z.object({ id: z.uuid() }), (s, i) => joinConversation(s, i.id), quiet);
export const updateConversationAction = orgAction(conversationUpdateInput, (s, i) => updateConversation(s, i), quiet);
export const addParticipantsAction = orgAction(
  z.object({ conversationId: z.uuid(), userIds: z.array(z.string()).min(1).max(100) }),
  (s, i) => addParticipants(s, i.conversationId, i.userIds),
  quiet,
);
export const removeParticipantAction = orgAction(
  z.object({ conversationId: z.uuid(), userId: z.string().min(1).max(64) }),
  (s, i) => removeParticipant(s, i.conversationId, i.userId),
  quiet,
);
export const setParticipantPrefsAction = orgAction(participantPrefsInput, (s, i) => setParticipantPrefs(s, i), quiet);
export const setAvailabilityAction = orgAction(availabilityInput, (s, i) => setAvailability(s, i), quiet);
export const myChatStatusAction = orgAction(z.object({}), (s) => myStatus(s), quiet);
export const listChannelsAction = orgAction(z.object({}), (s) => listChannels(s), quiet);
export const chatMembersAction = orgAction(z.object({}), (s) => chatMembers(s), quiet);

/** Painel contextual: tarefas ligadas e arquivos compartilhados. */
export const conversationPanelAction = orgAction(
  z.object({ conversationId: z.uuid() }),
  async (s, i) => ({
    tasks: (await conversationTasks(s, i.conversationId)).map((t) => ({
      ...t,
      completedAt: t.completedAt?.toISOString() ?? null,
    })),
    attachments: (await conversationAttachments(s, i.conversationId)).map((a) => ({
      ...a,
      createdAt: a.createdAt.toISOString(),
    })),
  }),
  quiet,
);

export const projectMentionsAction = orgAction(
  z.object({ projectId: z.uuid() }),
  (s, i) => projectMentions(s, i.projectId),
  quiet,
);

const taskFromMessage = z.object({
  messageId: z.uuid(),
  projectId: z.uuid(),
  title: z.string().trim().min(1, "Informe o título").max(300),
  description: z.string().max(20000).optional().nullable(),
  assigneeMembershipId: z.uuid().optional().nullable(),
  dueDate: z.string().optional().nullable(),
  priority: priorityEnum.optional(),
});

/** Cria uma tarefa a partir de uma mensagem (sempre por ação explícita da pessoa). */
export const createTaskFromMessageAction = orgAction(
  taskFromMessage,
  async (s, i) => {
    const { conv } = await messageForTask(s, i.messageId);
    const link = `/w/${s.actor.orgSlug}/chat/${conv.id}`;
    const task = await createTask(s, {
      projectId: i.projectId,
      title: i.title,
      description: [i.description?.trim(), `Criada a partir de uma mensagem do Chat da Equipe: ${link}`]
        .filter(Boolean)
        .join("\n\n"),
      assigneeMembershipId: i.assigneeMembershipId || null,
      dueDate: i.dueDate || null,
      priority: i.priority ?? "medium",
    });
    await linkMessageTask(s, i.messageId, task.id, true);
    return { id: task.id };
  },
  quiet,
);

/** Vincula uma tarefa existente a uma mensagem. */
export const linkMessageTaskAction = orgAction(
  z.object({ messageId: z.uuid(), taskId: z.uuid() }),
  (s, i) => linkMessageTask(s, i.messageId, i.taskId, false),
  quiet,
);

/** Busca curta de tarefas (para vincular). */
export const findTasksAction = orgAction(
  z.object({ q: z.string().max(100) }),
  async (s, i) =>
    (await listTasks(s, { q: i.q || undefined, view: "list", pageSize: 10, sort: "recent" })).rows.map((t) => ({
      id: t.id,
      title: t.title,
      projectName: t.projectName,
      clientName: t.clientName,
    })),
  quiet,
);

/**
 * Tarefas sugeridas pela IA: só são criadas depois que a pessoa revisa e
 * confirma a lista (nada é gravado automaticamente).
 */
export const createSuggestedChatTasksAction = orgAction(
  z.object({
    conversationId: z.uuid(),
    projectId: z.uuid(),
    tasks: z
      .array(
        z.object({
          title: z.string().trim().min(1).max(300),
          description: z.string().max(5000).optional().nullable(),
          estimateMinutes: z.number().int().min(0).max(100_000).optional().nullable(),
        }),
      )
      .min(1)
      .max(20),
  }),
  async (s, i) => {
    const a = await loadAccess(s, i.conversationId);
    const link = `/w/${s.actor.orgSlug}/chat/${a.conv.id}`;
    const ids: string[] = [];
    for (const t of i.tasks) {
      const created = await createTask(s, {
        projectId: i.projectId,
        title: t.title,
        description: [t.description?.trim(), `Sugerida pela IA a partir do Chat da Equipe: ${link}`]
          .filter(Boolean)
          .join("\n\n"),
        estimateMinutes: t.estimateMinutes || null,
      });
      ids.push(created.id);
    }
    await sendMessage(s, {
      conversationId: a.conv.id,
      clientId: `tasks-${crypto.randomUUID()}`,
      body: `Tarefas criadas a partir desta conversa (revisadas antes de criar):\n${ids
        .map((id) => `/w/${s.actor.orgSlug}/tasks/${id}`)
        .join("\n")}`,
    });
    return { created: ids.length };
  },
  quiet,
);

/** Compartilha um projeto, tarefa, arte ou arquivo numa conversa. */
export const shareToConversationAction = orgAction(
  z.object({
    conversationId: z.uuid(),
    type: z.enum(["projects", "tasks", "studio", "files"]),
    id: z.uuid(),
    note: z.string().max(2000).optional(),
  }),
  async (s, i) => {
    const path = `/w/${s.actor.orgSlug}/${i.type}/${i.id}`;
    const msg = await sendMessage(s, {
      conversationId: i.conversationId,
      clientId: `share-${crypto.randomUUID()}`,
      body: [i.note?.trim(), path].filter(Boolean).join("\n"),
    });
    if (!msg.refs.length) {
      // O link foi enviado, mas sem acesso o registro não aparece como referência.
      return { id: msg.id, linked: false };
    }
    return { id: msg.id, linked: true };
  },
  quiet,
);

/** Resumo da tarefa para ver sem sair da conversa (o acesso é o da própria tarefa). */
export const taskSummaryAction = orgAction(
  z.object({ taskId: z.uuid() }),
  async (s, i) => {
    const t = await getTask(s, i.taskId);
    return {
      id: t.task.id,
      title: t.task.title,
      description: t.task.description,
      dueDate: t.task.dueDate,
      priority: t.task.priority,
      completedAt: t.task.completedAt?.toISOString() ?? null,
      statusName: t.status.name,
      statusColor: t.status.color,
      projectId: t.task.projectId,
      projectName: t.projectName,
      clientName: t.clientName,
      assigneeName: t.assigneeName,
      assigneeImage: t.assigneeImage,
      checklistDone: t.checklist.filter((c) => c.done).length,
      checklistTotal: t.checklist.length,
    };
  },
  quiet,
);
