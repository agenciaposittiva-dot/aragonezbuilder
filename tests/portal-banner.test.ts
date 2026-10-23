import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import {
  assetFileId,
  bannerSlideIndex,
  bannerSlideKey,
  parsePortalAssetKey,
  portalAssetFileIds,
  portalSettingsSchema,
} from "@/lib/portal-settings";
import type { Actor } from "@/server/authz/actor";
import { ValidationError } from "@/server/errors";
import { getPublishedPortal, publishPortal, resolvePortalAsset, savePortalDraft } from "@/server/services/client-portal";
import { createClient } from "@/server/services/clients";
import { storeUpload } from "@/server/services/files";
import { as, createOrgWithOwner, resetDb } from "./helpers";

/*
 * Banners extras do portal: com 2 ou mais banners o início vira um carrossel.
 * Cada banner extra tem imagem própria, entregue pela chave "bannerN", com a
 * mesma regra de segurança do banner principal (só imagens do próprio cliente,
 * nunca públicas).
 */

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

describe("chaves e esquema dos banners extras", () => {
  it("bannerN mapeia para banner.slides (N de 2 a 10)", () => {
    expect(bannerSlideKey(0)).toBe("banner2");
    expect(bannerSlideIndex("banner2")).toBe(0);
    expect(bannerSlideIndex("banner10")).toBe(8);
    for (const bad of ["banner", "banner1", "banner0", "banner11", "banner02", "bannerx", "logo"]) {
      expect(bannerSlideIndex(bad)).toBeNull();
    }
    expect(parsePortalAssetKey("banner")).toBe("banner");
    expect(parsePortalAssetKey("banner3")).toBe("banner3");
    expect(parsePortalAssetKey("banner1")).toBeNull();
    expect(parsePortalAssetKey("qualquer")).toBeNull();
  });

  it("padrões de rolagem, limites e links seguros", () => {
    const s = portalSettingsSchema.parse({ banner: { slides: [{ title: "Dois" }] } });
    expect(s.banner.autoplay).toBe(true);
    expect(s.banner.interval).toBe(7);
    expect(s.banner.slides[0]).toMatchObject({ title: "Dois", imageFileId: null, focalX: 50, focalY: 50 });
    expect(portalSettingsSchema.safeParse({ banner: { slides: Array.from({ length: 10 }, () => ({})) } }).success).toBe(
      false,
    );
    expect(portalSettingsSchema.safeParse({ banner: { interval: 1 } }).success).toBe(false);
    expect(portalSettingsSchema.safeParse({ banner: { interval: 31 } }).success).toBe(false);
    expect(portalSettingsSchema.safeParse({ banner: { slides: [{ buttonUrl: "javascript:alert(1)" }] } }).success).toBe(
      false,
    );
  });

  it("lista todos os arquivos referenciados, inclusive os dos banners extras", () => {
    const s = portalSettingsSchema.parse({
      logoFileId: A,
      banner: { imageFileId: A, slides: [{ imageFileId: B }, { imageFileId: null }] },
    });
    expect(portalAssetFileIds(s)).toEqual([A, B]);
    expect(assetFileId(s, "banner")).toBe(A);
    expect(assetFileId(s, "banner2")).toBe(B);
    expect(assetFileId(s, "banner3")).toBeNull();
    expect(assetFileId(s, "banner4")).toBeNull();
  });
});

describe("banners extras no portal", () => {
  let actor: Actor;
  let alfa: string;
  let beta: string;
  let capa1: string;
  let capa2: string;
  let capaBeta: string;

  const png = (color: string) =>
    sharp({ create: { width: 48, height: 16, channels: 3, background: color } })
      .png()
      .toBuffer();
  const upload = (clientId: string, name: string, color: string) =>
    as(actor, async (s) =>
      storeUpload(s, { buffer: await png(color), originalName: name }, { clientId, category: "brand_asset" }),
    ).then((r) => r.fileId);

  beforeAll(async () => {
    await resetDb();
    actor = (await createOrgWithOwner("Agência Carrossel")).actor;
    alfa = (await as(actor, (s) => createClient(s, { name: "Alfa" }))).id;
    beta = (await as(actor, (s) => createClient(s, { name: "Beta" }))).id;
    capa1 = await upload(alfa, "capa-1.png", "#0b0b0b");
    capa2 = await upload(alfa, "capa-2.png", "#c3f23a");
    capaBeta = await upload(beta, "capa-beta.png", "#ffffff");
  });

  it("publica banners extras e entrega cada imagem pela própria chave", async () => {
    await as(actor, (s) =>
      savePortalDraft(s, alfa, {
        banner: { imageFileId: capa1, slides: [{ imageFileId: capa2, title: "Segundo" }], interval: 5 },
      }),
    );
    await as(actor, (s) => publishPortal(s, alfa));
    const pub = await as(actor, (s) => getPublishedPortal(s, alfa));
    expect(pub.settings.banner.slides[0]).toMatchObject({ imageFileId: capa2, title: "Segundo" });
    expect(pub.settings.banner.interval).toBe(5);

    const main = await resolvePortalAsset(alfa, "banner");
    const second = await resolvePortalAsset(alfa, "banner2");
    expect(main?.versionId).toBeTruthy();
    expect(second?.versionId).toBeTruthy();
    expect(second?.versionId).not.toBe(main?.versionId);
    expect(second?.public).toBe(false);
    expect(await resolvePortalAsset(alfa, "banner3")).toBeNull();
  });

  it("recusa imagem de outro cliente num banner extra", async () => {
    await expect(
      as(actor, (s) => savePortalDraft(s, alfa, { banner: { slides: [{ imageFileId: capaBeta }] } })),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
