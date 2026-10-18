import { eq } from "drizzle-orm";
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { orgLogoPath } from "@/lib/org-logo";
import { listUserOrganizations, resolveActor } from "@/server/authz/actor";
import { withSystem } from "@/server/db";
import { organizations } from "@/server/db/schema";
import { env } from "@/server/env";
import { ForbiddenError, ValidationError } from "@/server/errors";
import { createClient } from "@/server/services/clients";
import { readOrgLogo, removeOrgLogo, renderOrgLogo, saveOrgLogo } from "@/server/services/org-logo";
import { getStorage } from "@/server/storage";
import { addMember, as, createOrgWithOwner, resetDb } from "./helpers";

type Ctx = Awaited<ReturnType<typeof createOrgWithOwner>>;

/** PNG com metade esquerda vermelha e direita azul (transparente fora disso não há). */
async function halves(width: number, height: number, format: "png" | "jpeg" = "png", orientation?: number) {
  const half = Math.round(width / 2);
  const base = sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 255, alpha: 1 } } })
    .composite([
      {
        input: await sharp({
          create: { width: half, height, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } },
        })
          .png()
          .toBuffer(),
        left: 0,
        top: 0,
      },
    ])
    .toFormat(format);
  return orientation ? base.withMetadata({ orientation }).toBuffer() : base.toBuffer();
}

async function solid(width: number, height: number, color = "#1f3a5f") {
  return sharp({ create: { width, height, channels: 3, background: color } })
    .png()
    .toBuffer();
}

async function pixel(png: Buffer, x: number, y: number) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * 4;
  return { r: data[i]!, g: data[i + 1]!, b: data[i + 2]!, a: data[i + 3]! };
}

async function orgRow(id: string) {
  const [row] = await withSystem((tx) => tx.select().from(organizations).where(eq(organizations.id, id)));
  return row!;
}

describe("logo da agência", () => {
  let a: Ctx;
  let b: Ctx;

  beforeAll(async () => {
    await resetDb();
    a = await createOrgWithOwner("Agência Logo A");
    b = await createOrgWithOwner("Agência Logo B");
  });

  it("gera PNG 512×512 com transparência e respeita o enquadramento", async () => {
    // Logo larga 400×100: o quadro de 200 px cobre a metade vermelha e sobra em cima e embaixo.
    const png = await renderOrgLogo({ buffer: await halves(400, 100), crop: { x: 0, y: -0.5, size: 0.5 } });
    const meta = await sharp(png).metadata();
    expect(meta.format).toBe("png");
    expect([meta.width, meta.height]).toEqual([512, 512]);
    expect(meta.hasAlpha).toBe(true);
    expect(meta.exif).toBeUndefined();
    expect(await pixel(png, 256, 256)).toMatchObject({ r: 255, b: 0, a: 255 });
    expect(await pixel(png, 500, 256)).toMatchObject({ r: 255, b: 0 });
    // Fora da imagem: transparente.
    expect((await pixel(png, 256, 20)).a).toBe(0);
  });

  it("sem enquadramento, centraliza a imagem inteira; fundo escolhido preenche a sobra", async () => {
    const png = await renderOrgLogo({ buffer: await halves(400, 100), background: "white" });
    expect(await pixel(png, 100, 256)).toMatchObject({ r: 255, b: 0, a: 255 });
    expect(await pixel(png, 400, 256)).toMatchObject({ r: 0, b: 255 });
    expect(await pixel(png, 256, 10)).toMatchObject({ r: 255, g: 255, b: 255, a: 255 });
  });

  it("aplica a orientação EXIF antes de recortar", async () => {
    // 200×100 com orientação 6 (90° horário): exibida como 100×200, vermelho em cima.
    const jpg = await halves(200, 100, "jpeg", 6);
    const png = await renderOrgLogo({ buffer: jpg, crop: { x: 0, y: 0, size: 1 } });
    const top = await pixel(png, 256, 256);
    expect(top.r).toBeGreaterThan(200);
    expect(top.b).toBeLessThan(60);
  });

  it("recusa arquivos que não são PNG, JPG ou WebP de verdade", async () => {
    const fake = Buffer.from("isto não é uma imagem, apesar do nome logo.png");
    await expect(renderOrgLogo({ buffer: fake })).rejects.toBeInstanceOf(ValidationError);
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200"/></svg>',
    );
    await expect(renderOrgLogo({ buffer: svg })).rejects.toThrow(/Formato não aceito/);
    const gif = await sharp({ create: { width: 100, height: 100, channels: 3, background: "#000" } })
      .gif()
      .toBuffer();
    await expect(renderOrgLogo({ buffer: gif })).rejects.toThrow(/Formato não aceito/);
  });

  it("limita tamanho do arquivo e dimensões", async () => {
    const big = Buffer.concat([await solid(100, 100), Buffer.alloc(env.LOGO_MAX_BYTES)]);
    await expect(renderOrgLogo({ buffer: big })).rejects.toThrow(/limite para a logo/);
    await expect(renderOrgLogo({ buffer: await solid(40, 40) })).rejects.toThrow(/mínimo/);
    await expect(renderOrgLogo({ buffer: await solid(7000, 100) })).rejects.toThrow(/máximo/);
    await expect(renderOrgLogo({ buffer: await solid(200, 200), crop: { x: 5, y: 5, size: 0.5 } })).rejects.toThrow(
      /fora da imagem/,
    );
  });

  it("grava no armazenamento, referencia no banco e aparece para o ator e no seletor", async () => {
    const res = await saveOrgLogo(a.actor, { buffer: await solid(300, 300) });
    expect(res.changed).toBe(true);
    const row = await orgRow(a.org.id);
    expect(row.logoKey).toBe(`${a.org.id}/branding/logo-${row.logoHash!.slice(0, 32)}.png`);
    expect(await getStorage().exists(row.logoKey!)).toBe(true);
    expect(res.src).toBe(orgLogoPath(a.org.id, row.logoHash!));

    // Nova sessão / outro dispositivo: o ator relido traz a mesma logo.
    const again = await resolveActor(a.owner.id, a.org.slug);
    expect(again?.orgLogoSrc).toBe(res.src);
    const orgs = await listUserOrganizations(a.owner.id);
    expect(orgs.find((o) => o.id === a.org.id)?.logoSrc).toBe(res.src);
  });

  it("não regrava a mesma imagem e apaga o arquivo antigo ao substituir", async () => {
    const before = await orgRow(a.org.id);
    const same = await saveOrgLogo(a.actor, { buffer: await solid(300, 300) });
    expect(same.changed).toBe(false);
    expect((await orgRow(a.org.id)).logoKey).toBe(before.logoKey);

    const replaced = await saveOrgLogo(a.actor, { buffer: await solid(300, 300, "#c08552") });
    expect(replaced.changed).toBe(true);
    const after = await orgRow(a.org.id);
    expect(after.logoKey).not.toBe(before.logoKey);
    expect(await getStorage().exists(before.logoKey!)).toBe(false);
    expect(await getStorage().exists(after.logoKey!)).toBe(true);
  });

  it("só quem gerencia a agência altera a logo", async () => {
    const designer = await addMember(a.org.slug, a.org.id, "designer");
    const clientId = (await as(a.actor, (s) => createClient(s, { name: "Cliente Logo" }))).id;
    const guest = await addMember(a.org.slug, a.org.id, "client_admin", { clientIds: [clientId] });
    const png = await solid(200, 200, "#000000");
    await expect(saveOrgLogo(designer, { buffer: png })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(saveOrgLogo(guest, { buffer: png })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(removeOrgLogo(designer)).rejects.toBeInstanceOf(ForbiddenError);
    // Membros (equipe e cliente) podem ver a logo.
    expect(await readOrgLogo(a.org.id, designer.userId)).not.toBeNull();
    expect(await readOrgLogo(a.org.id, guest.userId)).not.toBeNull();
  });

  it("isola as agências: uma não altera nem lê a logo da outra", async () => {
    const aBefore = await orgRow(a.org.id);
    await saveOrgLogo(b.actor, { buffer: await solid(256, 256, "#2a7f62") });
    const aAfter = await orgRow(a.org.id);
    expect(aAfter.logoHash).toBe(aBefore.logoHash);
    const bRow = await orgRow(b.org.id);
    expect(bRow.logoKey!.startsWith(`${b.org.id}/`)).toBe(true);
    expect(bRow.logoHash).not.toBe(aAfter.logoHash);

    expect(await readOrgLogo(a.org.id, b.owner.id)).toBeNull();
    expect(await readOrgLogo(b.org.id, a.owner.id)).toBeNull();
    expect(await readOrgLogo("nao-e-um-id", a.owner.id)).toBeNull();
    const own = await readOrgLogo(a.org.id, a.owner.id);
    expect(own?.hash).toBe(aAfter.logoHash);
    expect((await sharp(own!.body).metadata()).width).toBe(512);
  });

  it("remove a logo (e o link legado) sem tocar nos demais dados", async () => {
    await withSystem((tx) =>
      tx.update(organizations).set({ logoUrl: "https://exemplo.com/logo.png" }).where(eq(organizations.id, a.org.id)),
    );
    const before = await orgRow(a.org.id);
    expect((await removeOrgLogo(a.actor)).removed).toBe(true);
    const after = await orgRow(a.org.id);
    expect([after.logoKey, after.logoHash, after.logoUrl]).toEqual([null, null, null]);
    expect(after.name).toBe(before.name);
    expect(after.slug).toBe(before.slug);
    expect(after.settings).toEqual(before.settings);
    expect(await getStorage().exists(before.logoKey!)).toBe(false);
    expect(await readOrgLogo(a.org.id, a.owner.id)).toBeNull();
    expect((await resolveActor(a.owner.id, a.org.slug))?.orgLogoSrc).toBeNull();
    // A outra agência continua com a logo dela.
    expect(await readOrgLogo(b.org.id, b.owner.id)).not.toBeNull();
    expect((await removeOrgLogo(a.actor)).removed).toBe(false);
  });
});
