import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, id, timestamps, tstz } from "./_helpers";
import { user } from "./auth";
import { organizations } from "./core";
import { projects } from "./projects";
import { tasks } from "./tasks";

/*
 * Chat da Equipe. Conversas internas (nunca visíveis a usuários de cliente).
 *
 * Ordem e sincronização: cada conversa tem dois contadores monotônicos.
 *  - `last_seq` numera as mensagens (ordem estável, mesmo com envios simultâneos);
 *  - `last_rev` aumenta a cada mudança (nova mensagem, edição, exclusão, reação).
 * O navegador guarda o último `rev` visto e pede só o que mudou depois dele;
 * `client_id` (gerado no navegador) impede mensagens duplicadas em reenvios.
 */

export const chatConversationKind = pgEnum("chat_conversation_kind", ["direct", "group", "channel", "project", "task"]);

export const chatConversations = pgTable(
  "chat_conversations",
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    kind: chatConversationKind().notNull(),
    /** Nome do grupo/canal (diretas não têm nome). */
    name: text(),
    topic: text(),
    /** Departamento do canal (Criação, Atendimento, Comercial, Produção…). */
    department: text(),
    /**
     * Projeto/tarefa da conversa. Se o projeto ou a tarefa for apagado de vez, o
     * histórico da equipe continua, visível só para quem já participava.
     */
    projectId: uuid().references(() => projects.id, { onDelete: "set null" }),
    taskId: uuid().references(() => tasks.id, { onDelete: "set null" }),
    /** Canal privado: só participantes. Canal aberto: qualquer pessoa da equipe com acesso ao chat. */
    isPrivate: boolean().notNull().default(false),
    /** Quem pode escrever: todos os participantes ou só administradores da conversa. */
    postingPolicy: text().notNull().default("all"),
    /** Diretas: os dois ids de usuário em ordem, para não haver duas conversas iguais. */
    directKey: text(),
    lastSeq: bigint({ mode: "number" }).notNull().default(0),
    lastRev: bigint({ mode: "number" }).notNull().default(0),
    lastMessageAt: tstz(),
    createdByUserId: text().references(() => user.id, { onDelete: "set null" }),
    archivedAt: tstz(),
    /** Foto do grupo/canal no armazenamento privado (PNG quadrado) e hash do conteúdo (versão na URL). */
    imageKey: text(),
    imageHash: text(),
    ...timestamps,
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    unique("chat_conversations_direct_unique").on(t.organizationId, t.directKey),
    // Uma conversa por projeto e por tarefa.
    uniqueIndex("chat_conversations_project_unique")
      .on(t.organizationId, t.projectId)
      .where(sql`${t.kind} = 'project'`),
    uniqueIndex("chat_conversations_task_unique")
      .on(t.organizationId, t.taskId)
      .where(sql`${t.kind} = 'task'`),
    index().on(t.organizationId, t.lastMessageAt.desc()),
  ],
);

export const chatParticipants = pgTable(
  "chat_participants",
  {
    organizationId: uuid().notNull(),
    conversationId: uuid().notNull(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** "owner" | "admin" | "member" */
    role: text().notNull().default("member"),
    /** Última mensagem lida (recibo de leitura). */
    lastReadSeq: bigint({ mode: "number" }).notNull().default(0),
    lastReadAt: tstz(),
    /** Notificações desta conversa: todas, só menções ou nenhuma. */
    notify: text().notNull().default("all"),
    mutedUntil: tstz(),
    pinnedAt: tstz(),
    favoriteAt: tstz(),
    archivedAt: tstz(),
    /** Indicador de digitação (expira sozinho). */
    typingUntil: tstz(),
    joinedAt: createdAt(),
    updatedAt: tstz().notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.conversationId, t.userId] }),
    foreignKey({
      columns: [t.organizationId, t.conversationId],
      foreignColumns: [chatConversations.organizationId, chatConversations.id],
    }).onDelete("cascade"),
    index().on(t.organizationId, t.userId),
  ],
);

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: id(),
    organizationId: uuid().notNull(),
    conversationId: uuid().notNull(),
    seq: bigint({ mode: "number" }).notNull(),
    rev: bigint({ mode: "number" }).notNull(),
    authorUserId: text().references(() => user.id, { onDelete: "set null" }),
    /** Id gerado no navegador: reenvios da mesma mensagem não duplicam. */
    clientId: text().notNull(),
    /** "text" (pessoa) ou "system" (avisos: tarefa criada, participante entrou…). */
    kind: text().notNull().default("text"),
    body: text().notNull().default(""),
    replyToId: uuid(),
    /** Usuários mencionados (ids). */
    mentions: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** Referências internas detectadas no texto (tarefas, projetos, artes, arquivos). */
    refs: jsonb().$type<{ type: string; id: string; label: string; path: string }[]>().notNull().default([]),
    /** Tarefa criada a partir desta mensagem (ou vinculada a ela). */
    taskId: uuid().references(() => tasks.id, { onDelete: "set null" }),
    editedAt: tstz(),
    deletedAt: tstz(),
    deletedByUserId: text().references(() => user.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    unique("chat_messages_seq_unique").on(t.conversationId, t.seq),
    unique("chat_messages_client_unique").on(t.conversationId, t.clientId),
    foreignKey({
      columns: [t.organizationId, t.conversationId],
      foreignColumns: [chatConversations.organizationId, chatConversations.id],
    }).onDelete("cascade"),
    index().on(t.conversationId, t.rev),
    index().on(t.organizationId, t.authorUserId, t.createdAt),
    index("chat_messages_body_trgm").using("gin", sql`${t.body} gin_trgm_ops`),
  ],
);

export const chatReactions = pgTable(
  "chat_reactions",
  {
    organizationId: uuid().notNull(),
    messageId: uuid().notNull(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    emoji: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.messageId, t.userId, t.emoji] }),
    foreignKey({
      columns: [t.organizationId, t.messageId],
      foreignColumns: [chatMessages.organizationId, chatMessages.id],
    }).onDelete("cascade"),
  ],
);

/**
 * Anexos do chat. Ficam no mesmo armazenamento privado dos arquivos (mesma
 * validação de tipo e tamanho), mas fora da Central de Arquivos: só quem
 * participa da conversa tem acesso. Enviados antes da mensagem (pendentes,
 * sem `message_id`); pendentes esquecidos são apagados pela rotina diária.
 */
export const chatAttachments = pgTable(
  "chat_attachments",
  {
    id: id(),
    organizationId: uuid().notNull(),
    conversationId: uuid().notNull(),
    messageId: uuid(),
    uploadedByUserId: text().references(() => user.id, { onDelete: "set null" }),
    name: text().notNull(),
    mimeType: text().notNull(),
    sizeBytes: bigint({ mode: "number" }).notNull(),
    storageKey: text().notNull(),
    width: integer(),
    height: integer(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.conversationId],
      foreignColumns: [chatConversations.organizationId, chatConversations.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.organizationId, t.messageId],
      foreignColumns: [chatMessages.organizationId, chatMessages.id],
    }).onDelete("cascade"),
    index().on(t.conversationId, t.createdAt),
    index().on(t.messageId),
  ],
);

/** Disponibilidade escolhida pela pessoa e "visto por último" (heartbeat do chat). */
export const chatUserStatus = pgTable(
  "chat_user_status",
  {
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** "available" | "busy" | "away" */
    availability: text().notNull().default("available"),
    /** A pessoa escolhe se os outros veem quando ela esteve ativa. */
    showLastSeen: boolean().notNull().default(true),
    lastSeenAt: tstz(),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.userId] })],
);
