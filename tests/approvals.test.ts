import { eq } from "drizzle-orm";
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { withOrg } from "@/server/db";
import { approvals } from "@/server/db/schema";
import {
  cancelApproval,
  decideApproval,
  fileApprovals,
  listApprovals,
  requestApproval,
} from "@/server/services/approvals";
import { createClient } from "@/server/services/clients";
import { getFile, storeUpload } from "@/server/services/files";
import { addMember, as, createOrgWithOwner, resetDb } from "./helpers";

const png = (c = 10) =>
  sharp({ create: { width: 20 + c, height: 20, channels: 3, background: { r: c, g: 100, b: 200 } } })
    .png()
    .toBuffer();

describe("aprovações por versão", () => {
  let ctx: Awaited<ReturnType<typeof createOrgWithOwner>>;
  let clientId: string;

  beforeAll(async () => {
    await resetDb();
    ctx = await createOrgWithOwner("Agência Aprovações");
    clientId = (await as(ctx.actor, (s) => createClient(s, { name: "Cliente Aprova" }))).id;
  });

  async function upload(name = "arte.png") {
    return as(ctx.actor, async (s) =>
      storeUpload(s, { buffer: await png(Math.floor(Math.random() * 200)), originalName: name }, { clientId }),
    );
  }

  it("nova versão invalida aprovações pendentes e não herda aprovação", async () => {
    const f = await upload();
    const a1 = await as(ctx.actor, (s) => requestApproval(s, { fileId: f.fileId, stage: "internal" }));
    await as(ctx.actor, (s) => decideApproval(s, { approvalId: a1.id, decision: "approved" }));
    const a2 = await as(ctx.actor, (s) => requestApproval(s, { fileId: f.fileId, stage: "client" }));

    const v2 = await as(ctx.actor, async (s) =>
      storeUpload(s, { buffer: await png(77), originalName: "arte v2.png" }, { fileId: f.fileId }),
    );
    const [row] = await withOrg(ctx.org.id, (tx) => tx.select().from(approvals).where(eq(approvals.id, a2.id)));
    expect(row?.status).toBe("superseded");

    const detail = await as(ctx.actor, (s) => getFile(s, f.fileId));
    expect(detail.file.status).toBe("draft");
    const rounds = await as(ctx.actor, (s) => fileApprovals(s, f.fileId));
    expect(rounds.filter((r) => r.versionId === v2.versionId)).toHaveLength(0);

    // Sem aprovação interna da v2, quem não pode decidir internamente não envia ao cliente.
    const account = await addMember(ctx.org.slug, ctx.org.id, "designer");
    await expect(as(account, (s) => requestApproval(s, { fileId: f.fileId, stage: "client" }))).rejects.toThrow(
      /revisão interna/i,
    );
  });

  it("decisão vale só para a versão em que foi pedida", async () => {
    const f = await upload();
    const a = await as(ctx.actor, (s) => requestApproval(s, { fileId: f.fileId, stage: "internal" }));
    await as(ctx.actor, async (s) =>
      storeUpload(s, { buffer: await png(5), originalName: "nova.png" }, { fileId: f.fileId }),
    );
    await expect(as(ctx.actor, (s) => decideApproval(s, { approvalId: a.id, decision: "approved" }))).rejects.toThrow(
      /nova versão/i,
    );
  });

  it("cliente decide a etapa do cliente; equipe não decide por ele", async () => {
    const f = await upload();
    const internal = await as(ctx.actor, (s) => requestApproval(s, { fileId: f.fileId, stage: "internal" }));
    const clientUser = await addMember(ctx.org.slug, ctx.org.id, "client", { clientIds: [clientId] });

    await expect(
      as(clientUser, (s) => decideApproval(s, { approvalId: internal.id, decision: "approved" })),
    ).rejects.toThrow();
    await as(ctx.actor, (s) => decideApproval(s, { approvalId: internal.id, decision: "approved" }));

    const toClient = await as(ctx.actor, (s) => requestApproval(s, { fileId: f.fileId, stage: "client" }));
    await expect(
      as(ctx.actor, (s) => decideApproval(s, { approvalId: toClient.id, decision: "approved" })),
    ).rejects.toThrow(/cliente/i);

    const pending = await as(clientUser, (s) => listApprovals(s, { tab: "client" }));
    expect(pending.map((p) => p.id)).toContain(toClient.id);
    await as(clientUser, (s) =>
      decideApproval(s, { approvalId: toClient.id, decision: "changes_requested", note: "Trocar a foto" }),
    );
    const detail = await as(ctx.actor, (s) => getFile(s, f.fileId));
    expect(detail.file.status).toBe("changes_requested");
  });

  it("cliente não vê aprovações de outro cliente", async () => {
    const otherClient = (await as(ctx.actor, (s) => createClient(s, { name: "Outro" }))).id;
    const f = await as(ctx.actor, async (s) =>
      storeUpload(s, { buffer: await png(3), originalName: "o.png" }, { clientId: otherClient }),
    );
    await as(ctx.actor, (s) => requestApproval(s, { fileId: f.fileId, stage: "client" }));
    const clientUser = await addMember(ctx.org.slug, ctx.org.id, "client", { clientIds: [clientId] });
    const list = await as(clientUser, (s) => listApprovals(s, { tab: "client" }));
    expect(list.every((a) => a.clientId === clientId)).toBe(true);
  });

  it("não permite duas aprovações pendentes da mesma etapa e permite cancelar", async () => {
    const f = await upload();
    const a = await as(ctx.actor, (s) => requestApproval(s, { fileId: f.fileId, stage: "internal" }));
    await expect(as(ctx.actor, (s) => requestApproval(s, { fileId: f.fileId, stage: "internal" }))).rejects.toThrow(
      /pendente/i,
    );
    await as(ctx.actor, (s) => cancelApproval(s, a.id));
    await as(ctx.actor, (s) => requestApproval(s, { fileId: f.fileId, stage: "internal" }));
  });
});
