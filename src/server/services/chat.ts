import { and, asc, desc, eq, gt, inArray, isNull, lt, lte, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { CHAT_LIMITS, CHAT_REACTIONS, excerpt, extractMentions } from "@/lib/chat-format";
import { prefEnabled } from "@/lib/notification-prefs";
import {
  assertCan,
  assertInternal,
  assertProjectAccess,
  assertTaskAccess,
  can,
  projectScope,
  taskScope,
  type Scope,
} from "@/server/authz";
import {
  chatAttachments,
  chatConversations,
  chatMessages,
  chatParticipants,
  chatReactions,
  chatUserStatus,
  domainEvents,
  memberships,
  notifications,
  projectMembers,
  projects,
  roles,
  taskCollaborators,
  tasks,
  user,
} from "@/server/db/schema";
import { ForbiddenError, LimitError, NotFoundError, ValidationError } from "@/server/errors";
import { recordActivity } from "./activity";
import { preferencesFor } from "./notification-preferences";

/*
 * Chat da Equipe (conversas internas). Toda verificação de acesso acontece
 * aqui, no servidor: a interface só esconde o que a pessoa não pode usar.
 *
 *  - Diretas e grupos: só participantes.
 *  - Canais abertos: qualquer pessoa da equipe com acesso ao chat (entra ao abrir).
 *  - Canais privados: só participantes.
 *  - Conversas de projeto/tarefa: quem pode ver o projeto/tarefa (entra ao abrir).
 *    Se o projeto/tarefa for apagado de vez, ficam só para quem já participava.
 * Usuários de cliente nunca acessam o chat interno.
 */

export type Conversation = typeof chatConversations.$inferSelect;
export type Participant = typeof chatParticipants.$inferSelect;

type Access = {
  conv: Conversation;
  participant: Participant | null;
  moderator: boolean;
  canPost: boolean;
};

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const uuid = z.uuid();

export function assertChat(s: Scope) {
  assertInternal(s.actor);
  assertCan(s.actor, "chat.use");
}

/* ------------------------------------------------------------------ */
/* Pessoas                                                             */
/* ------------------------------------------------------------------ */

export type ChatMember = {
  userId: string;
  name: string;
  image: string | null;
  email: string;
  jobTitle: string | null;
  roleName: string;
};

/** Pessoas da equipe que podem usar o chat (diretas, grupos e menções). */
export async function chatMembers(s: Scope): Promise<ChatMember[]> {
  assertChat(s);
  return s.db
    .select({
      userId: user.id,
      name: user.name,
      image: user.image,
      email: user.email,
      jobTitle: memberships.jobTitle,
      roleName: roles.name,
    })
    .from(memberships)
    .innerJoin(user, eq(user.id, memberships.userId))
    .innerJoin(roles, eq(roles.id, memberships.roleId))
    .where(
      and(eq(memberships.status, "active"), eq(roles.kind, "internal"), sql`'chat.use' = any(${roles.permissions})`),
    )
    .orderBy(asc(user.name));
}

async function assertChatUsers(s: Scope, userIds: string[]) {
  const ids = [...new Set(userIds)];
  if (!ids.length) return [];
  if (ids.some((id) => !ID_RE.test(id))) throw new ValidationError("Pessoa inválida.");
  const members = await chatMembers(s);
  const allowed = new Set(members.map((m) => m.userId));
  if (ids.some((id) => !allowed.has(id))) {
    throw new ValidationError("Uma das pessoas escolhidas não faz parte da equipe ou não usa o chat.");
  }
  return ids;
}

/* ------------------------------------------------------------------ */
/* Acesso                                                              */
/* ------------------------------------------------------------------ */

async function visible(fn: () => Promise<unknown>) {
  try {
    await fn();
    return true;
  } catch (err) {
    if (err instanceof NotFoundError || err instanceof ForbiddenError) return false;
    throw err;
  }
}

/** Carrega a conversa e confirma que o ator pode lê-la (senão, "não encontrada"). */
export async function loadAccess(s: Scope, conversationId: string): Promise<Access> {
  assertChat(s);
  if (!uuid.safeParse(conversationId).success) throw new NotFoundError("Conversa não encontrada.");
  const [row] = await s.db
    .select({ conv: chatConversations, p: chatParticipants })
    .from(chatConversations)
    .leftJoin(
      chatParticipants,
      and(eq(chatParticipants.conversationId, chatConversations.id), eq(chatParticipants.userId, s.actor.userId)),
    )
    .where(eq(chatConversations.id, conversationId));
  if (!row) throw new NotFoundError("Conversa não encontrada.");
  const { conv, p } = row;
  let readable: boolean;
  switch (conv.kind) {
    case "direct":
    case "group":
      readable = !!p;
      break;
    case "channel":
      readable = !!p || !conv.isPrivate;
      break;
    case "project":
      readable = conv.projectId ? await visible(() => assertProjectAccess(s, conv.projectId!)) : !!p;
      break;
    case "task":
      readable = conv.taskId ? await visible(() => assertTaskAccess(s, conv.taskId!)) : !!p;
      break;
  }
  if (!readable) throw new NotFoundError("Conversa não encontrada.");
  const moderator =
    conv.kind !== "direct" &&
    (p?.role === "owner" || p?.role === "admin" || (conv.kind !== "group" && can(s.actor, "chat.manage_channels")));
  const canPost = !conv.archivedAt && (conv.postingPolicy !== "admins" || moderator);
  return { conv, participant: p, moderator, canPost };
}

/** Entra na conversa ao abrir/escrever (canais abertos, projetos, tarefas). */
async function ensureParticipant(s: Scope, a: Access): Promise<Participant> {
  if (a.participant) return a.participant;
  if (a.conv.kind === "direct" || a.conv.kind === "group" || (a.conv.kind === "channel" && a.conv.isPrivate)) {
    throw new ForbiddenError("Você não participa desta conversa.");
  }
  await s.db
    .insert(chatParticipants)
    .values({ organizationId: s.actor.orgId, conversationId: a.conv.id, userId: s.actor.userId })
    .onConflictDoNothing();
  const [p] = await s.db
    .select()
    .from(chatParticipants)
    .where(and(eq(chatParticipants.conversationId, a.conv.id), eq(chatParticipants.userId, s.actor.userId)));
  a.participant = p!;
  return p!;
}

/** Conversas de projeto/tarefa somem da lista quando o projeto/tarefa deixa de ser visível. */
function linkedVisible(s: Scope): SQL {
  const ps = projectScope(s.actor) ?? sql`true`;
  const ts = taskScope(s.actor) ?? sql`true`;
  return sql`(${chatConversations.projectId} is null or exists (select 1 from ${projects} where ${projects.id} = ${chatConversations.projectId} and ${ps}))
    and (${chatConversations.taskId} is null or exists (select 1 from ${tasks} where ${tasks.id} = ${chatConversations.taskId} and ${ts}))`;
}

/* ------------------------------------------------------------------ */
/* Lista de conversas                                                  */
/* ------------------------------------------------------------------ */

export type ConversationSummary = {
  id: string;
  kind: Conversation["kind"];
  name: string;
  topic: string | null;
  department: string | null;
  projectId: string | null;
  taskId: string | null;
  isPrivate: boolean;
  lastSeq: number;
  lastMessageAt: string | null;
  archived: boolean;
  unread: number;
  mentions: number;
  notify: string;
  muted: boolean;
  pinned: boolean;
  favorite: boolean;
  hidden: boolean;
  role: string;
  last: { body: string; authorId: string | null; deleted: boolean; kind: string } | null;
  other: { id: string; name: string; image: string | null } | null;
};

export async function listConversations(s: Scope): Promise<ConversationSummary[]> {
  assertChat(s);
  const me = s.actor.userId;
  const res = await s.db.execute<{
    id: string;
    kind: Conversation["kind"];
    name: string | null;
    topic: string | null;
    department: string | null;
    project_id: string | null;
    task_id: string | null;
    is_private: boolean;
    last_seq: string;
    last_message_at: string | null;
    archived_at: string | null;
    notify: string;
    muted_until: string | null;
    pinned_at: string | null;
    favorite_at: string | null;
    p_archived_at: string | null;
    role: string;
    unread: number;
    mentions: number;
    last_body: string | null;
    last_author: string | null;
    last_deleted: string | null;
    last_kind: string | null;
    other_id: string | null;
    other_name: string | null;
    other_image: string | null;
  }>(sql`
    select ${chatConversations.id} as id, ${chatConversations.kind} as kind, ${chatConversations.name} as name,
      ${chatConversations.topic} as topic, ${chatConversations.department} as department,
      ${chatConversations.projectId} as project_id, ${chatConversations.taskId} as task_id,
      ${chatConversations.isPrivate} as is_private, ${chatConversations.lastSeq} as last_seq,
      ${chatConversations.lastMessageAt} as last_message_at, ${chatConversations.archivedAt} as archived_at,
      ${chatParticipants.notify} as notify, ${chatParticipants.mutedUntil} as muted_until,
      ${chatParticipants.pinnedAt} as pinned_at, ${chatParticipants.favoriteAt} as favorite_at,
      ${chatParticipants.archivedAt} as p_archived_at, ${chatParticipants.role} as role,
      (select count(*)::int from ${chatMessages} m where m.conversation_id = ${chatConversations.id}
        and m.seq > ${chatParticipants.lastReadSeq} and m.deleted_at is null and m.kind = 'text'
        and m.author_user_id is distinct from ${me}) as unread,
      (select count(*)::int from ${chatMessages} m where m.conversation_id = ${chatConversations.id}
        and m.seq > ${chatParticipants.lastReadSeq} and m.deleted_at is null and ${me} = any(m.mentions)) as mentions,
      lm.body as last_body, lm.author_user_id as last_author, lm.deleted_at as last_deleted, lm.kind as last_kind,
      other.id as other_id, other.name as other_name, other.image as other_image
    from ${chatParticipants}
    join ${chatConversations} on ${chatConversations.id} = ${chatParticipants.conversationId}
    left join lateral (
      select m.body, m.author_user_id, m.deleted_at, m.kind from ${chatMessages} m
      where m.conversation_id = ${chatConversations.id} order by m.seq desc limit 1
    ) lm on true
    left join lateral (
      select u.id, u.name, u.image from ${chatParticipants} p2 join ${user} u on u.id = p2.user_id
      where p2.conversation_id = ${chatConversations.id} and p2.user_id <> ${me}
        and ${chatConversations.kind} = 'direct'
      limit 1
    ) other on true
    where ${chatParticipants.userId} = ${me} and ${linkedVisible(s)}
    order by ${chatParticipants.pinnedAt} desc nulls last,
      coalesce(${chatConversations.lastMessageAt}, ${chatConversations.createdAt}) desc
    limit 300
  `);
  const now = Date.now();
  return res.rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    name: r.kind === "direct" ? (r.other_name ?? "Conversa direta") : (r.name ?? "Conversa"),
    topic: r.topic,
    department: r.department,
    projectId: r.project_id,
    taskId: r.task_id,
    isPrivate: r.is_private,
    lastSeq: Number(r.last_seq),
    lastMessageAt: r.last_message_at ? new Date(r.last_message_at).toISOString() : null,
    archived: !!r.archived_at,
    unread: r.unread,
    mentions: r.mentions,
    notify: r.notify,
    muted: !!r.muted_until && new Date(r.muted_until).getTime() > now,
    pinned: !!r.pinned_at,
    favorite: !!r.favorite_at,
    hidden: !!r.p_archived_at,
    role: r.role,
    last:
      r.last_kind === null
        ? null
        : { body: r.last_body ?? "", authorId: r.last_author, deleted: !!r.last_deleted, kind: r.last_kind },
    other: r.other_id ? { id: r.other_id, name: r.other_name ?? "", image: r.other_image } : null,
  }));
}

/** Total de mensagens não lidas (conversas silenciadas e "nenhum aviso" não contam). */
export async function unreadTotal(s: Scope): Promise<number> {
  if (s.actor.kind !== "internal" || !can(s.actor, "chat.use")) return 0;
  const me = s.actor.userId;
  const [row] = await s.db
    .select({
      n: sql<number>`coalesce(sum((select count(*)::int from ${chatMessages} m where m.conversation_id = ${chatParticipants.conversationId}
        and m.seq > ${chatParticipants.lastReadSeq} and m.deleted_at is null and m.kind = 'text'
        and m.author_user_id is distinct from ${me})), 0)::int`,
    })
    .from(chatParticipants)
    .innerJoin(chatConversations, eq(chatConversations.id, chatParticipants.conversationId))
    .where(
      and(
        eq(chatParticipants.userId, me),
        sql`${chatParticipants.notify} <> 'none'`,
        sql`(${chatParticipants.mutedUntil} is null or ${chatParticipants.mutedUntil} < now())`,
        isNull(chatParticipants.archivedAt),
        isNull(chatConversations.archivedAt),
        linkedVisible(s),
      ),
    );
  return row?.n ?? 0;
}

/** Canais que a pessoa pode ver (para descobrir e entrar). */
export async function listChannels(s: Scope) {
  assertChat(s);
  const me = s.actor.userId;
  return s.db
    .select({
      id: chatConversations.id,
      name: chatConversations.name,
      topic: chatConversations.topic,
      department: chatConversations.department,
      isPrivate: chatConversations.isPrivate,
      members: sql<number>`(select count(*)::int from ${chatParticipants} p where p.conversation_id = ${chatConversations.id})`,
      joined: sql<boolean>`exists (select 1 from ${chatParticipants} p where p.conversation_id = ${chatConversations.id} and p.user_id = ${me})`,
    })
    .from(chatConversations)
    .where(
      and(
        eq(chatConversations.kind, "channel"),
        isNull(chatConversations.archivedAt),
        or(
          eq(chatConversations.isPrivate, false),
          sql`exists (select 1 from ${chatParticipants} p where p.conversation_id = ${chatConversations.id} and p.user_id = ${me})`,
        ),
      ),
    )
    .orderBy(asc(chatConversations.department), asc(chatConversations.name));
}

/* ------------------------------------------------------------------ */
/* Criar conversas                                                     */
/* ------------------------------------------------------------------ */

async function systemMessage(s: Scope, conversationId: string, body: string, extra: { taskId?: string } = {}) {
  const [c] = await s.db
    .update(chatConversations)
    .set({
      lastSeq: sql`${chatConversations.lastSeq} + 1`,
      lastRev: sql`${chatConversations.lastRev} + 1`,
      lastMessageAt: new Date(),
    })
    .where(eq(chatConversations.id, conversationId))
    .returning({ seq: chatConversations.lastSeq, rev: chatConversations.lastRev });
  await s.db.insert(chatMessages).values({
    organizationId: s.actor.orgId,
    conversationId,
    seq: c!.seq,
    rev: c!.rev,
    authorUserId: s.actor.userId,
    clientId: `sys-${crypto.randomUUID()}`,
    kind: "system",
    body,
    taskId: extra.taskId ?? null,
  });
}

async function addParticipantRows(s: Scope, conversationId: string, userIds: string[], role = "member") {
  if (!userIds.length) return;
  await s.db
    .insert(chatParticipants)
    .values(userIds.map((userId) => ({ organizationId: s.actor.orgId, conversationId, userId, role })))
    .onConflictDoNothing();
}

/** Abre (ou cria) a conversa direta com outra pessoa da equipe. */
export async function openDirect(s: Scope, otherUserId: string) {
  assertChat(s);
  if (otherUserId === s.actor.userId) throw new ValidationError("Escolha outra pessoa para conversar.");
  await assertChatUsers(s, [otherUserId]);
  const key = [s.actor.userId, otherUserId].sort().join(":");
  const [existing] = await s.db
    .select({ id: chatConversations.id })
    .from(chatConversations)
    .where(eq(chatConversations.directKey, key));
  if (existing) {
    // Volta a aparecer na lista de quem a tinha arquivado.
    await s.db
      .update(chatParticipants)
      .set({ archivedAt: null })
      .where(and(eq(chatParticipants.conversationId, existing.id), eq(chatParticipants.userId, s.actor.userId)));
    return { id: existing.id };
  }
  const [conv] = await s.db
    .insert(chatConversations)
    .values({ organizationId: s.actor.orgId, kind: "direct", directKey: key, createdByUserId: s.actor.userId })
    .onConflictDoNothing()
    .returning({ id: chatConversations.id });
  const id =
    conv?.id ??
    (
      await s.db
        .select({ id: chatConversations.id })
        .from(chatConversations)
        .where(eq(chatConversations.directKey, key))
    )[0]!.id;
  await addParticipantRows(s, id, [s.actor.userId, otherUserId]);
  return { id };
}

export const groupInput = z.object({
  name: z.string().trim().min(1, "Dê um nome ao grupo").max(80),
  userIds: z.array(z.string()).min(1, "Escolha ao menos uma pessoa").max(100),
});

export async function createGroup(s: Scope, raw: z.input<typeof groupInput>) {
  assertChat(s);
  const data = groupInput.parse(raw);
  const others = (await assertChatUsers(s, data.userIds)).filter((id) => id !== s.actor.userId);
  if (!others.length) throw new ValidationError("Escolha ao menos uma pessoa.", { userIds: ["Obrigatório"] });
  const [conv] = await s.db
    .insert(chatConversations)
    .values({ organizationId: s.actor.orgId, kind: "group", name: data.name, createdByUserId: s.actor.userId })
    .returning({ id: chatConversations.id });
  await addParticipantRows(s, conv!.id, [s.actor.userId], "owner");
  await addParticipantRows(s, conv!.id, others);
  await systemMessage(s, conv!.id, `<@${s.actor.userId}> criou o grupo "${data.name}".`);
  return { id: conv!.id };
}

export const channelInput = z.object({
  name: z.string().trim().min(1, "Dê um nome ao canal").max(80),
  topic: z.string().trim().max(300).optional().nullable(),
  department: z.string().trim().max(60).optional().nullable(),
  isPrivate: z.boolean().default(false),
  postingPolicy: z.enum(["all", "admins"]).default("all"),
  userIds: z.array(z.string()).max(200).default([]),
});

export async function createChannel(s: Scope, raw: z.input<typeof channelInput>) {
  assertChat(s);
  assertCan(s.actor, "chat.manage_channels");
  const data = channelInput.parse(raw);
  const members = (await assertChatUsers(s, data.userIds)).filter((id) => id !== s.actor.userId);
  const [conv] = await s.db
    .insert(chatConversations)
    .values({
      organizationId: s.actor.orgId,
      kind: "channel",
      name: data.name,
      topic: data.topic || null,
      department: data.department || null,
      isPrivate: data.isPrivate,
      postingPolicy: data.postingPolicy,
      createdByUserId: s.actor.userId,
    })
    .returning({ id: chatConversations.id });
  await addParticipantRows(s, conv!.id, [s.actor.userId], "owner");
  await addParticipantRows(s, conv!.id, members);
  await systemMessage(s, conv!.id, `<@${s.actor.userId}> criou o canal #${data.name}.`);
  await recordActivity(s, {
    action: "chat_channel_created",
    entityType: "chat_conversation",
    entityId: conv!.id,
    summary: `Canal #${data.name} criado${data.isPrivate ? " (privado)" : ""}`,
    event: false,
  });
  return { id: conv!.id };
}

/** Canais por departamento sugeridos (cria só os que ainda não existem). */
export async function createDefaultChannels(s: Scope, names: readonly string[]) {
  assertChat(s);
  assertCan(s.actor, "chat.manage_channels");
  const existing = await s.db
    .select({ name: chatConversations.name })
    .from(chatConversations)
    .where(eq(chatConversations.kind, "channel"));
  const have = new Set(existing.map((e) => e.name?.toLowerCase()));
  const created: string[] = [];
  for (const name of names) {
    if (have.has(name.toLowerCase())) continue;
    await createChannel(s, { name, department: name, isPrivate: false });
    created.push(name);
  }
  return { created };
}

async function membershipUserIds(s: Scope, membershipIds: (string | null | undefined)[]) {
  const ids = [...new Set(membershipIds.filter((x): x is string => !!x))];
  if (!ids.length) return [];
  const rows = await s.db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(inArray(memberships.id, ids), eq(memberships.status, "active")));
  return rows.map((r) => r.userId);
}

/** Abre (ou cria) a conversa do projeto, com a equipe do projeto como participante. */
export async function openProjectConversation(s: Scope, projectId: string) {
  assertChat(s);
  await assertProjectAccess(s, projectId);
  const [existing] = await s.db
    .select({ id: chatConversations.id })
    .from(chatConversations)
    .where(and(eq(chatConversations.kind, "project"), eq(chatConversations.projectId, projectId)));
  if (existing) {
    await ensureParticipant(s, await loadAccess(s, existing.id));
    return { id: existing.id };
  }
  const [project] = await s.db
    .select({ name: projects.name, ownerMembershipId: projects.ownerMembershipId })
    .from(projects)
    .where(eq(projects.id, projectId));
  const team = await s.db
    .select({ membershipId: projectMembers.membershipId })
    .from(projectMembers)
    .where(eq(projectMembers.projectId, projectId));
  const [conv] = await s.db
    .insert(chatConversations)
    .values({
      organizationId: s.actor.orgId,
      kind: "project",
      name: project!.name,
      projectId,
      createdByUserId: s.actor.userId,
    })
    .onConflictDoNothing()
    .returning({ id: chatConversations.id });
  if (!conv) return openProjectConversation(s, projectId);
  const chatUsers = new Set((await chatMembers(s)).map((m) => m.userId));
  const userIds = (await membershipUserIds(s, [project!.ownerMembershipId, ...team.map((t) => t.membershipId)])).filter(
    (id) => chatUsers.has(id) && id !== s.actor.userId,
  );
  await addParticipantRows(s, conv.id, [s.actor.userId], "owner");
  await addParticipantRows(s, conv.id, userIds);
  return { id: conv.id };
}

/** Abre (ou cria) a conversa interna de uma tarefa (responsável e colaboradores participam). */
export async function openTaskConversation(s: Scope, taskId: string) {
  assertChat(s);
  await assertTaskAccess(s, taskId);
  const [existing] = await s.db
    .select({ id: chatConversations.id })
    .from(chatConversations)
    .where(and(eq(chatConversations.kind, "task"), eq(chatConversations.taskId, taskId)));
  if (existing) {
    await ensureParticipant(s, await loadAccess(s, existing.id));
    return { id: existing.id };
  }
  const [task] = await s.db
    .select({ title: tasks.title, assignee: tasks.assigneeMembershipId, projectId: tasks.projectId })
    .from(tasks)
    .where(eq(tasks.id, taskId));
  const collaborators = await s.db
    .select({ membershipId: taskCollaborators.membershipId })
    .from(taskCollaborators)
    .where(eq(taskCollaborators.taskId, taskId));
  const [conv] = await s.db
    .insert(chatConversations)
    .values({
      organizationId: s.actor.orgId,
      kind: "task",
      name: task!.title,
      taskId,
      projectId: null,
      createdByUserId: s.actor.userId,
    })
    .onConflictDoNothing()
    .returning({ id: chatConversations.id });
  if (!conv) return openTaskConversation(s, taskId);
  const chatUsers = new Set((await chatMembers(s)).map((m) => m.userId));
  const userIds = (await membershipUserIds(s, [task!.assignee, ...collaborators.map((c) => c.membershipId)])).filter(
    (id) => chatUsers.has(id) && id !== s.actor.userId,
  );
  await addParticipantRows(s, conv.id, [s.actor.userId], "owner");
  await addParticipantRows(s, conv.id, userIds);
  return { id: conv.id };
}

/** Entrar em um canal aberto. */
export async function joinConversation(s: Scope, conversationId: string) {
  const a = await loadAccess(s, conversationId);
  await ensureParticipant(s, a);
  await s.db
    .update(chatParticipants)
    .set({ archivedAt: null })
    .where(and(eq(chatParticipants.conversationId, a.conv.id), eq(chatParticipants.userId, s.actor.userId)));
  return { id: a.conv.id };
}

/* ------------------------------------------------------------------ */
/* Administração da conversa                                           */
/* ------------------------------------------------------------------ */

export const conversationUpdateInput = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(80).optional(),
  topic: z.string().trim().max(300).optional().nullable(),
  isPrivate: z.boolean().optional(),
  postingPolicy: z.enum(["all", "admins"]).optional(),
  archived: z.boolean().optional(),
});

export async function updateConversation(s: Scope, raw: z.input<typeof conversationUpdateInput>) {
  const data = conversationUpdateInput.parse(raw);
  const a = await loadAccess(s, data.id);
  if (a.conv.kind === "direct") throw new ForbiddenError("Conversas diretas não têm configurações.");
  if (!a.moderator) throw new ForbiddenError("Só quem administra a conversa pode alterá-la.");
  if (data.isPrivate !== undefined && a.conv.kind !== "channel") {
    throw new ValidationError("Só canais podem ser abertos ou privados.");
  }
  await s.db
    .update(chatConversations)
    .set({
      ...(data.name && a.conv.kind !== "project" && a.conv.kind !== "task" ? { name: data.name } : {}),
      ...(data.topic !== undefined ? { topic: data.topic || null } : {}),
      ...(data.isPrivate !== undefined ? { isPrivate: data.isPrivate } : {}),
      ...(data.postingPolicy ? { postingPolicy: data.postingPolicy } : {}),
      ...(data.archived !== undefined ? { archivedAt: data.archived ? new Date() : null } : {}),
    })
    .where(eq(chatConversations.id, a.conv.id));
  await recordActivity(s, {
    action: data.archived ? "chat_conversation_archived" : "chat_conversation_updated",
    entityType: "chat_conversation",
    entityId: a.conv.id,
    summary: data.archived
      ? `Conversa "${a.conv.name ?? ""}" arquivada`
      : `Configurações da conversa "${a.conv.name ?? ""}" alteradas`,
    event: false,
  });
}

export async function addParticipants(s: Scope, conversationId: string, userIds: string[]) {
  const a = await loadAccess(s, conversationId);
  if (a.conv.kind === "direct") throw new ForbiddenError("Crie um grupo para conversar com mais pessoas.");
  if (!a.moderator && !(a.conv.kind === "group" && a.participant)) {
    throw new ForbiddenError("Só quem administra a conversa pode adicionar pessoas.");
  }
  const ids = (await assertChatUsers(s, userIds)).filter((id) => id !== s.actor.userId);
  const existing = await s.db
    .select({ userId: chatParticipants.userId })
    .from(chatParticipants)
    .where(eq(chatParticipants.conversationId, a.conv.id));
  const added = ids.filter((id) => !existing.some((e) => e.userId === id));
  await addParticipantRows(s, a.conv.id, added);
  if (added.length) {
    await systemMessage(s, a.conv.id, `<@${s.actor.userId}> adicionou ${added.map((id) => `<@${id}>`).join(", ")}.`);
    await recordActivity(s, {
      action: "chat_members_added",
      entityType: "chat_conversation",
      entityId: a.conv.id,
      summary: `${added.length} pessoa(s) adicionada(s) à conversa "${a.conv.name ?? ""}"`,
      event: false,
    });
  }
  return { added: added.length };
}

export async function removeParticipant(s: Scope, conversationId: string, userId: string) {
  const a = await loadAccess(s, conversationId);
  if (a.conv.kind === "direct") throw new ForbiddenError("Não é possível sair de uma conversa direta; arquive-a.");
  const self = userId === s.actor.userId;
  if (!self && !a.moderator) throw new ForbiddenError("Só quem administra a conversa pode remover pessoas.");
  await s.db
    .delete(chatParticipants)
    .where(and(eq(chatParticipants.conversationId, a.conv.id), eq(chatParticipants.userId, userId)));
  await systemMessage(
    s,
    a.conv.id,
    self ? `<@${userId}> saiu da conversa.` : `<@${s.actor.userId}> removeu <@${userId}> da conversa.`,
  );
  if (!self) {
    await recordActivity(s, {
      action: "chat_member_removed",
      entityType: "chat_conversation",
      entityId: a.conv.id,
      summary: `Pessoa removida da conversa "${a.conv.name ?? ""}"`,
      event: false,
    });
  }
}

export const participantPrefsInput = z.object({
  conversationId: z.uuid(),
  pinned: z.boolean().optional(),
  favorite: z.boolean().optional(),
  hidden: z.boolean().optional(),
  notify: z.enum(["all", "mentions", "none"]).optional(),
  /** Silenciar por N horas (0 = reativar; -1 = até reativar). */
  muteHours: z
    .number()
    .int()
    .min(-1)
    .max(24 * 365)
    .optional(),
});

export async function setParticipantPrefs(s: Scope, raw: z.input<typeof participantPrefsInput>) {
  const data = participantPrefsInput.parse(raw);
  const a = await loadAccess(s, data.conversationId);
  await ensureParticipant(s, a);
  const now = new Date();
  const mutedUntil =
    data.muteHours === undefined
      ? undefined
      : data.muteHours === 0
        ? null
        : data.muteHours === -1
          ? new Date("2999-12-31T00:00:00Z")
          : new Date(now.getTime() + data.muteHours * 3_600_000);
  await s.db
    .update(chatParticipants)
    .set({
      ...(data.pinned !== undefined ? { pinnedAt: data.pinned ? now : null } : {}),
      ...(data.favorite !== undefined ? { favoriteAt: data.favorite ? now : null } : {}),
      ...(data.hidden !== undefined ? { archivedAt: data.hidden ? now : null } : {}),
      ...(data.notify ? { notify: data.notify } : {}),
      ...(mutedUntil !== undefined ? { mutedUntil } : {}),
      updatedAt: now,
    })
    .where(and(eq(chatParticipants.conversationId, a.conv.id), eq(chatParticipants.userId, s.actor.userId)));
}

/* ------------------------------------------------------------------ */
/* Mensagens                                                           */
/* ------------------------------------------------------------------ */

export type ChatMessageDTO = {
  id: string;
  seq: number;
  rev: number;
  clientId: string;
  kind: string;
  body: string;
  authorId: string | null;
  authorName: string | null;
  authorImage: string | null;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  mentions: string[];
  refs: { type: string; id: string; label: string; path: string }[];
  replyTo: { id: string; authorName: string | null; body: string; deleted: boolean } | null;
  reactions: { emoji: string; count: number; mine: boolean; names: string[] }[];
  attachments: {
    id: string;
    name: string;
    mimeType: string;
    sizeBytes: number;
    width: number | null;
    height: number | null;
  }[];
  task: { id: string; title: string; done: boolean } | null;
};

async function serialize(s: Scope, rows: (typeof chatMessages.$inferSelect)[]): Promise<ChatMessageDTO[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const replyIds = [...new Set(rows.map((r) => r.replyToId).filter((x): x is string => !!x))];
  const taskIds = [...new Set(rows.map((r) => r.taskId).filter((x): x is string => !!x))];
  const userIds = [...new Set(rows.map((r) => r.authorUserId).filter((x): x is string => !!x))];
  const [authors, reactions, attachments, replies, linked] = await Promise.all([
    userIds.length
      ? s.db.select({ id: user.id, name: user.name, image: user.image }).from(user).where(inArray(user.id, userIds))
      : [],
    s.db
      .select({
        messageId: chatReactions.messageId,
        emoji: chatReactions.emoji,
        userId: chatReactions.userId,
        name: user.name,
      })
      .from(chatReactions)
      .innerJoin(user, eq(user.id, chatReactions.userId))
      .where(inArray(chatReactions.messageId, ids))
      .orderBy(asc(chatReactions.createdAt)),
    s.db
      .select({
        id: chatAttachments.id,
        messageId: chatAttachments.messageId,
        name: chatAttachments.name,
        mimeType: chatAttachments.mimeType,
        sizeBytes: chatAttachments.sizeBytes,
        width: chatAttachments.width,
        height: chatAttachments.height,
      })
      .from(chatAttachments)
      .where(inArray(chatAttachments.messageId, ids))
      .orderBy(asc(chatAttachments.createdAt)),
    replyIds.length
      ? s.db
          .select({ id: chatMessages.id, body: chatMessages.body, deletedAt: chatMessages.deletedAt, name: user.name })
          .from(chatMessages)
          .leftJoin(user, eq(user.id, chatMessages.authorUserId))
          .where(inArray(chatMessages.id, replyIds))
      : [],
    // Tarefas vinculadas: só aparecem se o ator pode ver a tarefa.
    taskIds.length
      ? s.db
          .select({ id: tasks.id, title: tasks.title, completedAt: tasks.completedAt })
          .from(tasks)
          .where(and(inArray(tasks.id, taskIds), taskScope(s.actor)))
      : [],
  ]);
  const authorMap = new Map(authors.map((a) => [a.id, a]));
  const replyMap = new Map(replies.map((r) => [r.id, r]));
  const taskMap = new Map(linked.map((t) => [t.id, t]));
  return rows.map((r) => {
    const author = r.authorUserId ? authorMap.get(r.authorUserId) : undefined;
    const reply = r.replyToId ? replyMap.get(r.replyToId) : undefined;
    const groups = new Map<string, { emoji: string; count: number; mine: boolean; names: string[] }>();
    for (const x of reactions.filter((x) => x.messageId === r.id)) {
      const g = groups.get(x.emoji) ?? { emoji: x.emoji, count: 0, mine: false, names: [] };
      g.count++;
      g.names.push(x.name);
      if (x.userId === s.actor.userId) g.mine = true;
      groups.set(x.emoji, g);
    }
    const task = r.taskId ? taskMap.get(r.taskId) : undefined;
    const deleted = !!r.deletedAt;
    return {
      id: r.id,
      seq: r.seq,
      rev: r.rev,
      clientId: r.clientId,
      kind: r.kind,
      body: deleted ? "" : r.body,
      authorId: r.authorUserId,
      authorName: author?.name ?? null,
      authorImage: author?.image ?? null,
      createdAt: r.createdAt.toISOString(),
      editedAt: r.editedAt?.toISOString() ?? null,
      deletedAt: r.deletedAt?.toISOString() ?? null,
      mentions: deleted ? [] : r.mentions,
      refs: deleted ? [] : r.refs,
      replyTo: reply
        ? {
            id: reply.id,
            authorName: reply.name,
            body: reply.deletedAt ? "" : reply.body.slice(0, 300),
            deleted: !!reply.deletedAt,
          }
        : null,
      reactions: deleted ? [] : [...groups.values()],
      attachments: deleted
        ? []
        : attachments
            .filter((x) => x.messageId === r.id)
            .map((x) => ({
              id: x.id,
              name: x.name,
              mimeType: x.mimeType,
              sizeBytes: x.sizeBytes,
              width: x.width,
              height: x.height,
            })),
      task: task ? { id: task.id, title: task.title, done: !!task.completedAt } : null,
    };
  });
}

/** Limite contra abuso/spam: mensagens por pessoa em janelas curtas. */
async function assertSendRate(s: Scope) {
  const [row] = await s.db
    .select({
      tenSec: sql<number>`count(*) filter (where ${chatMessages.createdAt} > now() - interval '10 seconds')::int`,
      minute: sql<number>`count(*)::int`,
    })
    .from(chatMessages)
    .where(
      and(
        eq(chatMessages.authorUserId, s.actor.userId),
        eq(chatMessages.kind, "text"),
        sql`${chatMessages.createdAt} > now() - interval '60 seconds'`,
      ),
    );
  if ((row?.tenSec ?? 0) >= 12 || (row?.minute ?? 0) >= 60) {
    throw new LimitError("Muitas mensagens em pouco tempo. Aguarde alguns segundos e tente de novo.");
  }
}

const INTERNAL_LINK_RE =
  /(?:https?:\/\/[^\s/]+)?\/w\/([a-z0-9-]+)\/(tasks|projects|studio|files|clients)\/([0-9a-f-]{36})/g;

/** Referências internas do texto, só as que o autor pode ver (com o nome do registro). */
async function resolveRefs(s: Scope, body: string) {
  const out: ChatMessageDTO["refs"] = [];
  for (const m of body.matchAll(INTERNAL_LINK_RE)) {
    const [, slug, type, id] = m;
    if (slug !== s.actor.orgSlug || out.some((r) => r.id === id) || out.length >= 8) continue;
    const path = `/w/${slug}/${type}/${id}`;
    try {
      if (type === "tasks") {
        await assertTaskAccess(s, id!);
        const [t] = await s.db.select({ title: tasks.title }).from(tasks).where(eq(tasks.id, id!));
        if (t) out.push({ type: "task", id: id!, label: t.title, path });
      } else if (type === "projects") {
        await assertProjectAccess(s, id!);
        const [p] = await s.db.select({ name: projects.name }).from(projects).where(eq(projects.id, id!));
        if (p) out.push({ type: "project", id: id!, label: p.name, path });
      } else if (type === "studio") {
        const { getDesign } = await import("./designs");
        const d = await getDesign(s, id!);
        out.push({ type: "design", id: id!, label: d.design.name, path });
      } else if (type === "files") {
        const { assertFileAccess } = await import("@/server/authz");
        await assertFileAccess(s, id!);
        const { files } = await import("@/server/db/schema");
        const [f] = await s.db.select({ name: files.name }).from(files).where(eq(files.id, id!));
        if (f) out.push({ type: "file", id: id!, label: f.name, path });
      } else if (type === "clients") {
        const { assertClientAccess } = await import("@/server/authz");
        await assertClientAccess(s, id!);
        const { clients } = await import("@/server/db/schema");
        const [c] = await s.db.select({ name: clients.name }).from(clients).where(eq(clients.id, id!));
        if (c) out.push({ type: "client", id: id!, label: c.name, path });
      }
    } catch {
      // Sem acesso (ou não existe): o link fica como texto, sem prévia.
    }
  }
  return out;
}

/** Menções válidas: quem pode ler a conversa. Em canal aberto, a pessoa mencionada entra no canal. */
async function resolveMentions(s: Scope, a: Access, body: string) {
  const ids = extractMentions(body).filter((id) => id !== s.actor.userId);
  if (!ids.length) return [];
  const participants = await s.db
    .select({ userId: chatParticipants.userId })
    .from(chatParticipants)
    .where(eq(chatParticipants.conversationId, a.conv.id));
  const inConv = new Set(participants.map((p) => p.userId));
  const valid = ids.filter((id) => inConv.has(id));
  if (a.conv.kind === "channel" && !a.conv.isPrivate) {
    const members = new Set((await chatMembers(s)).map((m) => m.userId));
    const join = ids.filter((id) => !inConv.has(id) && members.has(id));
    await addParticipantRows(s, a.conv.id, join);
    valid.push(...join);
  }
  return valid;
}

export const sendMessageInput = z.object({
  conversationId: z.uuid(),
  clientId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, "Identificador inválido"),
  body: z.string().max(CHAT_LIMITS.bodyMax, `Use no máximo ${CHAT_LIMITS.bodyMax} caracteres`).default(""),
  replyToId: z.uuid().nullable().optional(),
  attachmentIds: z.array(z.uuid()).max(CHAT_LIMITS.attachmentsPerMessage).default([]),
});

/**
 * Envia uma mensagem. Idempotente por `clientId`: reenviar (queda de rede,
 * clique duplo) devolve a mesma mensagem, sem duplicar.
 */
export async function sendMessage(s: Scope, raw: z.input<typeof sendMessageInput>) {
  const data = sendMessageInput.parse(raw);
  const body = data.body.replace(/\r\n?/g, "\n").trim();
  const a = await loadAccess(s, data.conversationId);
  const [dup] = await s.db
    .select()
    .from(chatMessages)
    .where(and(eq(chatMessages.conversationId, a.conv.id), eq(chatMessages.clientId, data.clientId)));
  if (dup) return (await serialize(s, [dup]))[0]!;
  if (!body && !data.attachmentIds.length) throw new ValidationError("Escreva uma mensagem ou anexe um arquivo.");
  if (!a.canPost) {
    throw new ForbiddenError(
      a.conv.archivedAt ? "Esta conversa foi arquivada." : "Só administradores podem escrever nesta conversa.",
    );
  }
  await ensureParticipant(s, a);
  await assertSendRate(s);
  if (data.replyToId) {
    const [target] = await s.db
      .select({ id: chatMessages.id })
      .from(chatMessages)
      .where(and(eq(chatMessages.id, data.replyToId), eq(chatMessages.conversationId, a.conv.id)));
    if (!target) throw new ValidationError("A mensagem respondida não está nesta conversa.");
  }
  const mentions = await resolveMentions(s, a, body);
  const refs = await resolveRefs(s, body);

  const [c] = await s.db
    .update(chatConversations)
    .set({
      lastSeq: sql`${chatConversations.lastSeq} + 1`,
      lastRev: sql`${chatConversations.lastRev} + 1`,
      lastMessageAt: new Date(),
    })
    .where(eq(chatConversations.id, a.conv.id))
    .returning({ seq: chatConversations.lastSeq, rev: chatConversations.lastRev });
  const [msg] = await s.db
    .insert(chatMessages)
    .values({
      organizationId: s.actor.orgId,
      conversationId: a.conv.id,
      seq: c!.seq,
      rev: c!.rev,
      authorUserId: s.actor.userId,
      clientId: data.clientId,
      body,
      replyToId: data.replyToId ?? null,
      mentions,
      refs,
    })
    .onConflictDoNothing()
    .returning();
  if (!msg) {
    // Envio simultâneo com o mesmo clientId: devolve o que ficou gravado.
    const [again] = await s.db
      .select()
      .from(chatMessages)
      .where(and(eq(chatMessages.conversationId, a.conv.id), eq(chatMessages.clientId, data.clientId)));
    return (await serialize(s, [again!]))[0]!;
  }
  if (data.attachmentIds.length) {
    const linked = await s.db
      .update(chatAttachments)
      .set({ messageId: msg.id })
      .where(
        and(
          inArray(chatAttachments.id, data.attachmentIds),
          eq(chatAttachments.conversationId, a.conv.id),
          eq(chatAttachments.uploadedByUserId, s.actor.userId),
          isNull(chatAttachments.messageId),
        ),
      )
      .returning({ id: chatAttachments.id });
    if (linked.length !== data.attachmentIds.length) {
      throw new ValidationError("Um dos anexos não está disponível. Envie o arquivo de novo.");
    }
  }
  // Quem escreve já leu até aqui; outras conversas de quem escreve voltam a aparecer.
  await s.db
    .update(chatParticipants)
    .set({ lastReadSeq: msg.seq, lastReadAt: new Date(), typingUntil: null })
    .where(and(eq(chatParticipants.conversationId, a.conv.id), eq(chatParticipants.userId, s.actor.userId)));
  await s.db
    .update(chatParticipants)
    .set({ archivedAt: null })
    .where(and(eq(chatParticipants.conversationId, a.conv.id), sql`${chatParticipants.archivedAt} is not null`));
  await notifyMessage(s, a, msg, mentions);
  return (await serialize(s, [msg]))[0]!;
}

/** Avisos: mensagens diretas e menções (um aviso por conversa, atualizado; respeita silêncio e preferências). */
async function notifyMessage(s: Scope, a: Access, msg: typeof chatMessages.$inferSelect, mentions: string[]) {
  const participants = await s.db
    .select({
      userId: chatParticipants.userId,
      notify: chatParticipants.notify,
      mutedUntil: chatParticipants.mutedUntil,
    })
    .from(chatParticipants)
    .where(eq(chatParticipants.conversationId, a.conv.id));
  const now = Date.now();
  const targets = participants.filter((p) => {
    if (p.userId === s.actor.userId) return false;
    if (p.notify === "none") return false;
    if (p.mutedUntil && p.mutedUntil.getTime() > now) return false;
    const mentioned = mentions.includes(p.userId);
    if (a.conv.kind === "direct") return true;
    return mentioned;
  });
  if (!targets.length) return;
  const prefs = await preferencesFor(
    s.db,
    s.actor.orgId,
    targets.map((t) => t.userId),
  );
  const names = new Map((await chatMembers(s)).map((m) => [m.userId, m.name]));
  const authorName = names.get(s.actor.userId) ?? s.actor.name;
  const text = excerpt(msg.body, (id) => names.get(id)) || "Enviou um anexo";
  const link = `/w/${s.actor.orgSlug}/chat/${a.conv.id}`;
  for (const t of targets) {
    if (!prefEnabled(prefs.get(t.userId), "inApp", "chat")) continue;
    const direct = a.conv.kind === "direct";
    const title = direct
      ? `Nova mensagem de ${authorName}`
      : `${authorName} mencionou você em ${a.conv.kind === "channel" ? "#" : ""}${a.conv.name ?? "uma conversa"}`;
    const type = direct ? "chat.direct" : "chat.mention";
    // Um aviso não lido por conversa: atualiza em vez de empilhar.
    const updated = await s.db
      .update(notifications)
      .set({ title, body: text, type, createdAt: new Date(), link })
      .where(
        and(
          eq(notifications.userId, t.userId),
          eq(notifications.entityType, "chat_conversation"),
          eq(notifications.entityId, a.conv.id),
          isNull(notifications.readAt),
        ),
      )
      .returning({ id: notifications.id });
    if (!updated.length) {
      await s.db.insert(notifications).values({
        organizationId: s.actor.orgId,
        userId: t.userId,
        type,
        title,
        body: text,
        link,
        entityType: "chat_conversation",
        entityId: a.conv.id,
      });
    }
  }
}

async function loadMessage(s: Scope, messageId: string) {
  if (!uuid.safeParse(messageId).success) throw new NotFoundError("Mensagem não encontrada.");
  const [msg] = await s.db.select().from(chatMessages).where(eq(chatMessages.id, messageId));
  if (!msg) throw new NotFoundError("Mensagem não encontrada.");
  const a = await loadAccess(s, msg.conversationId);
  return { msg, a };
}

async function bumpRev(s: Scope, conversationId: string) {
  const [c] = await s.db
    .update(chatConversations)
    .set({ lastRev: sql`${chatConversations.lastRev} + 1` })
    .where(eq(chatConversations.id, conversationId))
    .returning({ rev: chatConversations.lastRev });
  return c!.rev;
}

export const editMessageInput = z.object({
  messageId: z.uuid(),
  body: z.string().max(CHAT_LIMITS.bodyMax),
});

/** Regra de edição: só quem escreveu, e a mensagem fica marcada como "editada". */
export async function editMessage(s: Scope, raw: z.input<typeof editMessageInput>) {
  const data = editMessageInput.parse(raw);
  const { msg, a } = await loadMessage(s, data.messageId);
  if (msg.authorUserId !== s.actor.userId || msg.kind !== "text") {
    throw new ForbiddenError("Só quem escreveu pode editar a mensagem.");
  }
  if (msg.deletedAt) throw new ValidationError("A mensagem foi apagada.");
  const body = data.body.replace(/\r\n?/g, "\n").trim();
  const [{ n } = { n: 0 }] = await s.db
    .select({ n: sql<number>`count(*)::int` })
    .from(chatAttachments)
    .where(eq(chatAttachments.messageId, msg.id));
  if (!body && !n) throw new ValidationError("A mensagem não pode ficar vazia. Para remover, apague-a.");
  const mentions = await resolveMentions(s, a, body);
  const refs = await resolveRefs(s, body);
  const rev = await bumpRev(s, a.conv.id);
  const [updated] = await s.db
    .update(chatMessages)
    .set({ body, mentions, refs, editedAt: new Date(), rev })
    .where(eq(chatMessages.id, msg.id))
    .returning();
  return (await serialize(s, [updated!]))[0]!;
}

/**
 * Regra de exclusão: quem escreveu apaga a própria mensagem; quem administra
 * o canal/grupo pode apagar a de outras pessoas (fica registrado na auditoria).
 * A mensagem vira "mensagem apagada" (mantém a ordem da conversa) e os anexos
 * saem do armazenamento.
 */
export async function deleteMessage(s: Scope, messageId: string) {
  const { msg, a } = await loadMessage(s, messageId);
  const own = msg.authorUserId === s.actor.userId;
  if (msg.kind !== "text") throw new ForbiddenError("Avisos automáticos não podem ser apagados.");
  if (!own && !a.moderator) throw new ForbiddenError("Você só pode apagar as suas mensagens.");
  if (msg.deletedAt) return;
  const files = await s.db
    .delete(chatAttachments)
    .where(eq(chatAttachments.messageId, msg.id))
    .returning({ key: chatAttachments.storageKey });
  await s.db.delete(chatReactions).where(eq(chatReactions.messageId, msg.id));
  const rev = await bumpRev(s, a.conv.id);
  await s.db
    .update(chatMessages)
    .set({ body: "", mentions: [], refs: [], deletedAt: new Date(), deletedByUserId: s.actor.userId, rev })
    .where(eq(chatMessages.id, msg.id));
  if (files.length) {
    // Os objetos só saem do armazenamento depois do commit (evento processado em seguida).
    await s.db.insert(domainEvents).values({
      organizationId: s.actor.orgId,
      type: "storage.purge",
      entityType: "storage",
      payload: { keys: files.map((f) => f.key) },
    });
  }
  if (!own) {
    await recordActivity(s, {
      action: "chat_message_moderated",
      entityType: "chat_conversation",
      entityId: a.conv.id,
      summary: `Mensagem de outra pessoa apagada na conversa "${a.conv.name ?? ""}"`,
      metadata: { messageId: msg.id, authorUserId: msg.authorUserId },
      event: false,
    });
  }
}

export const reactionInput = z.object({
  messageId: z.uuid(),
  emoji: z.enum(CHAT_REACTIONS),
});

export async function toggleReaction(s: Scope, raw: z.input<typeof reactionInput>) {
  const data = reactionInput.parse(raw);
  const { msg, a } = await loadMessage(s, data.messageId);
  if (msg.deletedAt) throw new ValidationError("A mensagem foi apagada.");
  await ensureParticipant(s, a);
  const removed = await s.db
    .delete(chatReactions)
    .where(
      and(
        eq(chatReactions.messageId, msg.id),
        eq(chatReactions.userId, s.actor.userId),
        eq(chatReactions.emoji, data.emoji),
      ),
    )
    .returning({ emoji: chatReactions.emoji });
  if (!removed.length) {
    await s.db
      .insert(chatReactions)
      .values({ organizationId: s.actor.orgId, messageId: msg.id, userId: s.actor.userId, emoji: data.emoji })
      .onConflictDoNothing();
  }
  const rev = await bumpRev(s, a.conv.id);
  await s.db.update(chatMessages).set({ rev }).where(eq(chatMessages.id, msg.id));
  return { added: !removed.length };
}

/** Marca como lida até `seq` e encerra o aviso desta conversa. */
export async function markRead(s: Scope, conversationId: string, seq: number) {
  const a = await loadAccess(s, conversationId);
  if (!a.participant) return;
  const upTo = Math.max(0, Math.min(Math.floor(seq), a.conv.lastSeq));
  await s.db
    .update(chatParticipants)
    .set({ lastReadSeq: sql`greatest(${chatParticipants.lastReadSeq}, ${upTo})`, lastReadAt: new Date() })
    .where(and(eq(chatParticipants.conversationId, a.conv.id), eq(chatParticipants.userId, s.actor.userId)));
  if (upTo >= a.conv.lastSeq) {
    await s.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notifications.userId, s.actor.userId),
          eq(notifications.entityType, "chat_conversation"),
          eq(notifications.entityId, a.conv.id),
          isNull(notifications.readAt),
        ),
      );
  }
}

/** Digitação: vale por alguns segundos (o navegador renova enquanto a pessoa digita). */
export async function setTyping(s: Scope, conversationId: string, typing: boolean) {
  const a = await loadAccess(s, conversationId);
  if (!a.participant || !a.canPost) return;
  await s.db
    .update(chatParticipants)
    .set({ typingUntil: typing ? sql`now() + interval '6 seconds'` : null })
    .where(and(eq(chatParticipants.conversationId, a.conv.id), eq(chatParticipants.userId, s.actor.userId)));
}

/* ------------------------------------------------------------------ */
/* Sincronização e histórico                                           */
/* ------------------------------------------------------------------ */

export type ConversationView = {
  id: string;
  kind: Conversation["kind"];
  name: string;
  topic: string | null;
  department: string | null;
  projectId: string | null;
  taskId: string | null;
  isPrivate: boolean;
  postingPolicy: string;
  archived: boolean;
  lastSeq: number;
  lastRev: number;
  joined: boolean;
  canPost: boolean;
  moderator: boolean;
  myLastReadSeq: number;
  participants: {
    userId: string;
    name: string;
    image: string | null;
    role: string;
    lastReadSeq: number;
    typing: boolean;
  }[];
};

async function view(s: Scope, a: Access): Promise<ConversationView> {
  const people = await s.db
    .select({
      userId: chatParticipants.userId,
      name: user.name,
      image: user.image,
      role: chatParticipants.role,
      lastReadSeq: chatParticipants.lastReadSeq,
      typing: sql<boolean>`coalesce(${chatParticipants.typingUntil} > now(), false)`,
    })
    .from(chatParticipants)
    .innerJoin(user, eq(user.id, chatParticipants.userId))
    .where(eq(chatParticipants.conversationId, a.conv.id))
    .orderBy(asc(user.name))
    .limit(500);
  const other = a.conv.kind === "direct" ? people.find((p) => p.userId !== s.actor.userId) : undefined;
  return {
    id: a.conv.id,
    kind: a.conv.kind,
    name: a.conv.kind === "direct" ? (other?.name ?? "Conversa direta") : (a.conv.name ?? "Conversa"),
    topic: a.conv.topic,
    department: a.conv.department,
    projectId: a.conv.projectId,
    taskId: a.conv.taskId,
    isPrivate: a.conv.isPrivate,
    postingPolicy: a.conv.postingPolicy,
    archived: !!a.conv.archivedAt,
    lastSeq: a.conv.lastSeq,
    lastRev: a.conv.lastRev,
    joined: !!a.participant,
    canPost: a.canPost,
    moderator: a.moderator,
    myLastReadSeq: a.participant?.lastReadSeq ?? 0,
    participants: people.map((p) => ({ ...p, typing: p.typing && p.userId !== s.actor.userId })),
  };
}

/**
 * Sincroniza a conversa aberta. Sem `afterRev`: últimas mensagens (com
 * `hasMore` para carregar o histórico). Com `afterRev`: tudo que mudou depois
 * (mensagens novas, editadas, apagadas e reações), em ordem de revisão.
 */
export async function syncConversation(s: Scope, conversationId: string, afterRev: number) {
  const a = await loadAccess(s, conversationId);
  // Ao abrir, a pessoa entra em canais abertos/projetos/tarefas (passa a contar não lidas).
  if (!a.participant && !(a.conv.kind === "channel" && a.conv.isPrivate)) {
    if (a.conv.kind !== "direct" && a.conv.kind !== "group") await ensureParticipant(s, a);
  }
  const conversation = await view(s, a);
  if (afterRev > 0) {
    const rows = await s.db
      .select()
      .from(chatMessages)
      .where(and(eq(chatMessages.conversationId, a.conv.id), gt(chatMessages.rev, afterRev)))
      .orderBy(asc(chatMessages.rev))
      .limit(500);
    return { conversation, messages: await serialize(s, rows), hasMore: null as boolean | null };
  }
  const rows = await s.db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.conversationId, a.conv.id))
    .orderBy(desc(chatMessages.seq))
    .limit(CHAT_LIMITS.historyPage + 1);
  const hasMore = rows.length > CHAT_LIMITS.historyPage;
  const page = rows.slice(0, CHAT_LIMITS.historyPage).reverse();
  return { conversation, messages: await serialize(s, page), hasMore };
}

/** Histórico anterior a `beforeSeq` (carregamento progressivo). */
export async function olderMessages(
  s: Scope,
  conversationId: string,
  beforeSeq: number,
  limit: number = CHAT_LIMITS.historyPage,
) {
  const a = await loadAccess(s, conversationId);
  const size = Math.min(Math.max(limit, 1), 200);
  const rows = await s.db
    .select()
    .from(chatMessages)
    .where(and(eq(chatMessages.conversationId, a.conv.id), lt(chatMessages.seq, beforeSeq)))
    .orderBy(desc(chatMessages.seq))
    .limit(size + 1);
  return { messages: await serialize(s, rows.slice(0, size).reverse()), hasMore: rows.length > size };
}

/* ------------------------------------------------------------------ */
/* Busca                                                               */
/* ------------------------------------------------------------------ */

const ESC = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** Conversas que o ator pode ler (participante, ou canal aberto). */
function readableBy(s: Scope): SQL {
  const me = s.actor.userId;
  return sql`(
    exists (select 1 from ${chatParticipants} p where p.conversation_id = ${chatConversations.id} and p.user_id = ${me})
    or (${chatConversations.kind} = 'channel' and ${chatConversations.isPrivate} = false)
  ) and ${linkedVisible(s)}`;
}

export async function searchMessages(
  s: Scope,
  rawQuery: string,
  opts: { conversationId?: string; limit?: number } = {},
) {
  assertChat(s);
  const q = rawQuery.trim().slice(0, 200);
  if (q.length < 2) return [];
  const limit = Math.min(opts.limit ?? 40, 100);
  const rows = await s.db
    .select({
      id: chatMessages.id,
      seq: chatMessages.seq,
      body: chatMessages.body,
      createdAt: chatMessages.createdAt,
      authorName: user.name,
      conversationId: chatConversations.id,
      conversationKind: chatConversations.kind,
      conversationName: chatConversations.name,
    })
    .from(chatMessages)
    .innerJoin(chatConversations, eq(chatConversations.id, chatMessages.conversationId))
    .leftJoin(user, eq(user.id, chatMessages.authorUserId))
    .where(
      and(
        readableBy(s),
        isNull(chatMessages.deletedAt),
        eq(chatMessages.kind, "text"),
        sql`${chatMessages.body} ilike ${ESC(q)}`,
        opts.conversationId ? eq(chatMessages.conversationId, opts.conversationId) : undefined,
      ),
    )
    .orderBy(desc(chatMessages.createdAt))
    .limit(limit);
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
}

/* ------------------------------------------------------------------ */
/* Presença                                                            */
/* ------------------------------------------------------------------ */

/** "Visto por último": registrado no máximo a cada 45 s enquanto o chat está aberto. */
export async function touchPresence(s: Scope) {
  if (s.actor.kind !== "internal") return;
  await s.db
    .insert(chatUserStatus)
    .values({ organizationId: s.actor.orgId, userId: s.actor.userId, lastSeenAt: new Date() })
    .onConflictDoUpdate({
      target: [chatUserStatus.organizationId, chatUserStatus.userId],
      set: { lastSeenAt: new Date() },
      setWhere: sql`${chatUserStatus.lastSeenAt} is null or ${chatUserStatus.lastSeenAt} < now() - interval '45 seconds'`,
    });
}

export const availabilityInput = z.object({
  availability: z.enum(["available", "busy", "away"]),
  showLastSeen: z.boolean(),
});

export async function setAvailability(s: Scope, raw: z.input<typeof availabilityInput>) {
  assertChat(s);
  const data = availabilityInput.parse(raw);
  await s.db
    .insert(chatUserStatus)
    .values({ organizationId: s.actor.orgId, userId: s.actor.userId, ...data, lastSeenAt: new Date() })
    .onConflictDoUpdate({ target: [chatUserStatus.organizationId, chatUserStatus.userId], set: data });
}

export async function myStatus(s: Scope) {
  assertChat(s);
  const [row] = await s.db
    .select({ availability: chatUserStatus.availability, showLastSeen: chatUserStatus.showLastSeen })
    .from(chatUserStatus)
    .where(eq(chatUserStatus.userId, s.actor.userId));
  return row ?? { availability: "available", showLastSeen: true };
}

/**
 * Presença verdadeira: "ativo agora" só com sinal do chat nos últimos 2 min;
 * "visto por último" só se a pessoa permitir. Nunca inventamos atividade.
 */
export async function presenceOf(s: Scope, userIds: string[]) {
  assertChat(s);
  const ids = [...new Set(userIds)].slice(0, 200);
  if (!ids.length) return [];
  const rows = await s.db
    .select({
      userId: chatUserStatus.userId,
      availability: chatUserStatus.availability,
      showLastSeen: chatUserStatus.showLastSeen,
      lastSeenAt: chatUserStatus.lastSeenAt,
    })
    .from(chatUserStatus)
    .where(inArray(chatUserStatus.userId, ids));
  const now = Date.now();
  return rows.map((r) => {
    const active = !!r.lastSeenAt && now - r.lastSeenAt.getTime() < 120_000;
    return {
      userId: r.userId,
      availability: r.availability,
      active,
      lastSeenAt: r.showLastSeen && r.lastSeenAt ? r.lastSeenAt.toISOString() : null,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Projeto: mensagens vinculadas                                       */
/* ------------------------------------------------------------------ */

/** Mensagens que citam o projeto (ou tarefas dele) em conversas que o ator pode ler. */
export async function projectMentions(s: Scope, projectId: string, limit = 30) {
  assertChat(s);
  await assertProjectAccess(s, projectId);
  const rows = await s.db
    .select({
      id: chatMessages.id,
      seq: chatMessages.seq,
      body: chatMessages.body,
      createdAt: chatMessages.createdAt,
      authorName: user.name,
      conversationId: chatConversations.id,
      conversationKind: chatConversations.kind,
      conversationName: chatConversations.name,
    })
    .from(chatMessages)
    .innerJoin(chatConversations, eq(chatConversations.id, chatMessages.conversationId))
    .leftJoin(user, eq(user.id, chatMessages.authorUserId))
    .where(
      and(
        readableBy(s),
        isNull(chatMessages.deletedAt),
        sql`(${chatConversations.kind} <> 'project' or ${chatConversations.projectId} is distinct from ${projectId})`,
        or(
          sql`${chatMessages.refs} @> ${JSON.stringify([{ type: "project", id: projectId }])}::jsonb`,
          sql`exists (select 1 from ${tasks} t where t.id = ${chatMessages.taskId} and t.project_id = ${projectId})`,
          sql`exists (select 1 from jsonb_array_elements(${chatMessages.refs}) r join ${tasks} t on t.id::text = r->>'id' where r->>'type' = 'task' and t.project_id = ${projectId})`,
        ),
      ),
    )
    .orderBy(desc(chatMessages.createdAt))
    .limit(limit);
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
}

/* ------------------------------------------------------------------ */
/* Para a IA: conversa como texto (só o que o ator pode ler)            */
/* ------------------------------------------------------------------ */

export async function conversationTranscript(
  s: Scope,
  conversationId: string,
  opts: { unreadOnly?: boolean; maxChars?: number } = {},
) {
  const a = await loadAccess(s, conversationId);
  const since = opts.unreadOnly ? (a.participant?.lastReadSeq ?? 0) : 0;
  const rows = await s.db
    .select({ body: chatMessages.body, createdAt: chatMessages.createdAt, name: user.name, kind: chatMessages.kind })
    .from(chatMessages)
    .leftJoin(user, eq(user.id, chatMessages.authorUserId))
    .where(
      and(
        eq(chatMessages.conversationId, a.conv.id),
        isNull(chatMessages.deletedAt),
        gt(chatMessages.seq, since),
        opts.unreadOnly ? sql`${chatMessages.authorUserId} is distinct from ${s.actor.userId}` : undefined,
      ),
    )
    .orderBy(desc(chatMessages.seq))
    .limit(400);
  const names = new Map((await chatMembers(s)).map((m) => [m.userId, m.name]));
  const lines = rows
    .reverse()
    .filter((r) => r.body.trim())
    .map((r) => {
      const when = r.createdAt.toLocaleString("pt-BR", {
        timeZone: s.actor.settings.locale.timezone,
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
      const text = excerpt(r.body, (id) => names.get(id), 2000);
      return r.kind === "system" ? `[${when}] (aviso) ${text}` : `[${when}] ${r.name ?? "Alguém"}: ${text}`;
    });
  // Mantém as mensagens mais recentes dentro do limite.
  const max = opts.maxChars ?? 18_000;
  let total = 0;
  const kept: string[] = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    total += lines[i]!.length + 1;
    if (total > max) break;
    kept.unshift(lines[i]!);
  }
  return { conversation: a.conv, transcript: kept.join("\n"), messages: kept.length };
}

/** Mensagens relacionadas a uma pergunta, em todas as conversas que o ator pode ler. */
export async function searchTranscript(s: Scope, question: string, maxChars = 9000) {
  assertChat(s);
  const words = [...new Set(question.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? [])].slice(0, 8);
  if (!words.length) return "";
  const rows = await s.db
    .select({
      body: chatMessages.body,
      createdAt: chatMessages.createdAt,
      name: user.name,
      conv: chatConversations.name,
      kind: chatConversations.kind,
    })
    .from(chatMessages)
    .innerJoin(chatConversations, eq(chatConversations.id, chatMessages.conversationId))
    .leftJoin(user, eq(user.id, chatMessages.authorUserId))
    .where(
      and(
        readableBy(s),
        isNull(chatMessages.deletedAt),
        eq(chatMessages.kind, "text"),
        or(...words.map((w) => sql`${chatMessages.body} ilike ${ESC(w)}`)),
      ),
    )
    .orderBy(desc(chatMessages.createdAt))
    .limit(80);
  const names = new Map((await chatMembers(s)).map((m) => [m.userId, m.name]));
  let out = "";
  for (const r of rows) {
    const line = `[${r.createdAt.toISOString().slice(0, 10)} · ${r.kind === "direct" ? "direta" : (r.conv ?? "conversa")}] ${r.name ?? "Alguém"}: ${excerpt(r.body, (id) => names.get(id), 600)}\n`;
    if (out.length + line.length > maxChars) break;
    out += line;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Contexto de uma mensagem (para criar tarefa)                        */
/* ------------------------------------------------------------------ */

export async function messageForTask(s: Scope, messageId: string) {
  const { msg, a } = await loadMessage(s, messageId);
  if (msg.deletedAt) throw new ValidationError("A mensagem foi apagada.");
  return { msg, conv: a.conv };
}

/** Vincula uma tarefa à mensagem e avisa na conversa (quem pode ver a tarefa vê o vínculo). */
export async function linkMessageTask(s: Scope, messageId: string, taskId: string, created: boolean) {
  const { msg, a } = await loadMessage(s, messageId);
  await assertTaskAccess(s, taskId);
  const [t] = await s.db.select({ title: tasks.title }).from(tasks).where(eq(tasks.id, taskId));
  const rev = await bumpRev(s, a.conv.id);
  await s.db.update(chatMessages).set({ taskId, rev }).where(eq(chatMessages.id, msg.id));
  await systemMessage(
    s,
    a.conv.id,
    `<@${s.actor.userId}> ${created ? "criou a tarefa" : "vinculou a tarefa"} /w/${s.actor.orgSlug}/tasks/${taskId} a partir de uma mensagem.`,
    { taskId },
  );
  return { title: t?.title ?? "" };
}

/** Tarefas ligadas à conversa (a da própria conversa e as vinculadas a mensagens). */
export async function conversationTasks(s: Scope, conversationId: string) {
  const a = await loadAccess(s, conversationId);
  const linked = await s.db
    .selectDistinct({ taskId: chatMessages.taskId })
    .from(chatMessages)
    .where(and(eq(chatMessages.conversationId, a.conv.id), sql`${chatMessages.taskId} is not null`));
  const ids = [...new Set([a.conv.taskId, ...linked.map((l) => l.taskId)].filter((x): x is string => !!x))];
  if (!ids.length) return [];
  return s.db
    .select({ id: tasks.id, title: tasks.title, dueDate: tasks.dueDate, completedAt: tasks.completedAt })
    .from(tasks)
    .where(and(inArray(tasks.id, ids), taskScope(s.actor)))
    .orderBy(asc(tasks.completedAt), asc(tasks.dueDate));
}

/** Anexos compartilhados na conversa (galeria). */
export async function conversationAttachments(s: Scope, conversationId: string) {
  const a = await loadAccess(s, conversationId);
  return s.db
    .select({
      id: chatAttachments.id,
      name: chatAttachments.name,
      mimeType: chatAttachments.mimeType,
      sizeBytes: chatAttachments.sizeBytes,
      createdAt: chatAttachments.createdAt,
      authorName: user.name,
    })
    .from(chatAttachments)
    .innerJoin(chatMessages, eq(chatMessages.id, chatAttachments.messageId))
    .leftJoin(user, eq(user.id, chatAttachments.uploadedByUserId))
    .where(and(eq(chatAttachments.conversationId, a.conv.id), isNull(chatMessages.deletedAt)))
    .orderBy(desc(chatAttachments.createdAt))
    .limit(200);
}

/** Avisos de chat recentes para o navegador (diretas e menções não lidas). */
export async function recentAlerts(s: Scope, since: Date) {
  if (s.actor.kind !== "internal" || !can(s.actor, "chat.use")) return [];
  return s.db
    .select({
      id: notifications.id,
      title: notifications.title,
      body: notifications.body,
      link: notifications.link,
      conversationId: notifications.entityId,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, s.actor.userId),
        eq(notifications.entityType, "chat_conversation"),
        isNull(notifications.readAt),
        gt(notifications.createdAt, since),
        lte(notifications.createdAt, new Date()),
      ),
    )
    .orderBy(desc(notifications.createdAt))
    .limit(5);
}

/* ------------------------------------------------------------------ */
/* Caixa de entrada dos avisos (janela flutuante, som, sistema)        */
/* ------------------------------------------------------------------ */

export type InboxMessage = {
  id: string;
  conversationId: string;
  seq: number;
  conversation: { kind: Conversation["kind"]; name: string };
  author: { id: string | null; name: string; image: string | null };
  excerpt: string;
  mention: boolean;
  attachments: number;
  createdAt: string;
  /** Idade da mensagem pelo relógio do servidor (o do navegador pode estar errado). */
  ageMs: number;
};

export type InboxWatch = { conversationId: string; lastReadSeq: number; gone: boolean };

/** Margem para mensagens gravadas em transações que começaram antes da busca anterior. */
const INBOX_OVERLAP_MS = 20_000;
/** Depois de muito tempo sem conexão, avisos antigos não voltam (o contador continua certo). */
const INBOX_MAX_AGE_MS = 15 * 60_000;

/**
 * Mensagens novas PARA a pessoa desde o último cursor: só conversas em que ela
 * participa e que ainda pode ver, sem as próprias mensagens, sem avisos do
 * sistema, sem apagadas, já lidas, silenciadas ou com "nenhum aviso" (e, com
 * "só menções", apenas as que a mencionam). A deduplicação final (por id) é
 * do navegador; o cursor é o relógio do servidor.
 */
export async function chatInbox(
  s: Scope,
  opts: { since: number; after: number | null; watch: string[] },
): Promise<{ now: number; messages: InboxMessage[]; watch: InboxWatch[] }> {
  assertChat(s);
  const me = s.actor.userId;
  const nowMs = Date.now();
  const from = new Date(
    Math.max(opts.since, opts.after ? opts.after - INBOX_OVERLAP_MS : opts.since, nowMs - INBOX_MAX_AGE_MS),
  );
  const res = await s.db.execute<{
    id: string;
    conversation_id: string;
    seq: string;
    body: string;
    mentions: string[] | null;
    created_at: string;
    age_ms: number;
    conv_kind: Conversation["kind"];
    conv_name: string | null;
    author_id: string | null;
    author_name: string | null;
    author_image: string | null;
    attachments: number;
  }>(sql`
    select m.id, m.conversation_id, m.seq, m.body, m.mentions, m.created_at,
      (extract(epoch from (now() - m.created_at)) * 1000)::int as age_ms,
      ${chatConversations.kind} as conv_kind, ${chatConversations.name} as conv_name,
      u.id as author_id, u.name as author_name, u.image as author_image,
      (select count(*)::int from ${chatAttachments} a where a.message_id = m.id) as attachments
    from ${chatParticipants}
    join ${chatConversations} on ${chatConversations.id} = ${chatParticipants.conversationId}
    join ${chatMessages} m on m.conversation_id = ${chatParticipants.conversationId}
      and m.seq > ${chatParticipants.lastReadSeq}
    left join ${user} u on u.id = m.author_user_id
    where ${chatParticipants.userId} = ${me}
      and ${chatConversations.lastMessageAt} > ${from}
      and ${chatConversations.archivedAt} is null
      and ${chatParticipants.notify} <> 'none'
      and (${chatParticipants.mutedUntil} is null or ${chatParticipants.mutedUntil} < now())
      and m.created_at > ${from}
      and m.kind = 'text' and m.deleted_at is null
      and m.author_user_id is distinct from ${me}
      and (${chatParticipants.notify} = 'all' or ${me} = any(m.mentions))
      and ${linkedVisible(s)}
    order by m.created_at asc, m.seq asc
    limit 60
  `);

  const mentionIds = [...new Set(res.rows.flatMap((r) => extractMentions(r.body)))];
  const names = new Map<string, string>();
  if (mentionIds.length) {
    const rows = await s.db
      .select({ id: user.id, name: user.name })
      .from(user)
      .where(inArray(user.id, mentionIds.slice(0, 200)));
    for (const r of rows) names.set(r.id, r.name);
  }
  const messages = res.rows.map<InboxMessage>((r) => ({
    id: r.id,
    conversationId: r.conversation_id,
    seq: Number(r.seq),
    conversation: {
      kind: r.conv_kind,
      // Direta: o nome da conversa é quem escreveu (a outra pessoa).
      name: r.conv_kind === "direct" ? (r.author_name ?? "Conversa direta") : (r.conv_name ?? "Conversa"),
    },
    author: { id: r.author_id, name: r.author_name ?? "Pessoa removida", image: r.author_image },
    excerpt: excerpt(r.body, (id) => names.get(id), 140),
    mention: (r.mentions ?? []).includes(me),
    attachments: r.attachments,
    createdAt: new Date(r.created_at).toISOString(),
    ageMs: Math.max(0, r.age_ms),
  }));

  // Janelas abertas no navegador: lidas em outro lugar (outra aba/aparelho) ou sem acesso somem.
  const ids = [...new Set(opts.watch.filter((id) => uuid.safeParse(id).success))].slice(0, 20);
  let watch: InboxWatch[] = [];
  if (ids.length) {
    const rows = await s.db
      .select({ conversationId: chatParticipants.conversationId, lastReadSeq: chatParticipants.lastReadSeq })
      .from(chatParticipants)
      .innerJoin(chatConversations, eq(chatConversations.id, chatParticipants.conversationId))
      .where(
        and(
          eq(chatParticipants.userId, me),
          inArray(chatParticipants.conversationId, ids),
          sql`${chatParticipants.notify} <> 'none'`,
          sql`(${chatParticipants.mutedUntil} is null or ${chatParticipants.mutedUntil} < now())`,
          linkedVisible(s),
        ),
      );
    const byId = new Map(rows.map((r) => [r.conversationId, Number(r.lastReadSeq)]));
    watch = ids.map((id) => ({ conversationId: id, lastReadSeq: byId.get(id) ?? 0, gone: !byId.has(id) }));
  }
  return { now: nowMs, messages, watch };
}
