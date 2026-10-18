import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import type { Actor } from "@/server/authz/actor";
import { narrowActorToClient } from "@/server/auth/portal";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import {
  getPortalAdmin,
  getPublishedPortal,
  publishPortal,
  resolvePortalAsset,
  resolvePublicPortal,
  restorePortalDraft,
  savePortalDraft,
  updatePortalAccess,
} from "@/server/services/client-portal";
import { createClient } from "@/server/services/clients";
import { deleteFile, storeUpload } from "@/server/services/files";
import { addMember, as, createOrgWithOwner, resetDb } from "./helpers";

async function png(color = "#1f3a5f") {
  return sharp({ create: { width: 24, height: 24, channels: 3, background: color } })
    .png()
    .toBuffer();
}

describe("portal do cliente: personalização e acesso", () => {
  let a: Awaited<ReturnType<typeof createOrgWithOwner>>;
  let b: Awaited<ReturnType<typeof createOrgWithOwner>>;
  let alfa: string;
  let beta: string;
  let guest: Actor;
  let designer: Actor;
  let logoAlfa: string;
  let imageBeta: string;

  beforeAll(async () => {
    await resetDb();
    a = await createOrgWithOwner("Agência Portal A");
    b = await createOrgWithOwner("Agência Portal B");
    alfa = (await as(a.actor, (s) => createClient(s, { name: "Empresa Alfa" }))).id;
    beta = (await as(a.actor, (s) => createClient(s, { name: "Empresa Beta" }))).id;
    guest = await addMember(a.org.slug, a.org.id, "client_admin", { name: "Convidado", clientIds: [alfa] });
    designer = await addMember(a.org.slug, a.org.id, "designer", { name: "Designer" });
    logoAlfa = (
      await as(a.actor, async (s) =>
        storeUpload(s, { buffer: await png(), originalName: "logo.png" }, { clientId: alfa, category: "brand_logo" }),
      )
    ).fileId;
    imageBeta = (
      await as(a.actor, async (s) =>
        storeUpload(s, { buffer: await png("#c08552"), originalName: "capa.png" }, { clientId: beta }),
      )
    ).fileId;
  });

  it("cada cliente recebe um endereço único e não reservado", async () => {
    const ids = await as(a.actor, async (s) => [
      (await createClient(s, { name: "Café Ação" })).id,
      (await createClient(s, { name: "Café Ação" })).id,
      (await createClient(s, { name: "Entrar" })).id,
    ]);
    const views = await as(a.actor, async (s) => Promise.all(ids.map((id) => getPortalAdmin(s, id))));
    expect(views.map((v) => v.client.slug)).toEqual(["cafe-acao", "cafe-acao-2", "entrar-cliente"]);
  });

  it("só a equipe com permissão edita a personalização", async () => {
    await expect(as(guest, (s) => savePortalDraft(s, alfa, {}))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(as(designer, (s) => savePortalDraft(s, alfa, {}))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(as(b.actor, (s) => savePortalDraft(s, alfa, {}))).rejects.toBeInstanceOf(NotFoundError);
  });

  it("valida contraste, links e imagens de outro cliente", async () => {
    await expect(
      as(a.actor, (s) => savePortalDraft(s, alfa, { colors: { background: "#ffffff", text: "#eeeeee" } })),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      as(a.actor, (s) => savePortalDraft(s, alfa, { links: [{ label: "x", url: "javascript:alert(1)" }] })),
    ).rejects.toThrow();
    await expect(as(a.actor, (s) => savePortalDraft(s, alfa, { logoFileId: imageBeta }))).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("rascunho não aparece até publicar; publicação gera versão", async () => {
    await as(a.actor, (s) =>
      savePortalDraft(s, alfa, {
        displayName: "Alfa Rascunho",
        logoFileId: logoAlfa,
        colors: { primary: "#1f3a5f" },
        banner: { title: "Bem-vindos" },
      }),
    );
    let pub = await resolvePublicPortal(a.org.slug, "empresa-alfa");
    expect(pub?.settings.displayName).toBeNull();
    expect(await resolvePortalAsset(alfa, "logo")).toBeNull();
    const draftLogo = await resolvePortalAsset(alfa, "logo", { draft: true });
    expect(draftLogo?.public).toBe(false);

    const { version } = await as(a.actor, (s) => publishPortal(s, alfa));
    expect(version).toBe(1);
    pub = await resolvePublicPortal(a.org.slug, "empresa-alfa");
    expect(pub?.settings.displayName).toBe("Alfa Rascunho");
    expect(pub?.settings.colors.primary).toBe("#1f3a5f");
    const logo = await resolvePortalAsset(alfa, "logo");
    expect(logo?.public).toBe(true);

    const forGuest = await as(guest, (s) => getPublishedPortal(s, alfa));
    expect(forGuest.settings.banner.title).toBe("Bem-vindos");
    await expect(as(guest, (s) => getPublishedPortal(s, beta))).rejects.toBeInstanceOf(NotFoundError);
  });

  it("restaura o padrão da agência e versões anteriores no rascunho", async () => {
    let draft = await as(a.actor, (s) => restorePortalDraft(s, alfa));
    expect(draft.displayName).toBeNull();
    draft = await as(a.actor, (s) => restorePortalDraft(s, alfa, 1));
    expect(draft.displayName).toBe("Alfa Rascunho");
    const view = await as(a.actor, (s) => getPortalAdmin(s, alfa));
    expect(view.versions.map((v) => v.version)).toEqual([1]);
  });

  it("banner nunca é público e arquivos excluídos deixam de ser entregues", async () => {
    const banner = (
      await as(a.actor, async (s) =>
        storeUpload(s, { buffer: await png("#222222"), originalName: "banner.png" }, { clientId: alfa }),
      )
    ).fileId;
    await as(a.actor, (s) => savePortalDraft(s, alfa, { banner: { imageFileId: banner } }));
    await as(a.actor, (s) => publishPortal(s, alfa));
    expect((await resolvePortalAsset(alfa, "banner"))?.public).toBe(false);
    await as(a.actor, (s) => deleteFile(s, banner));
    expect(await resolvePortalAsset(alfa, "banner")).toBeNull();
  });

  it("endereço: conflito, reservado e login desativado", async () => {
    await expect(
      as(a.actor, (s) =>
        updatePortalAccess(s, beta, { slug: "empresa-alfa", loginEnabled: true, allowGuestInvites: false }),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      as(a.actor, (s) =>
        updatePortalAccess(s, beta, { slug: "approvals", loginEnabled: true, allowGuestInvites: false }),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    await as(a.actor, (s) =>
      updatePortalAccess(s, beta, { slug: "beta", loginEnabled: false, allowGuestInvites: true }),
    );
    const pub = await resolvePublicPortal(a.org.slug, "beta");
    expect(pub?.loginEnabled).toBe(false);
    expect(await resolvePublicPortal(b.org.slug, "beta")).toBeNull();
  });

  it("a restrição ao cliente do endereço nunca amplia o acesso", () => {
    expect(narrowActorToClient(guest, alfa)?.clientIds).toEqual([alfa]);
    expect(narrowActorToClient(guest, beta)).toBeNull();
    expect(narrowActorToClient(a.actor, alfa)).toBeNull();
  });
});
