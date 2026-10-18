import { and, eq } from "drizzle-orm";
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { chatPhotoPath } from "@/lib/chat-photo";
import type { Actor } from "@/server/authz";
import { withSystem } from "@/server/db";
import { chatConversations, chatMessages, organizations, user } from "@/server/db/schema";
import { env } from "@/server/env";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { dispatchPendingEvents } from "@/server/events/dispatcher";
import {
  createChannel,
  createGroup,
  joinConversation,
  listConversations,
  openDirect,
  searchMessages,
  sendMessage,
  syncConversation,
} from "@/server/services/chat";
import {
  chatPhotoKey,
  readConversationPhoto,
  removeConversationPhoto,
  saveConversationPhoto,
} from "@/server/services/chat-photo";
import { listNotifications } from "@/server/services/notifications";
import { saveUserAvatar } from "@/server/services/user-avatar";
import { getStorage } from "@/server/storage";
import { addMember, as, createOrgWithOwner, resetDb } from "./helpers";

type Ctx = Awaited<ReturnType<typeof createOrgWithOwner>>;

async function photo(color: string, width = 600, height = 400) {
  return sharp({ create: { width, height, channels: 3, background: color } })
    .jpeg()
    .toBuffer();
}

async function stored(key: string) {
  try {
    return await getStorage().get(key);
  } catch {
    return null;
  }
}

async function convRow(id: string) {
  const [row] = await withSystem((tx) => tx.select().from(chatConversations).where(eq(chatConversations.id, id)));
  return row!;
}

async function systemBodies(id: string) {
  const rows = await withSystem((tx) =>
    tx
      .select({ body: chatMessages.body })
      .from(chatMessages)
      .where(and(eq(chatMessages.conversationId, id), eq(chatMessages.kind, "system"))),
  );
  return rows.map((r) => r.body);
}

const hashOf = (src: string) => src.split("/").pop()!;
let n = 0;
const send = (actor: Actor, conversationId: string, body: string) =>
  as(actor, (s) => sendMessage(s, { conversationId, clientId: `foto-msg-${n++}`, body }));

describe("foto das conversas em grupo", () => {
  let a: Ctx;
  let b: Ctx;
  let ana: Actor;
  let bia: Actor;
  let caio: Actor;
  let groupId: string;

  beforeAll(async () => {
    await resetDb();
    a = await createOrgWithOwner("Agência Grupo A", "Dona A");
    b = await createOrgWithOwner("Agência Grupo B", "Dono B");
    ana = await addMember(a.org.slug, a.org.id, "designer", { name: "Ana" });
    bia = await addMember(a.org.slug, a.org.id, "copywriter", { name: "Bia" });
    caio = await addMember(a.org.slug, a.org.id, "account", { name: "Caio" });
    groupId = (await as(ana, (s) => createGroup(s, { name: "Campanha Verão", userIds: [bia.userId] }))).id;
  });

  it("quem criou o grupo adiciona a foto; participantes veem na lista, no cabeçalho e na busca", async () => {
    // Sem foto: ícone padrão.
    expect((await as(bia, (s) => listConversations(s))).find((c) => c.id === groupId)?.image).toBeNull();

    const res = await as(ana, async (s) => saveConversationPhoto(s, groupId, { buffer: await photo("#c0392b") }));
    expect(res.changed).toBe(true);
    expect(res.src).toBe(chatPhotoPath(groupId, hashOf(res.src)));

    const row = await convRow(groupId);
    expect(row.imageKey).toBe(chatPhotoKey(a.org.id, groupId, row.imageHash!));
    expect(await stored(row.imageKey!)).not.toBeNull();

    const listBia = await as(bia, (s) => listConversations(s));
    expect(listBia.find((c) => c.id === groupId)?.image).toBe(res.src);
    const viewBia = await as(bia, (s) => syncConversation(s, groupId, 0));
    expect(viewBia.conversation.image).toBe(res.src);
    expect(viewBia.conversation.canEditPhoto).toBe(false);
    const viewAna = await as(ana, (s) => syncConversation(s, groupId, 0));
    expect(viewAna.conversation.canEditPhoto).toBe(true);

    const png = await as(bia, (s) => readConversationPhoto(s, groupId, hashOf(res.src)));
    const meta = await sharp(png).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["png", 512, 512]);

    await send(ana, groupId, "Briefing da campanha de verão");
    const found = await as(bia, (s) => searchMessages(s, "campanha de verão"));
    expect(found[0]?.conversationImage).toBe(res.src);
    expect(await systemBodies(groupId)).toContain(`<@${ana.userId}> adicionou a foto do grupo.`);
  });

  it("aviso de menção mostra a foto atual do grupo", async () => {
    await send(ana, groupId, `Olha isso, <@${bia.userId}>`);
    const items = await as(bia, (s) => listNotifications(s));
    const chat = items.find((i) => i.chat)?.chat;
    expect(chat?.kind).toBe("group");
    expect(chat?.image).toBe((await as(bia, (s) => listConversations(s))).find((c) => c.id === groupId)?.image);
  });

  it("sem permissão não altera: participante comum, quem não participa e outra agência", async () => {
    const before = await convRow(groupId);
    await expect(
      as(bia, async (s) => saveConversationPhoto(s, groupId, { buffer: await photo("#000000") })),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(as(bia, (s) => removeConversationPhoto(s, groupId))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      as(caio, async (s) => saveConversationPhoto(s, groupId, { buffer: await photo("#000000") })),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      as(b.actor, async (s) => saveConversationPhoto(s, groupId, { buffer: await photo("#000000") })),
    ).rejects.toBeInstanceOf(NotFoundError);
    // Nem ver: quem não participa do grupo privado e outra agência recebem "não encontrada".
    await expect(as(caio, (s) => readConversationPhoto(s, groupId, before.imageHash!))).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(as(b.actor, (s) => readConversationPhoto(s, groupId, before.imageHash!))).rejects.toBeInstanceOf(
      NotFoundError,
    );
    const after = await convRow(groupId);
    expect([after.imageKey, after.imageHash]).toEqual([before.imageKey, before.imageHash]);
  });

  it("trocar apaga só a foto anterior do grupo (depois de gravar); repetir a mesma foto não duplica", async () => {
    const old = await convRow(groupId);
    const next = await as(ana, async (s) =>
      saveConversationPhoto(s, groupId, { buffer: await photo("#1f618d", 500, 800) }),
    );
    expect(next.changed).toBe(true);
    await dispatchPendingEvents(50);
    expect(await stored(old.imageKey!)).toBeNull();
    const now = await convRow(groupId);
    expect(await stored(now.imageKey!)).not.toBeNull();
    // A versão antiga deixa de ser servida (o endereço muda a cada foto: sem imagem velha em cache).
    await expect(as(bia, (s) => readConversationPhoto(s, groupId, old.imageHash!))).rejects.toBeInstanceOf(
      NotFoundError,
    );
    const systemCount = (await systemBodies(groupId)).length;
    const same = await as(ana, async (s) =>
      saveConversationPhoto(s, groupId, { buffer: await photo("#1f618d", 500, 800) }),
    );
    expect(same).toEqual({ src: next.src, changed: false });
    expect((await systemBodies(groupId)).length).toBe(systemCount);
    expect(await systemBodies(groupId)).toContain(`<@${ana.userId}> alterou a foto do grupo.`);
  });

  it("arquivo inválido ou grande demais é recusado e a foto atual continua", async () => {
    const before = await convRow(groupId);
    await expect(
      as(ana, async (s) => saveConversationPhoto(s, groupId, { buffer: Buffer.from("não é imagem") })),
    ).rejects.toBeInstanceOf(ValidationError);
    const gif = await sharp({ create: { width: 100, height: 100, channels: 3, background: "#000" } })
      .gif()
      .toBuffer();
    await expect(as(ana, async (s) => saveConversationPhoto(s, groupId, { buffer: gif }))).rejects.toThrow(
      /Formato não aceito/,
    );
    await expect(
      as(ana, async (s) =>
        saveConversationPhoto(s, groupId, { buffer: Buffer.alloc(env.CHAT_PHOTO_MAX_BYTES + 1, 1) }),
      ),
    ).rejects.toThrow(/limite para a foto do grupo/);
    const after = await convRow(groupId);
    expect(after.imageHash).toBe(before.imageHash);
  });

  it("remover volta ao ícone para todos e apaga o arquivo", async () => {
    const before = await convRow(groupId);
    expect(await as(ana, (s) => removeConversationPhoto(s, groupId))).toEqual({ removed: true });
    await dispatchPendingEvents(50);
    expect(await stored(before.imageKey!)).toBeNull();
    const row = await convRow(groupId);
    expect([row.imageKey, row.imageHash]).toEqual([null, null]);
    expect((await as(bia, (s) => listConversations(s))).find((c) => c.id === groupId)?.image).toBeNull();
    expect((await as(bia, (s) => syncConversation(s, groupId, 0))).conversation.image).toBeNull();
    expect(await systemBodies(groupId)).toContain(`<@${ana.userId}> removeu a foto do grupo.`);
    expect(await as(ana, (s) => removeConversationPhoto(s, groupId))).toEqual({ removed: false });
  });

  it("canais: quem gerencia canais altera; participante comum não; diretas não têm foto própria", async () => {
    const channelId = (await as(a.actor, (s) => createChannel(s, { name: "avisos-foto" }))).id;
    await as(ana, (s) => joinConversation(s, channelId));
    await expect(
      as(ana, async (s) => saveConversationPhoto(s, channelId, { buffer: await photo("#000000") })),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const res = await as(a.actor, async (s) => saveConversationPhoto(s, channelId, { buffer: await photo("#27ae60") }));
    expect((await as(ana, (s) => listConversations(s))).find((c) => c.id === channelId)?.image).toBe(res.src);
    expect(await systemBodies(channelId)).toContain(`<@${a.owner.id}> adicionou a foto do canal.`);

    const direct = (await as(ana, (s) => openDirect(s, bia.userId))).id;
    await expect(
      as(ana, async (s) => saveConversationPhoto(s, direct, { buffer: await photo("#000000") })),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("não mexe nas fotos pessoais nem na logo da agência", async () => {
    const mine = await saveUserAvatar(ana.userId, { buffer: await photo("#f39c12", 300, 300) });
    await as(ana, async (s) => saveConversationPhoto(s, groupId, { buffer: await photo("#8e44ad") }));
    await as(ana, (s) => removeConversationPhoto(s, groupId));
    await dispatchPendingEvents(50);
    const [u] = await withSystem((tx) => tx.select({ image: user.image }).from(user).where(eq(user.id, ana.userId)));
    expect(u?.image).toBe(mine.src);
    const [org] = await withSystem((tx) =>
      tx.select({ logoKey: organizations.logoKey }).from(organizations).where(eq(organizations.id, a.org.id)),
    );
    expect(org?.logoKey ?? null).toBeNull();
    // Na conversa direta continua aparecendo a foto da pessoa.
    const direct = (await as(bia, (s) => listConversations(s))).find((c) => c.kind === "direct");
    expect(direct?.image).toBe(mine.src);
  });
});
