import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import type { Actor } from "@/server/authz/actor";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import { contrastIssues, portalSettingsSchema } from "@/lib/portal-settings";
import { portalImageLibrary, savePortalDraft } from "@/server/services/client-portal";
import { createClient } from "@/server/services/clients";
import { storeUpload } from "@/server/services/files";
import { addMember, as, createOrgWithOwner, resetDb } from "./helpers";

async function png() {
  return sharp({ create: { width: 16, height: 16, channels: 3, background: "#123456" } })
    .png()
    .toBuffer();
}

describe("personalização do portal: tela interna", () => {
  let ctx: Awaited<ReturnType<typeof createOrgWithOwner>>;
  let other: Awaited<ReturnType<typeof createOrgWithOwner>>;
  let alfa: string;
  let beta: string;
  let guest: Actor;
  let imageAlfa: string;

  beforeAll(async () => {
    await resetDb();
    ctx = await createOrgWithOwner("Agência Tela Portal");
    other = await createOrgWithOwner("Outra Agência");
    alfa = (await as(ctx.actor, (s) => createClient(s, { name: "Alfa" }))).id;
    beta = (await as(ctx.actor, (s) => createClient(s, { name: "Beta" }))).id;
    guest = await addMember(ctx.org.slug, ctx.org.id, "client_admin", { clientIds: [alfa] });
    imageAlfa = (
      await as(ctx.actor, async (s) =>
        storeUpload(s, { buffer: await png(), originalName: "logo.png" }, { clientId: alfa, category: "brand_logo" }),
      )
    ).fileId;
    await as(ctx.actor, (s) =>
      storeUpload(s, { buffer: Buffer.from("%PDF-1.7\n%…\n"), originalName: "manual.pdf" }, { clientId: alfa }),
    );
    await as(ctx.actor, async (s) =>
      storeUpload(s, { buffer: await png(), originalName: "beta.png" }, { clientId: beta }),
    );
  });

  it("a biblioteca lista só imagens do próprio cliente", async () => {
    const list = await as(ctx.actor, (s) => portalImageLibrary(s, alfa));
    expect(list.map((i) => i.id)).toEqual([imageAlfa]);
    expect(list[0]?.versionId).toBeTruthy();
  });

  it("convidados e outras agências não acessam a biblioteca", async () => {
    await expect(as(guest, (s) => portalImageLibrary(s, alfa))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(as(other.actor, (s) => portalImageLibrary(s, alfa))).rejects.toBeInstanceOf(NotFoundError);
  });

  it("fundo escuro sem cor de texto usa texto legível (mesma regra do tema)", async () => {
    const dark = portalSettingsSchema.parse({ colors: { background: "#101418" } });
    expect(contrastIssues(dark)).toEqual([]);
    const saved = await as(ctx.actor, (s) => savePortalDraft(s, alfa, { colors: { background: "#101418" } }));
    expect(saved.colors.background).toBe("#101418");
    const bad = portalSettingsSchema.parse({ colors: { background: "#101418", text: "#202020" } });
    expect(contrastIssues(bad)).toHaveLength(1);
  });
});
