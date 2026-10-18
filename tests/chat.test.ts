import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { excerpt, extractMentions, parseMessage } from "@/lib/chat-format";
import type { Actor } from "@/server/authz";
import { withOrg, withSystem } from "@/server/db";
import { aiGenerations, auditLogs, chatAttachments, domainEvents, notifications } from "@/server/db/schema";
import { env } from "@/server/env";
import { ForbiddenError, LimitError, NotFoundError, ValidationError } from "@/server/errors";
import { updateAiSettings } from "@/server/services/ai";
import { saveProviderKey } from "@/server/services/ai-providers";
import { runGeneration, type GenerationEvent } from "@/server/services/ai-run";
import {
  createChannel,
  createGroup,
  deleteMessage,
  editMessage,
  joinConversation,
  linkMessageTask,
  listConversations,
  markRead,
  openDirect,
  openProjectConversation,
  openTaskConversation,
  projectMentions,
  searchMessages,
  sendMessage,
  setParticipantPrefs,
  syncConversation,
  toggleReaction,
  unreadTotal,
  updateConversation,
} from "@/server/services/chat";
import { prepareChatAi } from "@/server/services/chat-ai";
import {
  chatAttachmentUrl,
  cleanupPendingChatAttachments,
  uploadChatAttachment,
} from "@/server/services/chat-attachments";
import { createClient } from "@/server/services/clients";
import { createProject, setProjectMembers } from "@/server/services/projects";
import { createTask } from "@/server/services/tasks";
import { getStorage } from "@/server/storage";
import { installAiMock, TINY_PNG } from "./ai-mocks";
import { addMember, as, createOrgWithOwner, resetDb } from "./helpers";

let n = 0;
const cid = () => `cli-${Date.now().toString(36)}-${(n++).toString(36)}`;
const send = (actor: Actor, conversationId: string, body: string, extra: Record<string, unknown> = {}) =>
  as(actor, (s) => sendMessage(s, { conversationId, clientId: cid(), body, ...extra }));

type Ctx = Awaited<ReturnType<typeof createOrgWithOwner>>;

describe("formatação das mensagens", () => {
  it("transforma em nós seguros (sem HTML) e extrai menções", () => {
    const nodes = parseMessage("Oi <@abc123> **veja** <script>alert(1)</script> https://exemplo.com/a.");
    expect(nodes.some((n) => n.t === "mention" && n.id === "abc123")).toBe(true);
    expect(nodes.some((n) => n.t === "bold")).toBe(true);
    expect(nodes.some((n) => n.t === "link" && n.href === "https://exemplo.com/a")).toBe(true);
    // O texto perigoso continua como texto (a interface nunca o interpreta como HTML).
    expect(nodes.filter((n) => n.t === "text").some((n) => n.t === "text" && n.v.includes("<script>"))).toBe(true);
    expect(extractMentions("<@a1> e <@b2> e <@a1>")).toEqual(["a1", "b2"]);
    expect(excerpt("Olá <@a1>", (id) => (id === "a1" ? "Ana" : undefined))).toBe("Olá @Ana");
    expect(parseMessage("```\nconst a = 1\n```").some((n) => n.t === "pre")).toBe(true);
  });
});

describe("chat da equipe", () => {
  let a: Ctx;
  let b: Ctx;
  let ana: Actor;
  let bia: Actor;
  let caio: Actor;
  let guest: Actor;
  let clientId: string;

  beforeAll(async () => {
    await resetDb();
    a = await createOrgWithOwner("Agência Chat A", "Dona A");
    b = await createOrgWithOwner("Agência Chat B", "Dono B");
    ana = await addMember(a.org.slug, a.org.id, "designer", { name: "Ana" });
    bia = await addMember(a.org.slug, a.org.id, "copywriter", { name: "Bia" });
    caio = await addMember(a.org.slug, a.org.id, "account", { name: "Caio" });
    clientId = (await as(a.actor, (s) => createClient(s, { name: "Cliente Chat" }))).id;
    guest = await addMember(a.org.slug, a.org.id, "client_admin", { name: "Convidado", clientIds: [clientId] });
  });

  it("conversa direta: troca, ordem estável, sem duplicar no reenvio e com não lidas", async () => {
    const { id } = await as(ana, (s) => openDirect(s, bia.userId));
    // Abrir de novo devolve a mesma conversa (dos dois lados).
    expect((await as(bia, (s) => openDirect(s, ana.userId))).id).toBe(id);
    const clientIdA = cid();
    const m1 = await as(ana, (s) => sendMessage(s, { conversationId: id, clientId: clientIdA, body: "Oi, Bia!" }));
    const again = await as(ana, (s) => sendMessage(s, { conversationId: id, clientId: clientIdA, body: "Oi, Bia!" }));
    expect(again.id).toBe(m1.id);
    const m2 = await send(bia, id, "Oi, Ana.");
    expect(m2.seq).toBe(m1.seq + 1);

    const listAna = await as(ana, (s) => listConversations(s));
    const conv = listAna.find((c) => c.id === id)!;
    expect(conv.kind).toBe("direct");
    expect(conv.name).toBe("Bia");
    expect(conv.unread).toBe(1);
    expect(await as(ana, (s) => unreadTotal(s))).toBe(1);
    await as(ana, (s) => markRead(s, id, m2.seq));
    expect(await as(ana, (s) => unreadTotal(s))).toBe(0);

    // Depois de recarregar (nova leitura), o histórico continua igual.
    const synced = await as(bia, (s) => syncConversation(s, id, 0));
    expect(synced.messages.map((m) => m.body)).toEqual(["Oi, Bia!", "Oi, Ana."]);
    expect(synced.conversation.participants.find((p) => p.userId === ana.userId)?.lastReadSeq).toBe(m2.seq);
  });

  it("conversas privadas continuam privadas (outra pessoa, outra agência, convidado)", async () => {
    const { id } = await as(ana, (s) => openDirect(s, bia.userId));
    await expect(as(caio, (s) => syncConversation(s, id, 0))).rejects.toBeInstanceOf(NotFoundError);
    await expect(send(caio, id, "intrometido")).rejects.toBeInstanceOf(NotFoundError);
    await expect(as(b.actor, (s) => syncConversation(s, id, 0))).rejects.toBeInstanceOf(NotFoundError);
    await expect(as(guest, (s) => listConversations(s))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(as(guest, (s) => syncConversation(s, id, 0))).rejects.toBeInstanceOf(ForbiddenError);
    // A busca de quem não participa não encontra a mensagem.
    expect(await as(caio, (s) => searchMessages(s, "Oi, Bia"))).toHaveLength(0);
    expect((await as(ana, (s) => searchMessages(s, "Oi, Bia"))).length).toBeGreaterThan(0);
  });

  it("grupos e canais respeitam permissões", async () => {
    await expect(as(ana, (s) => createChannel(s, { name: "Criação", isPrivate: false }))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    const open = await as(a.actor, (s) => createChannel(s, { name: "Geral", department: "Geral" }));
    const closed = await as(a.actor, (s) => createChannel(s, { name: "Diretoria", isPrivate: true }));
    // Canal aberto: qualquer pessoa da equipe lê e entra.
    await as(caio, (s) => joinConversation(s, open.id));
    await send(caio, open.id, "Bom dia, pessoal");
    // Canal privado: só participantes.
    await expect(as(caio, (s) => syncConversation(s, closed.id, 0))).rejects.toBeInstanceOf(NotFoundError);
    // Só administradores escrevem quando a regra exigir.
    await as(a.actor, (s) => updateConversation(s, { id: open.id, postingPolicy: "admins" }));
    await expect(send(caio, open.id, "posso?")).rejects.toBeInstanceOf(ForbiddenError);
    await as(a.actor, (s) => updateConversation(s, { id: open.id, postingPolicy: "all" }));
    // Grupo: só quem foi incluído.
    const group = await as(ana, (s) => createGroup(s, { name: "Campanha verão", userIds: [bia.userId] }));
    await expect(as(caio, (s) => syncConversation(s, group.id, 0))).rejects.toBeInstanceOf(NotFoundError);
    const g = await as(bia, (s) => syncConversation(s, group.id, 0));
    expect(g.messages[0]?.kind).toBe("system");
    // Pessoa de fora da equipe não pode ser incluída.
    await expect(as(ana, (s) => createGroup(s, { name: "x", userIds: [guest.userId] }))).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("edição e exclusão seguem a regra e aparecem na sincronização", async () => {
    const ch = await as(a.actor, (s) => createChannel(s, { name: "Produção" }));
    await as(caio, (s) => joinConversation(s, ch.id));
    const msg = await send(caio, ch.id, "texto com erro");
    const before = await as(ana, (s) => syncConversation(s, ch.id, 0));
    const rev = before.conversation.lastRev;
    await expect(as(ana, (s) => editMessage(s, { messageId: msg.id, body: "hack" }))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await as(caio, (s) => editMessage(s, { messageId: msg.id, body: "texto corrigido" }));
    await as(ana, (s) => toggleReaction(s, { messageId: msg.id, emoji: "👍" }));
    let changes = await as(ana, (s) => syncConversation(s, ch.id, rev));
    const changed = changes.messages.find((m) => m.id === msg.id)!;
    expect(changed.body).toBe("texto corrigido");
    expect(changed.editedAt).not.toBeNull();
    expect(changed.reactions[0]).toMatchObject({ emoji: "👍", count: 1 });
    // Ana não modera: não apaga mensagem dos outros. A dona da agência (gestão de canais) apaga e fica na auditoria.
    await expect(as(ana, (s) => deleteMessage(s, msg.id))).rejects.toBeInstanceOf(ForbiddenError);
    await as(a.actor, (s) => deleteMessage(s, msg.id));
    changes = await as(caio, (s) => syncConversation(s, ch.id, changes.conversation.lastRev));
    const gone = changes.messages.find((m) => m.id === msg.id)!;
    expect(gone.deletedAt).not.toBeNull();
    expect(gone.body).toBe("");
    const audit = await withOrg(a.org.id, (tx) =>
      tx.select().from(auditLogs).where(eq(auditLogs.action, "chat_message_moderated")),
    );
    expect(audit).toHaveLength(1);
    // Quem escreveu apaga a própria mensagem.
    const own = await send(caio, ch.id, "vou apagar");
    await as(caio, (s) => deleteMessage(s, own.id));
  });

  it("avisos: diretas e menções, um por conversa, respeitando silêncio", async () => {
    const ch = await as(a.actor, (s) => createChannel(s, { name: "Atendimento" }));
    await as(bia, (s) => joinConversation(s, ch.id));
    await as(caio, (s) => joinConversation(s, ch.id));
    await send(caio, ch.id, `<@${bia.userId}> pode revisar?`);
    await send(caio, ch.id, `<@${bia.userId}> lembrete`);
    await send(caio, ch.id, "mensagem sem menção");
    const forBia = await withOrg(a.org.id, (tx) =>
      tx
        .select()
        .from(notifications)
        .where(and(eq(notifications.userId, bia.userId), eq(notifications.entityId, ch.id))),
    );
    expect(forBia).toHaveLength(1);
    expect(forBia[0]!.title).toMatch(/mencionou você/);
    expect(forBia[0]!.body).toBe("@Bia lembrete");
    // Ana está no canal? Não — e não foi mencionada: nenhum aviso.
    const forAna = await withOrg(a.org.id, (tx) =>
      tx
        .select()
        .from(notifications)
        .where(and(eq(notifications.userId, ana.userId), eq(notifications.entityId, ch.id))),
    );
    expect(forAna).toHaveLength(0);
    // Lido: o aviso some; silenciada: menções não geram aviso.
    const sync = await as(bia, (s) => syncConversation(s, ch.id, 0));
    await as(bia, (s) => markRead(s, ch.id, sync.conversation.lastSeq));
    await as(bia, (s) => setParticipantPrefs(s, { conversationId: ch.id, muteHours: 8 }));
    await send(caio, ch.id, `<@${bia.userId}> de novo`);
    const unread = await withOrg(a.org.id, (tx) =>
      tx
        .select()
        .from(notifications)
        .where(and(eq(notifications.userId, bia.userId), eq(notifications.entityId, ch.id))),
    );
    expect(unread.filter((x) => !x.readAt)).toHaveLength(0);
  });

  it("anexos: tipo real validado, acesso só para quem lê a conversa e limpeza", async () => {
    const { id } = await as(ana, (s) => openDirect(s, caio.userId));
    const png = Buffer.from(TINY_PNG, "base64");
    await expect(
      as(ana, (s) =>
        uploadChatAttachment(s, id, {
          buffer: Buffer.from("MZ\x90\x00\x03\x00\x00\x00binário", "binary"),
          originalName: "foto.png",
        }),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    const att = await as(ana, (s) => uploadChatAttachment(s, id, { buffer: png, originalName: "arte.png" }));
    expect(att.mimeType).toBe("image/png");
    // Pendente: só quem enviou vê.
    await expect(as(caio, (s) => chatAttachmentUrl(s, att.id))).rejects.toBeInstanceOf(NotFoundError);
    const msg = await send(ana, id, "", { attachmentIds: [att.id] });
    expect(msg.attachments.map((x) => x.id)).toEqual([att.id]);
    expect(await as(caio, (s) => chatAttachmentUrl(s, att.id))).toContain("/api/files/download");
    await expect(as(bia, (s) => chatAttachmentUrl(s, att.id))).rejects.toBeInstanceOf(NotFoundError);
    await expect(as(b.actor, (s) => chatAttachmentUrl(s, att.id))).rejects.toBeInstanceOf(NotFoundError);
    // Anexo de outra pessoa não pode ser preso à sua mensagem.
    const other = await as(caio, (s) => uploadChatAttachment(s, id, { buffer: png, originalName: "dele.png" }));
    await expect(send(ana, id, "roubando", { attachmentIds: [other.id] })).rejects.toBeInstanceOf(ValidationError);
    // Apagar a mensagem remove o anexo e agenda a limpeza do armazenamento.
    const [row] = await withOrg(a.org.id, (tx) =>
      tx.select().from(chatAttachments).where(eq(chatAttachments.id, att.id)),
    );
    await as(ana, (s) => deleteMessage(s, msg.id));
    const purge = await withSystem((tx) =>
      tx.select().from(domainEvents).where(eq(domainEvents.type, "storage.purge")),
    );
    expect(purge.some((e) => (e.payload as { keys: string[] }).keys.includes(row!.storageKey))).toBe(true);
    // Pendentes esquecidos (mais de 24 h) saem do banco e do armazenamento.
    const [pending] = await withOrg(a.org.id, (tx) =>
      tx.select().from(chatAttachments).where(eq(chatAttachments.id, other.id)),
    );
    expect(await getStorage().exists(pending!.storageKey)).toBe(true);
    const res = await cleanupPendingChatAttachments(new Date(Date.now() + 60_000));
    expect(res.removed).toBeGreaterThanOrEqual(1);
    expect(await getStorage().exists(pending!.storageKey)).toBe(false);
  });

  it("conversa do projeto e da tarefa: só quem vê o projeto; tarefa a partir de mensagem", async () => {
    const outsider = await addMember(a.org.slug, a.org.id, "collaborator", { name: "Externo" });
    const project = await as(a.actor, (s) => createProject(s, { clientId, name: "Site novo" }));
    await as(a.actor, (s) => setProjectMembers(s, { projectId: project.id, membershipIds: [ana.membershipId] }));
    const conv = await as(a.actor, (s) => openProjectConversation(s, project.id));
    expect((await as(ana, (s) => openProjectConversation(s, project.id))).id).toBe(conv.id);
    await expect(as(outsider, (s) => openProjectConversation(s, project.id))).rejects.toBeInstanceOf(NotFoundError);
    await expect(as(outsider, (s) => syncConversation(s, conv.id, 0))).rejects.toBeInstanceOf(NotFoundError);

    const msg = await send(ana, conv.id, "Precisamos do banner da home até sexta");
    const task = await as(a.actor, (s) => createTask(s, { projectId: project.id, title: "Banner da home" }));
    await as(a.actor, (s) => linkMessageTask(s, msg.id, task.id, true));
    const synced = await as(ana, (s) => syncConversation(s, conv.id, 0));
    expect(synced.messages.find((m) => m.id === msg.id)?.task?.title).toBe("Banner da home");
    expect(synced.messages.at(-1)?.kind).toBe("system");
    // Conversa da tarefa (responsável entra) e menção ao projeto em outra conversa.
    const tconv = await as(a.actor, (s) => openTaskConversation(s, task.id));
    expect(tconv.id).toBeTruthy();
    const { id: dm } = await as(a.actor, (s) => openDirect(s, ana.userId));
    await send(a.actor, dm, `Olha o projeto /w/${a.org.slug}/projects/${project.id}`);
    const mentions = await as(ana, (s) => projectMentions(s, project.id));
    expect(mentions.some((m) => m.conversationId === dm)).toBe(true);
    // Quem não vê o projeto não recebe a prévia do link (referência fica vazia).
    const { id: dm2 } = await as(outsider, (s) => openDirect(s, ana.userId));
    const leaked = await send(outsider, dm2, `/w/${a.org.slug}/projects/${project.id}`);
    expect(leaked.refs).toHaveLength(0);
  });

  it("limita abuso: muitas mensagens em poucos segundos", async () => {
    const dani = await addMember(a.org.slug, a.org.id, "social_media", { name: "Dani" });
    const { id } = await as(dani, (s) => openDirect(s, caio.userId));
    for (let i = 0; i < 12; i++) await send(dani, id, `msg ${i}`);
    await expect(send(dani, id, "mais uma")).rejects.toBeInstanceOf(LimitError);
  });
});

describe("IA no chat", () => {
  let ctx: Ctx;
  let ana: Actor;
  let bia: Actor;
  let mock: ReturnType<typeof installAiMock>;
  const saved = { provider: env.AI_DEFAULT_PROVIDER, anthropic: env.ANTHROPIC_API_KEY };

  beforeAll(async () => {
    env.AI_DEFAULT_PROVIDER = "anthropic";
    env.ANTHROPIC_API_KEY = undefined;
    mock = installAiMock();
    mock.state.valid.anthropic.add("sk-ant-chat-teste");
    ctx = await createOrgWithOwner("Agência Chat IA");
    ana = await addMember(ctx.org.slug, ctx.org.id, "manager", { name: "Ana IA" });
    bia = await addMember(ctx.org.slug, ctx.org.id, "designer", { name: "Bia IA" });
    expect((await as(ctx.actor, (s) => saveProviderKey(s, "anthropic", "sk-ant-chat-teste"))).ok).toBe(true);
  });

  afterAll(() => {
    env.AI_DEFAULT_PROVIDER = saved.provider;
    env.ANTHROPIC_API_KEY = saved.anthropic;
    vi.unstubAllGlobals();
  });

  it("só usa conversas com autorização da organização e só o que a pessoa pode ler", async () => {
    const { id } = await as(ana, (s) => openDirect(s, bia.userId));
    await send(ana, id, "Decidimos usar a paleta azul na campanha");
    const secret = await as(ctx.actor, (s) => createGroup(s, { name: "Sigiloso", userIds: [bia.userId] }));
    await send(ctx.actor, secret.id, "SEGREDO-DA-DIRETORIA");

    // Sem autorização: nada sai para o provedor (reescrever usa só o rascunho).
    await expect(as(ana, (s) => prepareChatAi(s, { conversationId: id, action: "summary" }))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    const rewrite = await as(ana, (s) =>
      prepareChatAi(s, { conversationId: id, action: "rewrite", draft: "oi td bem" }),
    );
    expect(rewrite.prepared.prompt).toContain("oi td bem");
    expect(rewrite.prepared.prompt).not.toContain("paleta azul");

    await as(ctx.actor, (s) =>
      updateAiSettings(s, {
        enabled: true,
        allowClientContext: false,
        allowChatContext: true,
        monthlyTokenLimit: 0,
        userDailyRequestLimit: 0,
      }),
    );
    const ready = await as(ana, (s) =>
      prepareChatAi(s, { conversationId: id, action: "ask", question: "Qual paleta e qual segredo?", scope: "all" }),
    );
    expect(ready.prepared.prompt).toContain("paleta azul");
    // Ana não participa do grupo sigiloso: o texto dele nunca entra no contexto.
    expect(ready.prepared.prompt).not.toContain("SEGREDO-DA-DIRETORIA");
    await expect(
      as(ctx.actor, (s) => prepareChatAi(s, { conversationId: id, action: "summary" })),
    ).rejects.toBeInstanceOf(NotFoundError);

    mock.state.reply = "Resumo: paleta azul aprovada.";
    const events: GenerationEvent[] = [];
    await runGeneration(ana, ready.prepared, ready.stored, { send: (e) => events.push(e) });
    expect(events.some((e) => e.t === "done")).toBe(true);
    // O histórico de gerações não guarda o texto da conversa.
    const gens = await withOrg(ctx.org.id, (tx) => tx.select().from(aiGenerations));
    expect(JSON.stringify(gens.at(-1)?.input)).not.toContain("paleta azul");
  });
});
