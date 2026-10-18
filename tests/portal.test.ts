import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import type { Actor } from "@/server/authz/actor";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import { fileApprovals, listApprovals, requestApproval } from "@/server/services/approvals";
import { createClient } from "@/server/services/clients";
import { addComment, listComments } from "@/server/services/comments";
import { fileHistory, storeUpload } from "@/server/services/files";
import { financeOverview, listInvoices, profitability } from "@/server/services/finance";
import { assignRequest, createRequest, getRequest, listRequests, requestHistory } from "@/server/services/requests";
import { listTasks } from "@/server/services/tasks";
import { addMember, as, createOrgWithOwner, resetDb } from "./helpers";

/**
 * O que as páginas da área do cliente consultam em nome de um usuário de
 * cliente: nada interno pode aparecer, mesmo dentro de registros que ele vê.
 */
describe("área do cliente", () => {
  let ctx: Awaited<ReturnType<typeof createOrgWithOwner>>;
  let clientId: string;
  let paula: Actor;
  let joao: Actor;
  let fileId: string;

  beforeAll(async () => {
    await resetDb();
    ctx = await createOrgWithOwner("Agência Portal");
    clientId = (await as(ctx.actor, (s) => createClient(s, { name: "Café Serra" }))).id;
    paula = await addMember(ctx.org.slug, ctx.org.id, "client", { name: "Paula", clientIds: [clientId] });
    joao = await addMember(ctx.org.slug, ctx.org.id, "client", { name: "João", clientIds: [clientId] });
    const buffer = await sharp({ create: { width: 20, height: 20, channels: 3, background: "#1f3a5f" } })
      .png()
      .toBuffer();
    fileId = (
      await as(ctx.actor, (s) =>
        storeUpload(s, { buffer, originalName: "kv.png" }, { clientId, category: "deliverable" }),
      )
    ).fileId;
    await as(ctx.actor, async (s) => {
      await requestApproval(s, { fileId, stage: "internal" });
      await requestApproval(s, { fileId, stage: "client" });
    });
  });

  it("comentários internos não aparecem para o cliente", async () => {
    await as(ctx.actor, async (s) => {
      await addComment(s, { target: { fileId }, body: "Visível ao cliente", internal: false });
      await addComment(s, { target: { fileId }, body: "Só a equipe", internal: true });
    });
    const forClient = await as(paula, (s) => listComments(s, { fileId }));
    expect(forClient.map((c) => c.body)).toEqual(["Visível ao cliente"]);
    const forTeam = await as(ctx.actor, (s) => listComments(s, { fileId }));
    expect(forTeam).toHaveLength(2);
  });

  it("aprovações e histórico mostram ao cliente apenas a etapa e os eventos dele", async () => {
    const rounds = await as(paula, (s) => fileApprovals(s, fileId));
    expect(rounds.map((r) => r.stage)).toEqual(["client"]);
    const pending = await as(paula, (s) => listApprovals(s, { tab: "client" }));
    expect(pending).toHaveLength(1);
    const internalTab = await as(paula, (s) => listApprovals(s, { tab: "internal" }));
    expect(internalTab).toHaveLength(0);

    const history = await as(paula, (s) => fileHistory(s, fileId));
    const summaries = history.map((h) => h.summary ?? "");
    expect(summaries.some((t) => /aprovação do cliente/i.test(t))).toBe(true);
    expect(summaries.some((t) => /revisão interna/i.test(t))).toBe(false);
  });

  it("rascunho de outro usuário do mesmo cliente fica oculto", async () => {
    const draft = await as(paula, (s) => createRequest(s, { clientId, title: "Ideia em rascunho", draft: true }));
    const mine = await as(paula, (s) => listRequests(s, {}));
    expect(mine.rows.map((r) => r.id)).toContain(draft.id);
    const other = await as(joao, (s) => listRequests(s, {}));
    expect(other.rows.map((r) => r.id)).not.toContain(draft.id);
    await expect(as(joao, (s) => getRequest(s, draft.id))).rejects.toBeInstanceOf(NotFoundError);
  });

  it("histórico da solicitação omite movimentações internas", async () => {
    const req = await as(paula, (s) => createRequest(s, { clientId, title: "Posts de novembro" }));
    await as(ctx.actor, (s) => assignRequest(s, req.id, ctx.actor.membershipId));
    const team = await as(ctx.actor, (s) => requestHistory(s, req.id));
    const client = await as(paula, (s) => requestHistory(s, req.id));
    expect(team.length).toBeGreaterThan(client.length);
    expect(client.some((h) => /Responsável/.test(h.summary ?? ""))).toBe(false);
  });

  it("cliente não acessa financeiro, custos nem tarefas", async () => {
    await expect(as(paula, (s) => financeOverview(s))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(as(paula, (s) => listInvoices(s, {}))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(as(paula, (s) => profitability(s, {}))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(as(paula, (s) => listTasks(s, {}))).rejects.toBeInstanceOf(ForbiddenError);
  });
});
