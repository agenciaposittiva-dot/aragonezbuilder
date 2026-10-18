import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@/server/services/clients";
import { getFile, getVersionForDownload, listFiles, setFileShared, storeUpload } from "@/server/services/files";
import { sniffFileType } from "@/server/services/file-type";
import { processFileVersion } from "@/server/services/file-processing";
import { signDownload, verifyDownload } from "@/server/storage/signing";
import { addMember, as, createOrgWithOwner, resetDb } from "./helpers";

async function png(w = 40, h = 30) {
  return sharp({ create: { width: w, height: h, channels: 3, background: { r: 244, g: 191, b: 47 } } })
    .png()
    .toBuffer();
}

describe("central de arquivos", () => {
  let ctx: Awaited<ReturnType<typeof createOrgWithOwner>>;
  let clientA: string;
  let clientB: string;

  beforeAll(async () => {
    await resetDb();
    ctx = await createOrgWithOwner("Agência Arquivos");
    clientA = (await as(ctx.actor, (s) => createClient(s, { name: "Cliente A" }))).id;
    clientB = (await as(ctx.actor, (s) => createClient(s, { name: "Cliente B" }))).id;
  });

  it("identifica o tipo real pelos bytes, ignorando a extensão", async () => {
    expect(sniffFileType(await png(), "foto.pdf")?.mime).toBe("image/png");
    expect(sniffFileType(Buffer.from("%PDF-1.7\n..."), "x.png")?.mime).toBe("application/pdf");
    expect(sniffFileType(Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]), "app.exe")).toBeNull();
  });

  it("recusa tipo não permitido", async () => {
    const exe = Buffer.concat([Buffer.from([0x4d, 0x5a, 0x90, 0x00]), Buffer.alloc(64, 0)]);
    await expect(
      as(ctx.actor, (s) => storeUpload(s, { buffer: exe, originalName: "setup.exe" }, { clientId: clientA })),
    ).rejects.toThrow(/não reconhecido|não permitido/i);
    const html = Buffer.from("<!doctype html><html><script>alert(1)</script></html>");
    await expect(
      as(ctx.actor, (s) => storeUpload(s, { buffer: html, originalName: "a.txt" }, { clientId: clientA })),
    ).rejects.toThrow(/não permitido/i);
  });

  it("recusa arquivo acima do limite da organização", async () => {
    const small = {
      ...ctx.actor,
      settings: { ...ctx.actor.settings, uploads: { ...ctx.actor.settings.uploads, maxBytes: 100 } },
    };
    await expect(
      as(small, async (s) => storeUpload(s, { buffer: await png(200, 200), originalName: "g.png" }, {})),
    ).rejects.toThrow(/limite/i);
  });

  it("cria versões sequenciais e gera miniatura", async () => {
    const first = await as(ctx.actor, async (s) =>
      storeUpload(s, { buffer: await png(), originalName: "Peça.png" }, { clientId: clientA, category: "deliverable" }),
    );
    expect(first.versionNumber).toBe(1);
    const second = await as(ctx.actor, async (s) =>
      storeUpload(s, { buffer: await png(80, 60), originalName: "Peça v2.png" }, { fileId: first.fileId }),
    );
    expect(second.versionNumber).toBe(2);
    await processFileVersion(ctx.org.id, second.versionId);
    const detail = await as(ctx.actor, (s) => getFile(s, first.fileId));
    expect(detail.file.currentVersionId).toBe(second.versionId);
    expect(detail.versions.map((v) => v.versionNumber)).toEqual([2, 1]);
    expect(detail.versions[0]?.width).toBe(80);
    expect(detail.versions[0]?.hasThumbnail).toBe(true);
  });

  it("cliente vê apenas arquivos compartilhados do próprio cliente", async () => {
    const shared = await as(ctx.actor, async (s) =>
      storeUpload(s, { buffer: await png(), originalName: "aprovar.png" }, { clientId: clientA }),
    );
    const hidden = await as(ctx.actor, async (s) =>
      storeUpload(s, { buffer: await png(), originalName: "interno.png" }, { clientId: clientA }),
    );
    const other = await as(ctx.actor, async (s) =>
      storeUpload(s, { buffer: await png(), originalName: "outro.png" }, { clientId: clientB }),
    );
    await as(ctx.actor, (s) => setFileShared(s, shared.fileId, true));
    await as(ctx.actor, (s) => setFileShared(s, other.fileId, true));

    const clientUser = await addMember(ctx.org.slug, ctx.org.id, "client", { clientIds: [clientA] });
    const list = await as(clientUser, (s) => listFiles(s, {}));
    expect(list.rows.map((r) => r.id)).toEqual([shared.fileId]);
    await expect(as(clientUser, (s) => getFile(s, hidden.fileId))).rejects.toThrow(/não encontrado/i);
    await expect(as(clientUser, (s) => getVersionForDownload(s, other.versionId))).rejects.toThrow(/não encontrado/i);
  });

  it("cliente não envia arquivos soltos (apenas anexos de solicitação)", async () => {
    const clientUser = await addMember(ctx.org.slug, ctx.org.id, "client", { clientIds: [clientA] });
    await expect(
      as(clientUser, async (s) =>
        storeUpload(s, { buffer: await png(), originalName: "x.png" }, { clientId: clientA }),
      ),
    ).rejects.toThrow(/solicitação/i);
  });

  it("link assinado recusa assinatura adulterada e link expirado", () => {
    const claims = {
      key: "org/file/v-a.png",
      exp: Math.floor(Date.now() / 1000) + 60,
      name: "a.png",
      disposition: "inline" as const,
      type: "image/png",
    };
    const sig = signDownload(claims);
    expect(verifyDownload(claims, sig)).toBe(true);
    expect(verifyDownload({ ...claims, key: "org/outro/v-b.png" }, sig)).toBe(false);
    expect(verifyDownload(claims, sig.slice(0, -2) + "xx")).toBe(false);
    const expired = { ...claims, exp: Math.floor(Date.now() / 1000) - 1 };
    expect(verifyDownload(expired, signDownload(expired))).toBe(false);
  });
});
