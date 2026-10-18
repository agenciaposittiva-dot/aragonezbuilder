import sharp from "sharp";
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { resolveActor, type Actor } from "@/server/authz/actor";
import { withOrg, withSystem } from "@/server/db";
import { domainEvents, emailOutbox, invitations, memberships, notifications, roles, user } from "@/server/db/schema";
import { dispatchPendingEvents } from "@/server/events/dispatcher";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { MAX_EMAIL_ATTEMPTS, sendPendingEmails } from "@/server/mail/sender";
import { SMTP_MISSING } from "@/server/mail";
import { decideApproval, fileApprovals, listApprovals, requestApproval } from "@/server/services/approvals";
import { getPortalAdmin, updatePortalAccess } from "@/server/services/client-portal";
import { createClient } from "@/server/services/clients";
import { addComment } from "@/server/services/comments";
import { listFiles, storeUpload, updateFile } from "@/server/services/files";
import { inviteGuest, listClientGuests, removeGuestAccess, revokeGuestInvitation } from "@/server/services/guests";
import { acceptInvitation } from "@/server/services/invitations";
import { updateNotificationPreferences } from "@/server/services/notification-preferences";
import { createProject } from "@/server/services/projects";
import {
  changeRequestStatus,
  createRequest,
  getRequest,
  listRequests,
  requestStatusCounts,
} from "@/server/services/requests";
import { createTask } from "@/server/services/tasks";
import { addMember, as, createOrgWithOwner, createUser, resetDb } from "./helpers";

async function png() {
  return sharp({ create: { width: 16, height: 16, channels: 3, background: "#1f3a5f" } })
    .png()
    .toBuffer();
}

const tokenOf = (url: string) => url.split("/invite/")[1]!;

async function roleId(orgId: string, key: string) {
  const [r] = await withSystem((tx) =>
    tx
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.organizationId, orgId), eq(roles.key, key))),
  );
  return r!.id;
}

async function notesFor(orgId: string, userId: string) {
  return withOrg(orgId, (tx) => tx.select().from(notifications).where(eq(notifications.userId, userId)));
}

async function drain() {
  for (let i = 0; i < 10; i++) {
    const r = await dispatchPendingEvents(200);
    if (!r.processed && !r.failed) break;
  }
}

describe("convidados do portal: papéis, convites e notificações", () => {
  let ctx: Awaited<ReturnType<typeof createOrgWithOwner>>;
  let alfa: string;
  let beta: string;
  let admin: Actor;
  let requester: Actor;
  let requester2: Actor;
  let approver: Actor;
  let viewer: Actor;
  let fileId: string;

  beforeAll(async () => {
    await resetDb();
    ctx = await createOrgWithOwner("Agência Convidados");
    alfa = (await as(ctx.actor, (s) => createClient(s, { name: "Cliente Alfa" }))).id;
    beta = (await as(ctx.actor, (s) => createClient(s, { name: "Cliente Beta" }))).id;
    admin = await addMember(ctx.org.slug, ctx.org.id, "client_admin", { name: "Ana Admin", clientIds: [alfa] });
    requester = await addMember(ctx.org.slug, ctx.org.id, "client_requester", { name: "Rui", clientIds: [alfa] });
    requester2 = await addMember(ctx.org.slug, ctx.org.id, "client_requester", { name: "Rita", clientIds: [alfa] });
    approver = await addMember(ctx.org.slug, ctx.org.id, "client_approver", { name: "Alice", clientIds: [alfa] });
    viewer = await addMember(ctx.org.slug, ctx.org.id, "client_viewer", { name: "Vera", clientIds: [alfa] });
    fileId = (
      await as(ctx.actor, async (s) =>
        storeUpload(s, { buffer: await png(), originalName: "peca.png" }, { clientId: alfa, category: "deliverable" }),
      )
    ).fileId;
    await drain();
  });

  it("solicitante vê só as próprias solicitações (lista, detalhe, contagem e anexos)", async () => {
    const mine = await as(requester, (s) => createRequest(s, { clientId: alfa, title: "Minha demanda" }));
    const other = await as(requester2, (s) => createRequest(s, { clientId: alfa, title: "Demanda da colega" }));
    const otherFile = await as(requester2, async (s) =>
      storeUpload(s, { buffer: await png(), originalName: "ref.png" }, { requestId: other.id }),
    );
    const list = await as(requester, (s) => listRequests(s, {}));
    expect(list.rows.map((r) => r.id)).toEqual([mine.id]);
    await expect(as(requester, (s) => getRequest(s, other.id))).rejects.toBeInstanceOf(NotFoundError);
    const counts = await as(requester, (s) => requestStatusCounts(s));
    expect(Object.values(counts).reduce((a, b) => a + (b ?? 0), 0)).toBe(1);
    const files = await as(requester, (s) => listFiles(s, {}));
    expect(files.rows.map((f) => f.id)).not.toContain(otherFile.fileId);
    await expect(
      as(requester, (s) => addComment(s, { target: { requestId: other.id }, body: "oi" })),
    ).rejects.toBeInstanceOf(NotFoundError);
    // Quem tem requests.read (administrador do cliente) vê todas.
    const forAdmin = await as(admin, (s) => listRequests(s, {}));
    expect(forAdmin.rows.map((r) => r.id).sort()).toEqual([mine.id, other.id].sort());
    // Envio do cliente vira referência.
    const files2 = await as(requester2, (s) => listFiles(s, {}));
    expect(files2.rows.find((f) => f.id === otherFile.fileId)?.category).toBe("reference");
  });

  it("visualizador não cria demanda, não aprova e não comenta", async () => {
    await expect(as(viewer, (s) => createRequest(s, { clientId: alfa, title: "x" }))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    const approval = await as(ctx.actor, (s) => requestApproval(s, { fileId, stage: "client" }));
    await expect(
      as(viewer, (s) => decideApproval(s, { approvalId: approval.id, decision: "approved" })),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(as(viewer, (s) => addComment(s, { target: { fileId }, body: "oi" }))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    // Ajuste sem motivo é recusado; com motivo, registrado.
    await expect(
      as(approver, (s) => decideApproval(s, { approvalId: approval.id, decision: "changes_requested" })),
    ).rejects.toBeInstanceOf(ValidationError);
    await as(approver, (s) =>
      decideApproval(s, { approvalId: approval.id, decision: "changes_requested", note: "Trocar a cor" }),
    );
  });

  it("aprovações do convidado não trazem dados de tarefa interna", async () => {
    const project = await as(ctx.actor, (s) => createProject(s, { clientId: alfa, name: "Projeto Alfa" }));
    const task = await as(ctx.actor, (s) => createTask(s, { projectId: project.id, title: "Tarefa secreta" }));
    const f = await as(ctx.actor, async (s) =>
      storeUpload(s, { buffer: await png(), originalName: "kv.png" }, { projectId: project.id, taskId: task.id }),
    );
    await as(ctx.actor, (s) => requestApproval(s, { fileId: f.fileId, stage: "client" }));
    const rows = await as(approver, (s) => listApprovals(s, { tab: "client" }));
    const row = rows.find((r) => r.fileId === f.fileId)!;
    expect(row).toBeTruthy();
    expect(row.taskId).toBeNull();
    expect(row.taskTitle).toBeNull();
    expect(row.requestedByUserId).toBeNull();
    const history = await as(approver, (s) => fileApprovals(s, f.fileId));
    expect(history.length).toBeGreaterThan(0);
    expect(history.every((h) => h.taskId === null && h.taskTitle === null)).toBe(true);
    const internal = await as(ctx.actor, (s) => listApprovals(s, { tab: "client" }));
    expect(internal.find((r) => r.fileId === f.fileId)?.taskTitle).toBe("Tarefa secreta");
  });

  it("administrador do cliente só convida quando a agência permite, com papel de cliente e para o próprio cliente", async () => {
    const requesterRole = await roleId(ctx.org.id, "client_requester");
    const designerRole = await roleId(ctx.org.id, "designer");
    await expect(
      as(admin, (s) => inviteGuest(s, { clientId: alfa, email: "nova@alfa.dev", roleId: requesterRole })),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const { client } = await as(ctx.actor, (s) => getPortalAdmin(s, alfa));
    await as(ctx.actor, (s) =>
      updatePortalAccess(s, alfa, { slug: client.slug, loginEnabled: true, allowGuestInvites: true }),
    );
    await expect(
      as(admin, (s) => inviteGuest(s, { clientId: alfa, email: "nova@alfa.dev", roleId: designerRole })),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      as(admin, (s) => inviteGuest(s, { clientId: beta, email: "nova@alfa.dev", roleId: requesterRole })),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      as(requester, (s) => inviteGuest(s, { clientId: alfa, email: "nova@alfa.dev", roleId: requesterRole })),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const issued = await as(admin, (s) =>
      inviteGuest(s, { clientId: alfa, email: "nova@alfa.dev", name: "Nova", roleId: requesterRole, validityDays: 3 }),
    );
    expect("url" in issued && issued.email).toBe("not_configured");
    const [inv] = await withSystem((tx) => tx.select().from(invitations).where(eq(invitations.email, "nova@alfa.dev")));
    expect(inv!.clientIds).toEqual([alfa]);
    expect(inv!.name).toBe("Nova");
    const days = (inv!.expiresAt.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(2.9);
    expect(days).toBeLessThan(3.1);
    const view = await as(admin, (s) => listClientGuests(s, alfa));
    expect(view.invites.find((i) => i.email === "nova@alfa.dev")?.manageable).toBe(true);
  });

  it("convite expirado, revogado ou já usado não é aceito; aceito associa ao cliente certo", async () => {
    const requesterRole = await roleId(ctx.org.id, "client_requester");
    const u1 = await createUser("Expirado", "expirado@alfa.dev");
    const exp = await as(ctx.actor, (s) => inviteGuest(s, { clientId: alfa, email: u1.email, roleId: requesterRole }));
    if (!("url" in exp)) throw new Error("convite esperado");
    await withSystem((tx) =>
      tx
        .update(invitations)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(invitations.id, exp.id)),
    );
    await expect(acceptInvitation(tokenOf(exp.url), u1)).rejects.toBeInstanceOf(ValidationError);

    const u2 = await createUser("Revogado", "revogado@alfa.dev");
    const rev = await as(ctx.actor, (s) => inviteGuest(s, { clientId: alfa, email: u2.email, roleId: requesterRole }));
    if (!("url" in rev)) throw new Error("convite esperado");
    await as(ctx.actor, (s) => revokeGuestInvitation(s, alfa, rev.id));
    await expect(acceptInvitation(tokenOf(rev.url), u2)).rejects.toBeInstanceOf(ValidationError);

    const u3 = await createUser("Aceito", "aceito@alfa.dev");
    const ok = await as(ctx.actor, (s) => inviteGuest(s, { clientId: alfa, email: u3.email, roleId: requesterRole }));
    if (!("url" in ok)) throw new Error("convite esperado");
    await acceptInvitation(tokenOf(ok.url), u3);
    await expect(acceptInvitation(tokenOf(ok.url), u3)).rejects.toThrow();
    const actor = await resolveActor(u3.id, ctx.org.slug);
    expect(actor?.clientIds).toEqual([alfa]);
    expect(actor?.roleKey).toBe("client_requester");

    // Quem convidou é avisado do aceite.
    await drain();
    const notes = await notesFor(ctx.org.id, ctx.actor.userId);
    const joined = notes.find((n) => n.type === "member.joined" && n.title.includes("Aceito"));
    expect(joined?.link).toBe(`/w/${ctx.org.slug}/clients/${alfa}/guests`);
  });

  it("remover o acesso revoga na próxima requisição e suspende sem outros clientes", async () => {
    const guest = await addMember(ctx.org.slug, ctx.org.id, "client_requester", {
      name: "Temporário",
      clientIds: [alfa],
    });
    const res = await as(ctx.actor, (s) => removeGuestAccess(s, alfa, guest.membershipId));
    expect(res.suspended).toBe(true);
    expect(await resolveActor(guest.userId, ctx.org.slug)).toBeNull();
    const [m] = await withSystem((tx) =>
      tx.select({ status: memberships.status }).from(memberships).where(eq(memberships.id, guest.membershipId)),
    );
    expect(m?.status).toBe("suspended");
    await expect(as(admin, (s) => removeGuestAccess(s, alfa, requester.membershipId))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("sem SMTP, o e-mail não é marcado como enviado nem tentado de novo", async () => {
    await sendPendingEmails(200);
    const rows = await withSystem((tx) => tx.select().from(emailOutbox).where(eq(emailOutbox.to, "nova@alfa.dev")));
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.sentAt).toBeNull();
      expect(r.lastError).toBe(SMTP_MISSING);
      expect(r.attempts).toBe(MAX_EMAIL_ATTEMPTS);
    }
  });

  it("notificações vão para as pessoas certas e respeitam as preferências", async () => {
    await drain();
    // Pedido de aprovação ao cliente: só quem decide; nunca visualizador ou solicitante.
    await as(admin, (s) => updateNotificationPreferences(s, { inApp: { approvals: false }, email: {} }));
    await as(approver, (s) => updateNotificationPreferences(s, { inApp: {}, email: { approvals: false } }));
    const f = await as(ctx.actor, async (s) =>
      storeUpload(s, { buffer: await png(), originalName: "aviso.png" }, { clientId: alfa }),
    );
    await as(ctx.actor, (s) => requestApproval(s, { fileId: f.fileId, stage: "client" }));
    await drain();
    const forApprover = await notesFor(ctx.org.id, approver.userId);
    expect(forApprover.some((n) => n.type === "approval.requested" && n.title.includes("aviso.png"))).toBe(true);
    for (const u of [viewer, requester, admin]) {
      const n = await notesFor(ctx.org.id, u.userId);
      expect(n.some((x) => x.type === "approval.requested" && x.title.includes("aviso.png"))).toBe(false);
    }
    const mailsTo = async (u: Actor) => {
      const [row] = await withSystem((tx) => tx.select({ email: user.email }).from(user).where(eq(user.id, u.userId)));
      const rows = await withSystem((tx) => tx.select().from(emailOutbox).where(eq(emailOutbox.to, row!.email)));
      return rows.filter((r) => r.subject.includes("aviso.png"));
    };
    // Plataforma desligada não impede o e-mail, e vice-versa.
    expect(await mailsTo(admin)).toHaveLength(1);
    expect(await mailsTo(approver)).toHaveLength(0);

    // Status da solicitação: quem abriu e quem acompanha todas; não a colega solicitante.
    const req = await as(requester, (s) => createRequest(s, { clientId: alfa, title: "Banner novo" }));
    await as(ctx.actor, (s) => changeRequestStatus(s, req.id, "in_progress"));
    await drain();
    const has = async (u: Actor) =>
      (await notesFor(ctx.org.id, u.userId)).some(
        (n) => n.type === "request.status_changed" && n.link?.endsWith(`/requests/${req.id}`),
      );
    expect(await has(requester)).toBe(true);
    expect(await has(admin)).toBe(true);
    expect(await has(requester2)).toBe(false);
    expect(await has(viewer)).toBe(false);

    // Material final compartilhado: quem vê materiais; revisão interna nunca chega ao cliente.
    const shared = await as(ctx.actor, async (s) =>
      storeUpload(s, { buffer: await png(), originalName: "final.png" }, { clientId: alfa }),
    );
    await as(ctx.actor, (s) => requestApproval(s, { fileId: shared.fileId, stage: "internal" }));
    await as(ctx.actor, (s) => requestApproval(s, { fileId: shared.fileId, stage: "client" }));
    await as(ctx.actor, (s) =>
      updateFile(s, { id: shared.fileId, name: "final.png", category: "deliverable", tags: [], status: "final" }),
    );
    await drain();
    for (const u of [viewer, approver]) {
      const n = await notesFor(ctx.org.id, u.userId);
      expect(n.some((x) => x.type === "file.status_changed" && x.title.includes("final.png"))).toBe(true);
      expect(n.some((x) => x.title.toLowerCase().includes("revisão interna"))).toBe(false);
    }
    // Ajustes do cliente avisam a equipe com o motivo.
    const events = await withOrg(ctx.org.id, (tx) =>
      tx.select().from(domainEvents).where(eq(domainEvents.type, "approval.decided")),
    );
    expect(events.some((e) => (e.payload as { note?: string }).note === "Trocar a cor")).toBe(true);
  });
});
