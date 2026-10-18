import { eq, sql } from "drizzle-orm";
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { resolveActor, type Actor } from "@/server/authz/actor";
import { withSystem } from "@/server/db";
import { designs, designVersions, files, fileVersions } from "@/server/db/schema";
import { dispatchPendingEvents } from "@/server/events/dispatcher";
import { ConflictError, ForbiddenError, LimitError, NotFoundError, ValidationError } from "@/server/errors";
import { createClient } from "@/server/services/clients";
import {
  compareDesignVersions,
  createNamedVersion,
  listDesignVersions,
  resolveDesignConflict,
  restoreDesignVersion,
} from "@/server/services/design-versions";
import { createDesign, getDesign, saveDesign } from "@/server/services/designs";
import {
  deleteFile,
  duplicateFile,
  getFile,
  listFiles,
  patchFile,
  saveFolder,
  setFileArchived,
  setFileShared,
  storageUsage,
  storeUpload,
} from "@/server/services/files";
import { updateSettings } from "@/server/services/organizations";
import { listTrash, purgeExpiredTrash, purgeFromTrash, restoreFromTrash } from "@/server/services/trash";
import { getStorage } from "@/server/storage";
import { addMember, as, createOrgWithOwner, resetDb } from "./helpers";

const png = (c = 10, w = 40) =>
  sharp({ create: { width: w, height: 30, channels: 3, background: { r: c, g: 120, b: 200 } } })
    .png()
    .toBuffer();

const doc = (texts: string[]) => ({
  version: "7",
  background: "#ffffff",
  objects: texts.map((t, i) => ({ type: "textbox", uid: `t${i}`, text: t, left: 10 * i, top: 10 })),
});

type Ctx = Awaited<ReturnType<typeof createOrgWithOwner>>;

/** Envelhece as versões da arte para o próximo salvamento cair num novo ponto de controle. */
async function ageVersions(designId: string, minutes = 60) {
  await withSystem((tx) =>
    tx
      .update(designVersions)
      .set({ createdAt: sql`${designVersions.createdAt} - make_interval(mins => ${minutes})` })
      .where(eq(designVersions.designId, designId)),
  );
}

describe("nuvem: versões das artes", () => {
  let a: Ctx;
  let b: Ctx;
  let clientId: string;

  beforeAll(async () => {
    await resetDb();
    a = await createOrgWithOwner("Agência Nuvem A");
    b = await createOrgWithOwner("Agência Nuvem B");
    clientId = (await as(a.actor, (s) => createClient(s, { name: "Cliente Nuvem" }))).id;
  });

  async function newDesign(name = "Post") {
    return (await as(a.actor, (s) => createDesign(s, { name, width: 1080, height: 1080, clientId }))).id;
  }

  it("cria pontos de controle agrupados, não a cada salvamento", async () => {
    const id = await newDesign();
    let revision = 1;
    for (let i = 0; i < 5; i++) {
      revision = (await as(a.actor, (s) => saveDesign(s, { id, revision, document: doc([`v${i}`]) }))).revision;
    }
    let versions = await as(a.actor, (s) => listDesignVersions(s, id));
    expect(versions).toHaveLength(1);
    await ageVersions(id);
    revision = (await as(a.actor, (s) => saveDesign(s, { id, revision, document: doc(["depois"]) }))).revision;
    versions = await as(a.actor, (s) => listDesignVersions(s, id));
    expect(versions).toHaveLength(2);
    expect(versions[0]!.revision).toBe(revision);
    expect(versions[0]!.kind).toBe("auto");
  });

  it("versão nomeada, comparação e restauração sem perder o histórico", async () => {
    const id = await newDesign("Campanha");
    let revision = (await as(a.actor, (s) => saveDesign(s, { id, revision: 1, document: doc(["Olá", "Mundo"]) })))
      .revision;
    const named = await as(a.actor, (s) => createNamedVersion(s, { designId: id, label: "Aprovada pelo cliente" }));
    revision = (await as(a.actor, (s) => saveDesign(s, { id, revision, document: doc(["Olá", "Planeta", "Novo"]) })))
      .revision;
    const all = await as(a.actor, (s) => listDesignVersions(s, id));
    const namedRow = all.find((v) => v.versionNumber === named.versionNumber)!;
    expect(namedRow.kind).toBe("named");
    expect(namedRow.label).toBe("Aprovada pelo cliente");

    const cmp = await as(a.actor, (s) => compareDesignVersions(s, namedRow.id, "current"));
    expect(cmp.added).toEqual(["Texto “Novo”"]);
    expect(cmp.textChanged).toEqual([{ from: "Mundo", to: "Planeta" }]);

    const before = all.length;
    const res = await as(a.actor, (s) => restoreDesignVersion(s, namedRow.id));
    expect(res.revision).toBe(revision + 1);
    const d = await as(a.actor, (s) => getDesign(s, id));
    expect((d.design.document as ReturnType<typeof doc>).objects.map((o) => o.text)).toEqual(["Olá", "Mundo"]);
    const after = await as(a.actor, (s) => listDesignVersions(s, id));
    // "Antes de restaurar" + "Restaurada": nada some do histórico.
    expect(after.length).toBe(before + 2);
    expect(after[0]!.kind).toBe("restore");
    expect(after[1]!.label).toMatch(/Antes de restaurar/);
  });

  it("conflito entre sessões: as duas versões ficam guardadas", async () => {
    const id = await newDesign("Conflito");
    const r1 = (await as(a.actor, (s) => saveDesign(s, { id, revision: 1, document: doc(["Sessão A"]) }))).revision;
    // Sessão B ainda estava na revisão 1.
    await expect(
      as(a.actor, (s) => saveDesign(s, { id, revision: 1, document: doc(["Sessão B"]) })),
    ).rejects.toBeInstanceOf(ConflictError);
    const theirs = await as(a.actor, (s) =>
      resolveDesignConflict(s, { designId: id, strategy: "theirs", document: doc(["Sessão B"]) }),
    );
    expect(theirs.revision).toBe(r1);
    expect((theirs.document as ReturnType<typeof doc>).objects[0]!.text).toBe("Sessão A");
    const mine = await as(a.actor, (s) =>
      resolveDesignConflict(s, { designId: id, strategy: "mine", document: doc(["Sessão B de novo"]) }),
    );
    expect(mine.revision).toBe(r1 + 1);
    const versions = await as(a.actor, (s) => listDesignVersions(s, id));
    const conflicts = versions.filter((v) => v.kind === "conflict");
    expect(conflicts.map((v) => v.label)).toEqual([
      "Versão de outra sessão (conflito de edição)",
      "Suas alterações (conflito de edição)",
    ]);
    const kept = await withSystem((tx) =>
      tx
        .select({ document: designVersions.document })
        .from(designVersions)
        .where(eq(designVersions.id, conflicts[0]!.id)),
    );
    expect(JSON.stringify(kept[0]!.document)).toContain("Sessão A");
  });

  it("retenção poda só as versões automáticas antigas", async () => {
    await as(a.actor, (s) => updateSettings(s, "storage", { designVersionRetention: 5 }));
    const owner = (await resolveActor(a.owner.id, a.org.slug))!;
    const id = (await as(owner, (s) => createDesign(s, { name: "Retenção", width: 100, height: 100 }))).id;
    await as(owner, (s) => createNamedVersion(s, { designId: id, label: "Marco" }));
    let revision = 1;
    for (let i = 0; i < 9; i++) {
      await ageVersions(id);
      revision = (await as(owner, (s) => saveDesign(s, { id, revision, document: doc([`r${i}`]) }))).revision;
    }
    const versions = await as(owner, (s) => listDesignVersions(s, id));
    expect(versions.filter((v) => v.kind === "auto")).toHaveLength(5);
    expect(versions.filter((v) => v.kind === "named")).toHaveLength(1);
    await as(owner, (s) => updateSettings(s, "storage", { designVersionRetention: 50 }));
  });

  it("isolamento: outra agência, cliente e papéis sem permissão não acessam versões", async () => {
    const id = await newDesign("Privada");
    await as(a.actor, (s) => saveDesign(s, { id, revision: 1, document: doc(["x"]) }));
    const [v] = await as(a.actor, (s) => listDesignVersions(s, id));
    await expect(as(b.actor, (s) => listDesignVersions(s, id))).rejects.toBeInstanceOf(NotFoundError);
    await expect(as(b.actor, (s) => restoreDesignVersion(s, v!.id))).rejects.toBeInstanceOf(NotFoundError);
    const guest = await addMember(a.org.slug, a.org.id, "client_admin", { clientIds: [clientId] });
    await expect(as(guest, (s) => listDesignVersions(s, id))).rejects.toBeInstanceOf(ForbiddenError);
    const finance = await addMember(a.org.slug, a.org.id, "finance");
    await expect(as(finance, (s) => restoreDesignVersion(s, v!.id))).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("nuvem: arquivos, cota e lixeira", () => {
  let a: Ctx;
  let b: Ctx;
  let clientA: string;
  let clientB: string;
  let designer: Actor;

  beforeAll(async () => {
    await resetDb();
    a = await createOrgWithOwner("Agência Arquivos Nuvem");
    b = await createOrgWithOwner("Outra Agência");
    clientA = (await as(a.actor, (s) => createClient(s, { name: "Alfa" }))).id;
    clientB = (await as(a.actor, (s) => createClient(s, { name: "Beta" }))).id;
    designer = await addMember(a.org.slug, a.org.id, "designer");
  });

  const upload = (actor: Actor, meta: Parameters<typeof storeUpload>[2], name = "peca.png", c = 10) =>
    as(actor, async (s) => storeUpload(s, { buffer: await png(c), originalName: name }, meta));

  it("duplicar copia o objeto no armazenamento; renomear e mover respeitam o cliente", async () => {
    const f = await upload(a.actor, { clientId: clientA, category: "brand_logo" }, "logo.png");
    const copy = await as(a.actor, (s) => duplicateFile(s, f.fileId));
    const [orig, dup] = await withSystem((tx) =>
      tx
        .select({ fileId: fileVersions.fileId, key: fileVersions.storageKey, sum: fileVersions.checksumSha256 })
        .from(fileVersions)
        .where(sql`${fileVersions.fileId} in (${f.fileId}, ${copy.fileId})`)
        .orderBy(sql`${fileVersions.fileId} = ${f.fileId} desc`),
    );
    expect(dup!.key).not.toBe(orig!.key);
    expect(dup!.sum).toBe(orig!.sum);
    expect(await getStorage().exists(dup!.key)).toBe(true);
    expect((await as(a.actor, (s) => getFile(s, copy.fileId))).file.name).toBe("logo (cópia).png");

    await as(a.actor, (s) => patchFile(s, { id: copy.fileId, name: "logo-escuro.png" }));
    const folderB = await as(a.actor, (s) => saveFolder(s, { name: "Beta", clientId: clientB }));
    await expect(as(a.actor, (s) => patchFile(s, { id: copy.fileId, folderId: folderB.id }))).rejects.toBeInstanceOf(
      ValidationError,
    );
    const folderA = await as(a.actor, (s) => saveFolder(s, { name: "Logos", clientId: clientA }));
    await as(a.actor, (s) => patchFile(s, { id: copy.fileId, folderId: folderA.id }));
    const moved = await as(a.actor, (s) => getFile(s, copy.fileId));
    expect(moved.file.folderId).toBe(folderA.id);
    expect(moved.file.name).toBe("logo-escuro.png");
  });

  it("filtros da Minha Nuvem: tipo, grupo, seções e ordem", async () => {
    const pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");
    const doc1 = await as(a.actor, (s) =>
      storeUpload(s, { buffer: pdf, originalName: "contrato.pdf" }, { clientId: clientA, category: "document" }),
    );
    const internal = await upload(a.actor, { category: "general" }, "interno.png", 30);
    const shared = await upload(a.actor, { clientId: clientB, category: "deliverable" }, "arte.png", 40);
    await as(a.actor, (s) => setFileShared(s, shared.fileId, true));
    const ids = async (p: Parameters<typeof listFiles>[1]) =>
      (await as(a.actor, (s) => listFiles(s, p))).rows.map((r) => r.id);
    expect(await ids({ type: "pdf" })).toEqual([doc1.fileId]);
    expect(await ids({ kind: "docs" })).toEqual([doc1.fileId]);
    expect(await ids({ section: "internal" })).toEqual([internal.fileId]);
    expect(await ids({ section: "shared" })).toEqual([shared.fileId]);
    const byName = (await as(a.actor, (s) => listFiles(s, { sort: "name" }))).rows.map((r) => r.name);
    expect(byName).toEqual([...byName].sort((x, y) => x.localeCompare(y)));

    await as(a.actor, (s) => setFileArchived(s, shared.fileId, true));
    expect(await ids({})).not.toContain(shared.fileId);
    expect(await ids({ section: "archived" })).toEqual([shared.fileId]);
    await as(a.actor, (s) => setFileArchived(s, shared.fileId, false));
    expect((await as(a.actor, (s) => getFile(s, shared.fileId))).file.status).toBe("draft");
  });

  it("cota da agência: uso real e envio recusado acima do limite", async () => {
    const usage = await as(a.actor, (s) => storageUsage(s));
    expect(usage.usedBytes).toBeGreaterThan(0);
    expect(usage.quotaBytes).toBeNull();
    await as(a.actor, (s) => updateSettings(s, "storage", { quotaBytes: usage.usedBytes + 10 }));
    const owner = (await resolveActor(a.owner.id, a.org.slug))!;
    const limited = await as(owner, (s) => storageUsage(s));
    expect(limited.alert).toBe(true);
    await expect(upload(owner, { clientId: clientA })).rejects.toBeInstanceOf(LimitError);
    await as(owner, (s) => updateSettings(s, "storage", { quotaBytes: null }));
  });

  it("arquivo usado em arte pede confirmação; lixeira restaura e apaga do armazenamento", async () => {
    const f = await upload(a.actor, { clientId: clientA, category: "brand_asset" }, "foto.png", 60);
    const design = await as(a.actor, (s) =>
      createDesign(s, { name: "Com foto", width: 100, height: 100, clientId: clientA }),
    );
    await as(a.actor, (s) =>
      saveDesign(s, {
        id: design.id,
        revision: 1,
        document: { objects: [{ type: "image", uid: "i1", src: `/api/files/${f.versionId}` }] },
      }),
    );
    await expect(as(a.actor, (s) => deleteFile(s, f.fileId))).rejects.toThrow(/usado em uma arte/);
    await as(a.actor, (s) => deleteFile(s, f.fileId, { force: true }));
    await expect(as(a.actor, (s) => getFile(s, f.fileId))).rejects.toBeInstanceOf(NotFoundError);
    expect((await as(a.actor, (s) => listTrash(s))).find((i) => i.id === f.fileId)?.kind).toBe("file");
    // Outra agência não restaura nem apaga.
    await expect(as(b.actor, (s) => restoreFromTrash(s, "file", f.fileId))).rejects.toBeInstanceOf(NotFoundError);
    await as(a.actor, (s) => restoreFromTrash(s, "file", f.fileId));
    expect((await as(a.actor, (s) => getFile(s, f.fileId))).file.id).toBe(f.fileId);

    const [v] = await withSystem((tx) =>
      tx.select({ key: fileVersions.storageKey }).from(fileVersions).where(eq(fileVersions.fileId, f.fileId)),
    );
    await as(a.actor, (s) => deleteFile(s, f.fileId, { force: true }));
    await as(a.actor, (s) => purgeFromTrash(s, "file", f.fileId));
    expect(await withSystem((tx) => tx.select().from(files).where(eq(files.id, f.fileId)))).toHaveLength(0);
    await dispatchPendingEvents(100);
    expect(await getStorage().exists(v!.key)).toBe(false);
    // A arte continua abrindo (a referência quebrada não destrói o projeto).
    expect((await as(a.actor, (s) => getDesign(s, design.id))).design.id).toBe(design.id);
  });

  it("a rotina de 30 dias apaga só arquivos excluídos pela Lixeira", async () => {
    const recent = await upload(a.actor, { clientId: clientA }, "novo.png", 70);
    const legacy = await upload(a.actor, { clientId: clientA }, "antigo.png", 80);
    await as(a.actor, (s) => deleteFile(s, recent.fileId));
    // Exclusão antiga, de antes da Lixeira (sem autor registrado).
    await withSystem((tx) => tx.update(files).set({ deletedAt: new Date() }).where(eq(files.id, legacy.fileId)));
    const res = await purgeExpiredTrash(new Date(Date.now() + 31 * 86_400_000));
    expect(res.files).toBeGreaterThanOrEqual(1);
    const left = await withSystem((tx) =>
      tx
        .select({ id: files.id })
        .from(files)
        .where(sql`${files.id} in (${recent.fileId}, ${legacy.fileId})`),
    );
    expect(left.map((r) => r.id)).toEqual([legacy.fileId]);
  });

  it("permissões: quem não pode excluir não exclui; outra agência não vê o arquivo", async () => {
    const f = await upload(a.actor, { clientId: clientA }, "restrito.png", 90);
    await expect(as(designer, (s) => deleteFile(s, f.fileId))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(as(b.actor, (s) => getFile(s, f.fileId))).rejects.toBeInstanceOf(NotFoundError);
    await expect(as(b.actor, (s) => duplicateFile(s, f.fileId))).rejects.toBeInstanceOf(NotFoundError);
    const guestB = await addMember(a.org.slug, a.org.id, "client_admin", { clientIds: [clientB] });
    await expect(as(guestB, (s) => getFile(s, f.fileId))).rejects.toBeInstanceOf(NotFoundError);
    void designs;
  });
});
