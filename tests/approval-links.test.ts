import { eq } from "drizzle-orm";
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { withOrg } from "@/server/db";
import { approvalLinks, approvals, auditLogs, domainEvents, tasks, workflowStatuses } from "@/server/db/schema";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import {
  approvalLinkCandidates,
  approvalLinkVersion,
  createApprovalLink,
  decideByApprovalLink,
  getApprovalLinkView,
  listApprovalLinks,
  revokeApprovalLink,
} from "@/server/services/approval-links";
import { decideApproval, requestApproval } from "@/server/services/approvals";
import { createClient } from "@/server/services/clients";
import { getFile, storeUpload } from "@/server/services/files";
import { createProject } from "@/server/services/projects";
import { createTask } from "@/server/services/tasks";
import { addMember, as, createOrgWithOwner, resetDb } from "./helpers";

const png = (c = 10) =>
  sharp({ create: { width: 20 + c, height: 20, channels: 3, background: { r: c, g: 120, b: 200 } } })
    .png()
    .toBuffer();

type Ctx = Awaited<ReturnType<typeof createOrgWithOwner>>;

describe("aprovação por link (sem conta)", () => {
  let ctx: Ctx;
  let clientId: string;
  let otherClientId: string;

  beforeAll(async () => {
    await resetDb();
    ctx = await createOrgWithOwner("Agência Link");
    clientId = (await as(ctx.actor, (s) => createClient(s, { name: "Cliente Link" }))).id;
    otherClientId = (await as(ctx.actor, (s) => createClient(s, { name: "Outro Cliente" }))).id;
  });

  /** Arquivo do cliente já enviado para a aprovação dele (interna aprovada antes). */
  async function readyForClient(name: string, opts: { client?: string; taskId?: string } = {}) {
    const f = await as(ctx.actor, async (s) =>
      storeUpload(
        s,
        { buffer: await png(Math.floor(Math.random() * 200)), originalName: name },
        { clientId: opts.client ?? clientId },
      ),
    );
    const internal = await as(ctx.actor, (s) => requestApproval(s, { fileId: f.fileId, stage: "internal" }));
    await as(ctx.actor, (s) => decideApproval(s, { approvalId: internal.id, decision: "approved" }));
    const client = await as(ctx.actor, (s) =>
      requestApproval(s, { fileId: f.fileId, stage: "client", taskId: opts.taskId }),
    );
    return { ...f, approvalId: client.id };
  }

  it("só entram arquivos do cliente que aguardam a aprovação dele", async () => {
    const ready = await readyForClient("post-1.png");
    const draft = await as(ctx.actor, async (s) =>
      storeUpload(s, { buffer: await png(3), originalName: "rascunho.png" }, { clientId }),
    );
    const other = await readyForClient("alheio.png", { client: otherClientId });

    const candidates = await as(ctx.actor, (s) => approvalLinkCandidates(s, clientId));
    expect(candidates.map((c) => c.fileId)).toContain(ready.fileId);
    expect(candidates.map((c) => c.fileId)).not.toContain(draft.fileId);

    await expect(
      as(ctx.actor, (s) => createApprovalLink(s, { clientId, fileIds: [ready.fileId, draft.fileId], label: "X" })),
    ).rejects.toThrow(/Envie para aprovação do cliente/);
    await expect(
      as(ctx.actor, (s) => createApprovalLink(s, { clientId, fileIds: [ready.fileId, other.fileId], label: "X" })),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      as(ctx.actor, (s) => createApprovalLink(s, { clientId, fileIds: [ready.fileId], label: "X", days: 31 })),
    ).rejects.toThrow();
  });

  it("aprovar pelo link grava na mesma aprovação, com o nome, histórico e aviso à equipe", async () => {
    const a = await readyForClient("feed-1.png");
    const b = await readyForClient("feed-2.png");
    const link = await as(ctx.actor, (s) =>
      createApprovalLink(s, { clientId, fileIds: [a.fileId, b.fileId], label: "Feed de novembro", days: 7 }),
    );
    expect(link.path).toBe(`/aprovar/${link.token}`);
    // O banco guarda só o hash do token.
    const [stored] = await withOrg(ctx.org.id, (tx) =>
      tx.select().from(approvalLinks).where(eq(approvalLinks.id, link.id)),
    );
    expect(stored!.tokenHash).not.toContain(link.token);

    const view = await getApprovalLinkView(link.token);
    expect(view.state).toBe("active");
    if (view.state !== "active") return;
    expect(view.items.map((i) => i.name)).toEqual(["feed-1.png", "feed-2.png"]);
    expect(view.items.every((i) => i.pending)).toBe(true);

    await decideByApprovalLink(link.token, { fileId: a.fileId, decision: "approved", name: "Paula Souza" });
    const [row] = await withOrg(ctx.org.id, (tx) => tx.select().from(approvals).where(eq(approvals.id, a.approvalId)));
    expect(row).toMatchObject({ status: "approved", decidedByName: "Paula Souza", decidedByUserId: null });
    expect((await as(ctx.actor, (s) => getFile(s, a.fileId))).file.status).toBe("approved");
    const logs = await withOrg(ctx.org.id, (tx) => tx.select().from(auditLogs).where(eq(auditLogs.entityId, a.fileId)));
    expect(logs.some((l) => l.summary?.includes("Paula Souza") && l.actorUserId === null)).toBe(true);
    const events = await withOrg(ctx.org.id, (tx) =>
      tx.select().from(domainEvents).where(eq(domainEvents.type, "approval.decided")),
    );
    expect(events.some((e) => (e.payload as { approvalId?: string }).approvalId === a.approvalId)).toBe(true);

    // Decidido não decide de novo.
    await expect(
      decideByApprovalLink(link.token, { fileId: a.fileId, decision: "approved", name: "Paula" }),
    ).rejects.toThrow(/não está mais aguardando/);

    const after = await getApprovalLinkView(link.token);
    if (after.state !== "active") throw new Error("link deveria estar ativo");
    expect(after.items.find((i) => i.fileId === a.fileId)?.last).toMatchObject({ status: "approved", by: "Paula Souza" });
    const listed = await as(ctx.actor, (s) => listApprovalLinks(s));
    expect(listed.find((l) => l.id === link.id)).toMatchObject({ state: "active", items: 2, pending: 1 });
  });

  it("pedir ajustes exige motivo e leva a tarefa vinculada para Ajustes", async () => {
    const projectId = (await as(ctx.actor, (s) => createProject(s, { clientId, name: "Projeto Link" }))).id;
    const task = await as(ctx.actor, (s) => createTask(s, { projectId, title: "Carrossel de novembro" }));
    const f = await readyForClient("carrossel.png", { taskId: task.id });
    const link = await as(ctx.actor, (s) => createApprovalLink(s, { clientId, fileIds: [f.fileId], label: "Carrossel" }));

    await expect(
      decideByApprovalLink(link.token, { fileId: f.fileId, decision: "changes_requested", name: "Paula" }),
    ).rejects.toThrow();
    await decideByApprovalLink(link.token, {
      fileId: f.fileId,
      decision: "changes_requested",
      note: "Trocar a foto da capa",
      name: "Paula",
    });
    const [row] = await withOrg(ctx.org.id, (tx) => tx.select().from(approvals).where(eq(approvals.id, f.approvalId)));
    expect(row).toMatchObject({ status: "changes_requested", decisionNote: "Trocar a foto da capa" });
    const [t] = await withOrg(ctx.org.id, (tx) =>
      tx
        .select({ key: workflowStatuses.key })
        .from(tasks)
        .innerJoin(workflowStatuses, eq(workflowStatuses.id, tasks.statusId))
        .where(eq(tasks.id, task.id)),
    );
    expect(t!.key).toBe("adjustments");
  });

  it("nova versão invalida a rodada; o link só entrega a versão atual dos seus arquivos", async () => {
    const f = await readyForClient("story.png");
    const outside = await readyForClient("fora.png");
    const link = await as(ctx.actor, (s) => createApprovalLink(s, { clientId, fileIds: [f.fileId], label: "Story" }));
    expect(await approvalLinkVersion(link.token, f.versionId)).toMatchObject({ storageKey: expect.any(String) });
    expect(await approvalLinkVersion(link.token, outside.versionId)).toBeNull();

    const v2 = await as(ctx.actor, async (s) =>
      storeUpload(s, { buffer: await png(99), originalName: "story v2.png" }, { fileId: f.fileId }),
    );
    // Versão antiga deixou de ser servida; a nova sim (é a atual do arquivo do link).
    expect(await approvalLinkVersion(link.token, f.versionId)).toBeNull();
    expect(await approvalLinkVersion(link.token, v2.versionId)).not.toBeNull();
    await expect(
      decideByApprovalLink(link.token, { fileId: f.fileId, decision: "approved", name: "Paula" }),
    ).rejects.toThrow(/não está mais aguardando/);
  });

  it("revogado, expirado ou inválido não abre nem decide", async () => {
    const f = await readyForClient("revogar.png");
    const link = await as(ctx.actor, (s) => createApprovalLink(s, { clientId, fileIds: [f.fileId], label: "Revogar" }));
    await as(ctx.actor, (s) => revokeApprovalLink(s, link.id));
    expect((await getApprovalLinkView(link.token)).state).toBe("revoked");
    await expect(
      decideByApprovalLink(link.token, { fileId: f.fileId, decision: "approved", name: "Paula" }),
    ).rejects.toThrow(/desativado/);
    expect(await approvalLinkVersion(link.token, f.versionId)).toBeNull();

    const g = await readyForClient("expirar.png");
    const exp = await as(ctx.actor, (s) => createApprovalLink(s, { clientId, fileIds: [g.fileId], label: "Expira" }));
    await withOrg(ctx.org.id, (tx) =>
      tx.update(approvalLinks).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(approvalLinks.id, exp.id)),
    );
    expect((await getApprovalLinkView(exp.token)).state).toBe("expired");
    await expect(
      decideByApprovalLink(exp.token, { fileId: g.fileId, decision: "approved", name: "Paula" }),
    ).rejects.toThrow(/expirou/);

    expect((await getApprovalLinkView("x".repeat(43))).state).toBe("invalid");
    expect((await getApprovalLinkView("curto")).state).toBe("invalid");
    await expect(
      decideByApprovalLink("y".repeat(43), { fileId: g.fileId, decision: "approved", name: "Paula" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("permissões e isolamento: quem não envia aprovações não cria; outra agência não vê os links", async () => {
    const designer = await addMember(ctx.org.slug, ctx.org.id, "finance");
    const f = await readyForClient("perm.png");
    await expect(
      as(designer, (s) => createApprovalLink(s, { clientId, fileIds: [f.fileId], label: "Sem permissão" })),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const other = await createOrgWithOwner("Agência Vizinha Link");
    expect(await as(other.actor, (s) => listApprovalLinks(s))).toEqual([]);
  });
});
