import { eq } from "drizzle-orm";
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { parseUserAvatarPath, userAvatarPath } from "@/lib/user-avatar";
import { withSystem } from "@/server/db";
import { memberships, organizations, user } from "@/server/db/schema";
import { env } from "@/server/env";
import { ValidationError } from "@/server/errors";
import { avatarStorageKey, readUserAvatar, removeUserAvatar, saveUserAvatar } from "@/server/services/user-avatar";
import { getStorage } from "@/server/storage";
import { addMember, createOrgWithOwner, createUser, resetDb } from "./helpers";

type Ctx = Awaited<ReturnType<typeof createOrgWithOwner>>;

async function photo(width: number, height: number, color = "#c0392b", format: "png" | "jpeg" | "webp" = "jpeg") {
  return sharp({ create: { width, height, channels: 3, background: color } })
    .toFormat(format)
    .toBuffer();
}

async function imageOf(userId: string) {
  const [row] = await withSystem((tx) => tx.select({ image: user.image }).from(user).where(eq(user.id, userId)));
  return row?.image ?? null;
}

async function stored(key: string) {
  try {
    return await getStorage().get(key);
  } catch {
    return null;
  }
}

describe("foto de perfil", () => {
  let a: Ctx;
  let b: Ctx;

  beforeAll(async () => {
    await resetDb();
    a = await createOrgWithOwner("Agência Foto A", "Ana Dona");
    b = await createOrgWithOwner("Agência Foto B", "Beto Dono");
  });

  it("envia, grava no armazenamento e atualiza o perfil; a URL serve a foto à própria pessoa", async () => {
    const res = await saveUserAvatar(a.owner.id, { buffer: await photo(800, 600) });
    expect(res.changed).toBe(true);
    expect(await imageOf(a.owner.id)).toBe(res.src);
    const parsed = parseUserAvatarPath(res.src)!;
    expect(parsed.userId).toBe(a.owner.id);
    const png = await readUserAvatar(a.owner.id, parsed.hash, a.owner.id);
    const meta = await sharp(png!).metadata();
    expect(meta.format).toBe("png");
    expect([meta.width, meta.height]).toEqual([512, 512]);
    expect(meta.exif).toBeUndefined();
  });

  it("aceita JPG, PNG (mantendo transparência) e WebP com enquadramento", async () => {
    const transparent = await sharp({
      create: { width: 300, height: 300, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .png()
      .toBuffer();
    const res = await saveUserAvatar(a.owner.id, { buffer: transparent, crop: { x: 0, y: 0, size: 1 } });
    const parsed = parseUserAvatarPath(res.src)!;
    const meta = await sharp((await readUserAvatar(a.owner.id, parsed.hash, a.owner.id))!).metadata();
    expect(meta.hasAlpha).toBe(true);
    const webp = await saveUserAvatar(a.owner.id, { buffer: await photo(200, 200, "#2e86c1", "webp") });
    expect(webp.changed).toBe(true);
  });

  it("valida pelo conteúdo real: recusa arquivo falso, formato não aceito, pequeno ou grande demais", async () => {
    const before = await imageOf(a.owner.id);
    await expect(saveUserAvatar(a.owner.id, { buffer: Buffer.from("não é imagem") })).rejects.toBeInstanceOf(
      ValidationError,
    );
    const gif = await sharp({ create: { width: 100, height: 100, channels: 3, background: "#000" } })
      .gif()
      .toBuffer();
    await expect(saveUserAvatar(a.owner.id, { buffer: gif })).rejects.toThrow(/Formato não aceito/);
    await expect(saveUserAvatar(a.owner.id, { buffer: await photo(20, 20) })).rejects.toThrow(/mínimo/);
    await expect(saveUserAvatar(a.owner.id, { buffer: Buffer.alloc(env.AVATAR_MAX_BYTES + 1, 1) })).rejects.toThrow(
      /limite para a foto/,
    );
    expect(await imageOf(a.owner.id)).toBe(before);
  });

  it("ao trocar, apaga só o arquivo anterior da própria pessoa; reenviar a mesma foto não duplica", async () => {
    const first = await saveUserAvatar(a.owner.id, { buffer: await photo(400, 400, "#117a65") });
    const firstKey = avatarStorageKey(a.owner.id, parseUserAvatarPath(first.src)!.hash);
    expect(await stored(firstKey)).not.toBeNull();
    const again = await saveUserAvatar(a.owner.id, { buffer: await photo(400, 400, "#117a65") });
    expect(again).toEqual({ src: first.src, changed: false });

    const second = await saveUserAvatar(a.owner.id, { buffer: await photo(400, 400, "#884ea0") });
    expect(second.src).not.toBe(first.src);
    expect(await stored(firstKey)).toBeNull();
    expect(await stored(avatarStorageKey(a.owner.id, parseUserAvatarPath(second.src)!.hash))).not.toBeNull();
    expect(await readUserAvatar(a.owner.id, parseUserAvatarPath(first.src)!.hash, a.owner.id)).toBeNull();
  });

  it("remover volta às iniciais e apaga o arquivo; link externo (login social) só sai do perfil", async () => {
    const res = await saveUserAvatar(a.owner.id, { buffer: await photo(300, 300) });
    const key = avatarStorageKey(a.owner.id, parseUserAvatarPath(res.src)!.hash);
    expect(await removeUserAvatar(a.owner.id)).toEqual({ removed: true });
    expect(await imageOf(a.owner.id)).toBeNull();
    expect(await stored(key)).toBeNull();
    expect(await removeUserAvatar(a.owner.id)).toEqual({ removed: false });

    const social = await createUser("Social");
    await withSystem((tx) =>
      tx.update(user).set({ image: "https://exemplo.dev/foto.png" }).where(eq(user.id, social.id)),
    );
    await removeUserAvatar(social.id);
    expect(await imageOf(social.id)).toBeNull();
  });

  it("a foto de uma pessoa não muda a de outra nem a logo da agência", async () => {
    const mine = await saveUserAvatar(a.owner.id, { buffer: await photo(300, 300, "#d35400") });
    const designer = await addMember(a.org.slug, a.org.id, "designer", { name: "Dani Designer" });
    await saveUserAvatar(designer.userId, { buffer: await photo(300, 300, "#1abc9c") });
    await removeUserAvatar(designer.userId);
    expect(await imageOf(a.owner.id)).toBe(mine.src);
    const [org] = await withSystem((tx) =>
      tx.select({ logoKey: organizations.logoKey }).from(organizations).where(eq(organizations.id, a.org.id)),
    );
    expect(org?.logoKey ?? null).toBeNull();
    // A chave sempre fica sob a pasta da própria pessoa.
    expect(avatarStorageKey(designer.userId, "a".repeat(64))).toBe(
      `users/${designer.userId}/avatar-${"a".repeat(32)}.png`,
    );
  });

  it("só quem trabalha com a pessoa vê a foto; outra agência, ex-membro e endereços adulterados recebem nada", async () => {
    const res = await saveUserAvatar(a.owner.id, { buffer: await photo(300, 300, "#5d6d7e") });
    const { hash } = parseUserAvatarPath(res.src)!;
    const coworker = await addMember(a.org.slug, a.org.id, "designer", { name: "Colega" });
    expect(await readUserAvatar(a.owner.id, hash, coworker.userId)).not.toBeNull();
    expect(await readUserAvatar(a.owner.id, hash, b.owner.id)).toBeNull();
    expect(await readUserAvatar(a.owner.id, "0".repeat(32), coworker.userId)).toBeNull();
    expect(await readUserAvatar("../etc", hash, coworker.userId)).toBeNull();

    await withSystem((tx) =>
      tx.update(memberships).set({ status: "removed" }).where(eq(memberships.id, coworker.membershipId)),
    );
    expect(await readUserAvatar(a.owner.id, hash, coworker.userId)).toBeNull();
  });

  it("monta e reconhece apenas endereços internos válidos", () => {
    const src = userAvatarPath("abc-123", "f".repeat(64));
    expect(src).toBe(`/api/user-avatar/abc-123/${"f".repeat(32)}`);
    expect(parseUserAvatarPath(src)).toEqual({ userId: "abc-123", hash: "f".repeat(32) });
    expect(parseUserAvatarPath("https://outro.site/api/user-avatar/x/y")).toBeNull();
    expect(parseUserAvatarPath("/api/user-avatar/abc/not-a-hash")).toBeNull();
    expect(parseUserAvatarPath(null)).toBeNull();
  });
});
