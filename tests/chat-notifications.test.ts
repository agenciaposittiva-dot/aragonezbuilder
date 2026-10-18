import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_CHAT_ALERTS, normalizeChatAlerts } from "@/lib/chat-alerts";
import type { Actor } from "@/server/authz";
import { withSystem } from "@/server/db";
import { chatConversations, chatMessages } from "@/server/db/schema";
import { ForbiddenError } from "@/server/errors";
import {
  addParticipants,
  chatInbox,
  createChannel,
  createGroup,
  deleteMessage,
  markRead,
  openDirect,
  removeParticipant,
  sendMessage,
  setParticipantPrefs,
} from "@/server/services/chat";
import {
  getChatAlertPrefs,
  getNotificationPreferences,
  updateChatAlertPrefs,
  updateNotificationPreferences,
} from "@/server/services/notification-preferences";
import { createClient } from "@/server/services/clients";
import { addMember, as, createOrgWithOwner, resetDb } from "./helpers";

let n = 0;
const cid = () => `ntf-${Date.now().toString(36)}-${(n++).toString(36)}`;
const send = (actor: Actor, conversationId: string, body: string) =>
  as(actor, (s) => sendMessage(s, { conversationId, clientId: cid(), body }));
const inbox = (actor: Actor, opts: { since?: number; after?: number | null; watch?: string[] } = {}) =>
  as(actor, (s) =>
    chatInbox(s, { since: opts.since ?? Date.now() - 60_000, after: opts.after ?? null, watch: opts.watch ?? [] }),
  );

type Ctx = Awaited<ReturnType<typeof createOrgWithOwner>>;

describe("avisos de mensagens (caixa de entrada)", () => {
  let a: Ctx;
  let b: Ctx;
  let ana: Actor;
  let bia: Actor;
  let caio: Actor;
  let guest: Actor;

  beforeAll(async () => {
    await resetDb();
    a = await createOrgWithOwner("Agência Avisos A", "Dona A");
    b = await createOrgWithOwner("Agência Avisos B", "Dono B");
    ana = await addMember(a.org.slug, a.org.id, "designer", { name: "Ana" });
    bia = await addMember(a.org.slug, a.org.id, "copywriter", { name: "Bia" });
    caio = await addMember(a.org.slug, a.org.id, "account", { name: "Caio" });
    const client = await as(a.actor, (s) => createClient(s, { name: "Cliente Avisos" }));
    guest = await addMember(a.org.slug, a.org.id, "client_admin", { name: "Convidado", clientIds: [client.id] });
  });

  it("só o destinatário recebe; nada das próprias mensagens nem do que veio antes de abrir a página", async () => {
    const { id } = await as(ana, (s) => openDirect(s, bia.userId));
    const before = await send(ana, id, "Mensagem antiga");
    await withSystem((tx) =>
      tx
        .update(chatMessages)
        .set({ createdAt: new Date(Date.now() - 30_000) })
        .where(eq(chatMessages.id, before.id)),
    );
    const opened = Date.now() - 5_000;
    const msg = await send(ana, id, `Oi <@${bia.userId}>, veja o **briefing**`);

    const forBia = await inbox(bia, { since: opened });
    expect(forBia.messages.map((m) => m.id)).toEqual([msg.id]);
    const m = forBia.messages[0]!;
    expect(m.conversation).toEqual({ kind: "direct", name: "Ana" });
    expect(m.author.name).toBe("Ana");
    expect(m.excerpt).toBe("Oi @Bia, veja o briefing");
    expect(m.mention).toBe(true);
    expect(m.ageMs).toBeLessThan(60_000);
    expect(typeof forBia.now).toBe("number");

    // Quem escreveu não recebe aviso da própria mensagem.
    expect((await inbox(ana, { since: opened })).messages).toEqual([]);
    // Terceiros (fora da conversa) não recebem nada.
    expect((await inbox(caio, { since: opened })).messages).toEqual([]);
  });

  it("reconexão: o cursor só volta a margem curta (o navegador deduplica por id); lida não volta", async () => {
    const { id } = await as(ana, (s) => openDirect(s, caio.userId));
    const first = await send(ana, id, "Primeira");
    const r1 = await inbox(caio);
    expect(r1.messages.map((m) => m.id)).toContain(first.id);
    // Mesma mensagem pode reaparecer dentro da margem de 20 s — o navegador ignora pelo id.
    const r2 = await inbox(caio, { after: r1.now });
    expect(r2.messages.map((m) => m.id)).toEqual([first.id]);
    // Depois da margem, nada repete.
    const r3 = await inbox(caio, { after: r1.now + 25_000 });
    expect(r3.messages).toEqual([]);
    // Lida (em qualquer aba ou aparelho) não gera aviso.
    const second = await send(ana, id, "Segunda");
    await as(caio, (s) => markRead(s, id, second.seq));
    expect((await inbox(caio)).messages).toEqual([]);
  });

  it("depois de muito tempo sem conexão, mensagens antigas não voltam como avisos", async () => {
    const { id } = await as(bia, (s) => openDirect(s, caio.userId));
    const old = await send(bia, id, "De ontem à noite");
    await withSystem(async (tx) => {
      await tx
        .update(chatMessages)
        .set({ createdAt: new Date(Date.now() - 20 * 60_000) })
        .where(eq(chatMessages.id, old.id));
    });
    const r = await inbox(caio, { since: Date.now() - 60 * 60_000, after: Date.now() - 40 * 60_000 });
    expect(r.messages.map((m) => m.id)).not.toContain(old.id);
    // Uma recente aparece com a idade calculada pelo servidor.
    const fresh = await send(bia, id, "Agora");
    await withSystem((tx) =>
      tx
        .update(chatMessages)
        .set({ createdAt: new Date(Date.now() - 3 * 60_000) })
        .where(eq(chatMessages.id, fresh.id)),
    );
    const r2 = await inbox(caio, { since: Date.now() - 60 * 60_000 });
    const got = r2.messages.find((m) => m.id === fresh.id);
    expect(got?.ageMs).toBeGreaterThan(2 * 60_000);
  });

  it("respeita silenciar, 'nenhum aviso', 'só menções', apagadas e avisos do sistema", async () => {
    const group = await as(ana, (s) => createGroup(s, { name: "Campanha Verão", userIds: [bia.userId, caio.userId] }));
    // Entrada no grupo gera mensagem do sistema: não vira aviso.
    expect((await inbox(bia)).messages.filter((m) => m.conversationId === group.id)).toEqual([]);

    const plain = await send(ana, group.id, "Reunião às 15h");
    let forBia = await inbox(bia);
    expect(forBia.messages.find((m) => m.id === plain.id)?.conversation).toEqual({
      kind: "group",
      name: "Campanha Verão",
    });

    // Só menções: mensagens comuns somem, menções continuam.
    await as(bia, (s) => setParticipantPrefs(s, { conversationId: group.id, notify: "mentions" }));
    const other = await send(ana, group.id, "Sem menção");
    const mention = await send(ana, group.id, `<@${bia.userId}> pode revisar?`);
    forBia = await inbox(bia);
    const ids = forBia.messages.map((m) => m.id);
    expect(ids).not.toContain(other.id);
    expect(ids).toContain(mention.id);

    // Nenhum aviso.
    await as(bia, (s) => setParticipantPrefs(s, { conversationId: group.id, notify: "none" }));
    await send(ana, group.id, `<@${bia.userId}> de novo`);
    expect((await inbox(bia)).messages.filter((m) => m.conversationId === group.id)).toEqual([]);

    // Silenciada (mesmo com "todas").
    await as(caio, (s) => setParticipantPrefs(s, { conversationId: group.id, muteHours: 8 }));
    await send(ana, group.id, "Caio não deve ser avisado");
    expect((await inbox(caio)).messages.filter((m) => m.conversationId === group.id)).toEqual([]);
    await as(caio, (s) => setParticipantPrefs(s, { conversationId: group.id, muteHours: 0 }));

    // Apagada antes da consulta: não aparece.
    const gone = await send(ana, group.id, "Mensagem por engano");
    await as(ana, (s) => deleteMessage(s, gone.id));
    expect((await inbox(caio)).messages.map((m) => m.id)).not.toContain(gone.id);
  });

  it("canal privado e outra organização: nunca recebem conteúdo; janelas sem acesso somem", async () => {
    const ch = await as(a.actor, (s) =>
      createChannel(s, { name: "Diretoria", isPrivate: true, userIds: [ana.userId] }),
    );
    const secret = await send(a.actor, ch.id, "Assunto reservado");
    expect((await inbox(ana)).messages.map((m) => m.id)).toContain(secret.id);
    expect((await inbox(bia)).messages.map((m) => m.id)).not.toContain(secret.id);
    // Outra organização: nada, e tentar acompanhar a conversa de A devolve "sem acesso".
    const fromB = await inbox(b.actor, { watch: [ch.id] });
    expect(fromB.messages).toEqual([]);
    expect(fromB.watch).toEqual([{ conversationId: ch.id, lastReadSeq: 0, gone: true }]);

    // Acompanhando a janela: leitura em outro aparelho aparece; ao sair da conversa, some.
    let w = await inbox(ana, { watch: [ch.id, "não-é-uuid"] });
    expect(w.watch).toEqual([{ conversationId: ch.id, lastReadSeq: 0, gone: false }]);
    await as(ana, (s) => markRead(s, ch.id, secret.seq));
    w = await inbox(ana, { watch: [ch.id] });
    expect(w.watch[0]).toMatchObject({ lastReadSeq: secret.seq, gone: false });
    await as(a.actor, (s) => removeParticipant(s, ch.id, ana.userId));
    w = await inbox(ana, { watch: [ch.id] });
    expect(w.watch[0]?.gone).toBe(true);
    await send(a.actor, ch.id, "Depois da saída");
    expect((await inbox(ana)).messages.filter((m) => m.conversationId === ch.id)).toEqual([]);
    // Volta a participar: volta a receber.
    await as(a.actor, (s) => addParticipants(s, ch.id, [ana.userId]));
    const back = await send(a.actor, ch.id, "Bem-vinda de volta");
    expect((await inbox(ana)).messages.map((m) => m.id)).toContain(back.id);
  });

  it("convidados do cliente não usam a caixa de entrada do chat", async () => {
    await expect(inbox(guest)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("conversa arquivada não gera aviso", async () => {
    const { id } = await as(caio, (s) => openDirect(s, ana.userId));
    const m = await send(caio, id, "Antes de arquivar");
    await withSystem((tx) =>
      tx.update(chatConversations).set({ archivedAt: new Date() }).where(eq(chatConversations.id, id)),
    );
    expect((await inbox(ana)).messages.map((x) => x.id)).not.toContain(m.id);
  });
});

describe("preferências de aviso do chat", () => {
  let a: Ctx;
  let b: Ctx;
  let ana: Actor;
  let guest: Actor;

  beforeAll(async () => {
    await resetDb();
    a = await createOrgWithOwner("Agência Prefs A", "Dona A");
    b = await createOrgWithOwner("Agência Prefs B", "Dono B");
    ana = await addMember(a.org.slug, a.org.id, "designer", { name: "Ana" });
    const client = await as(a.actor, (s) => createClient(s, { name: "Cliente Prefs" }));
    guest = await addMember(a.org.slug, a.org.id, "client_admin", { name: "Convidado", clientIds: [client.id] });
  });

  it("sem registro vale o padrão (som moderado, janela ligada, trecho fora do sistema)", async () => {
    const p = await as(ana, getChatAlertPrefs);
    expect(p).toEqual(DEFAULT_CHAT_ALERTS);
    expect(p.volume).toBe(40);
    expect(p.nativePreview).toBe(false);
  });

  it("grava na conta, sem apagar as outras preferências, e só para a própria pessoa", async () => {
    await as(ana, (s) => updateNotificationPreferences(s, { inApp: { tasks: false }, email: { chat: false } }));
    const next = {
      ...DEFAULT_CHAT_ALERTS,
      sound: false,
      volume: 70,
      duration: 0 as const,
      activeSound: "off" as const,
    };
    await as(ana, (s) => updateChatAlertPrefs(s, next));
    expect(await as(ana, getChatAlertPrefs)).toEqual(next);
    expect(await as(ana, getNotificationPreferences)).toEqual({ inApp: { tasks: false }, email: { chat: false } });
    // Mudar as outras preferências não apaga as de aviso.
    await as(ana, (s) => updateNotificationPreferences(s, { inApp: {}, email: {} }));
    expect((await as(ana, getChatAlertPrefs)).volume).toBe(70);
    // Outras pessoas e outra organização continuam no padrão.
    expect(await as(a.actor, getChatAlertPrefs)).toEqual(DEFAULT_CHAT_ALERTS);
    expect(await as(b.actor, getChatAlertPrefs)).toEqual(DEFAULT_CHAT_ALERTS);
  });

  it("valida a entrada e recusa convidados", async () => {
    await expect(as(ana, (s) => updateChatAlertPrefs(s, { ...DEFAULT_CHAT_ALERTS, volume: 500 }))).rejects.toThrow();
    await expect(
      as(ana, (s) => updateChatAlertPrefs(s, { ...DEFAULT_CHAT_ALERTS, duration: 7 as unknown as 8 })),
    ).rejects.toThrow();
    await expect(as(guest, (s) => updateChatAlertPrefs(s, DEFAULT_CHAT_ALERTS))).rejects.toBeInstanceOf(ForbiddenError);
    // Valores estranhos gravados não quebram a leitura.
    expect(normalizeChatAlerts({ volume: 1000, duration: 3, sound: "sim", activeSound: "alto" })).toEqual({
      ...DEFAULT_CHAT_ALERTS,
      volume: 100,
    });
  });
});
