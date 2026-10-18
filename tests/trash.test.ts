import { and, eq } from "drizzle-orm";
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { resolveActor } from "@/server/authz/actor";
import { listUserOrganizations } from "@/server/authz/actor";
import { withSystem } from "@/server/db";
import {
  clients,
  designs,
  domainEvents,
  expenses,
  files,
  fileVersions,
  invoices,
  projects,
  tasks,
} from "@/server/db/schema";
import { dispatchPendingEvents } from "@/server/events/dispatcher";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { requestApproval } from "@/server/services/approvals";
import { resolvePublicPortal } from "@/server/services/client-portal";
import { createClient, getClient, listClients } from "@/server/services/clients";
import { createDesign, getDesign, listDesigns } from "@/server/services/designs";
import { createInvoice, listInvoices, saveExpense } from "@/server/services/finance";
import { getFile, storeUpload } from "@/server/services/files";
import { createProject, getProject, listProjects } from "@/server/services/projects";
import { createRequest, listRequests } from "@/server/services/requests";
import { createTask, listTasks } from "@/server/services/tasks";
import {
  listTrash,
  listTrashedOrganizations,
  purgeExpiredTrash,
  purgeFromTrash,
  restoreFromTrash,
  restoreOrganization,
  trashClient,
  trashDesign,
  trashOrganization,
  trashProject,
} from "@/server/services/trash";
import { getStorage } from "@/server/storage";
import { addMember, as, createOrgWithOwner, resetDb } from "./helpers";

const png = (c = 10) =>
  sharp({ create: { width: 20 + c, height: 20, channels: 3, background: { r: c, g: 100, b: 200 } } })
    .png()
    .toBuffer();

type Ctx = Awaited<ReturnType<typeof createOrgWithOwner>>;

/** Cliente com projeto, tarefa, arquivo (com aprovação), solicitação, arte, fatura e despesa. */
async function seedClient(ctx: Ctx, name: string) {
  return as(ctx.actor, async (s) => {
    const clientId = (await createClient(s, { name })).id;
    const projectId = (await createProject(s, { clientId, name: `Projeto ${name}` })).id;
    const taskId = (await createTask(s, { projectId, title: `Tarefa ${name}` })).id;
    const file = await storeUpload(
      s,
      { buffer: await png(), originalName: "peca.png" },
      { clientId, projectId, taskId },
    );
    await requestApproval(s, { fileId: file.fileId, stage: "internal" });
    const requestId = (await createRequest(s, { clientId, title: `Pedido ${name}` })).id;
    const designId = (await createDesign(s, { name: `Arte ${name}`, width: 100, height: 100, clientId })).id;
    await createInvoice(s, {
      clientId,
      projectId,
      description: "Mensalidade",
      issueDate: "2026-10-01",
      dueDate: "2026-10-10",
      amount: "100",
    });
    await saveExpense(s, {
      clientId,
      projectId,
      category: "other",
      description: "Banco de imagens",
      amount: "50",
      dueDate: "2026-10-05",
    });
    return { clientId, projectId, taskId, fileId: file.fileId, requestId, designId };
  });
}

describe("lixeira", () => {
  let a: Ctx;
  let b: Ctx;

  beforeAll(async () => {
    await resetDb();
    a = await createOrgWithOwner("Agência Lixeira A");
    b = await createOrgWithOwner("Agência Lixeira B");
  });

  it("cliente na lixeira some de todas as listas e volta inteiro ao restaurar", async () => {
    const c = await seedClient(a, "Alfa");
    // Projeto excluído antes, sozinho: não pode voltar junto com o cliente.
    const solo = await as(a.actor, (s) => createProject(s, { clientId: c.clientId, name: "Projeto avulso" }));
    await as(a.actor, (s) => trashProject(s, solo.id));

    await expect(as(a.actor, (s) => trashClient(s, c.clientId))).rejects.toBeInstanceOf(ValidationError);
    await as(a.actor, (s) => trashClient(s, c.clientId, { confirmFinance: true }));

    await as(a.actor, async (s) => {
      expect((await listClients(s, {})).rows.map((r) => r.id)).not.toContain(c.clientId);
      expect((await listProjects(s, {})).rows.map((r) => r.id)).not.toContain(c.projectId);
      expect((await listTasks(s, {})).rows.map((r) => r.id)).not.toContain(c.taskId);
      expect((await listRequests(s, {})).rows.map((r) => r.id)).not.toContain(c.requestId);
      expect((await listDesigns(s)).map((r) => r.id)).not.toContain(c.designId);
      expect((await listInvoices(s, {})).rows.some((r) => r.clientId === c.clientId)).toBe(false);
    });
    await expect(as(a.actor, (s) => getClient(s, c.clientId))).rejects.toBeInstanceOf(NotFoundError);
    await expect(as(a.actor, (s) => getProject(s, c.projectId))).rejects.toBeInstanceOf(NotFoundError);
    await expect(as(a.actor, (s) => getFile(s, c.fileId))).rejects.toBeInstanceOf(NotFoundError);
    await expect(as(a.actor, (s) => getDesign(s, c.designId))).rejects.toBeInstanceOf(NotFoundError);
    expect(await resolvePublicPortal(a.org.slug, "alfa")).toBeNull();

    const trash = await as(a.actor, (s) => listTrash(s));
    expect(trash.find((i) => i.id === c.clientId)?.kind).toBe("client");
    // O projeto avulso aparece bloqueado (cliente também está na lixeira).
    expect(trash.find((i) => i.id === solo.id)?.blockedBy).toMatch(/Restaure-o primeiro/);
    await expect(as(a.actor, (s) => restoreFromTrash(s, "project", solo.id))).rejects.toBeInstanceOf(ValidationError);

    await as(a.actor, (s) => restoreFromTrash(s, "client", c.clientId));
    await as(a.actor, async (s) => {
      expect((await getClient(s, c.clientId)).client.name).toBe("Alfa");
      expect((await getProject(s, c.projectId)).project.name).toBe("Projeto Alfa");
      expect((await listTasks(s, {})).rows.map((r) => r.id)).toContain(c.taskId);
      expect((await getDesign(s, c.designId)).design.name).toBe("Arte Alfa");
      expect((await listProjects(s, {})).rows.map((r) => r.id)).not.toContain(solo.id);
    });
    expect(await resolvePublicPortal(a.org.slug, "alfa")).not.toBeNull();
  });

  it("só quem tem permissão exclui, e nunca entre organizações", async () => {
    const c = await seedClient(a, "Beta");
    const designer = await addMember(a.org.slug, a.org.id, "designer");
    await expect(as(designer, (s) => trashClient(s, c.clientId))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(as(designer, (s) => trashProject(s, c.projectId))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(as(designer, (s) => trashDesign(s, c.designId))).rejects.toBeInstanceOf(ForbiddenError);
    // Outra agência, mesmo sabendo os IDs: não encontra nada.
    await expect(as(b.actor, (s) => trashClient(s, c.clientId, { confirmFinance: true }))).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(as(b.actor, (s) => trashProject(s, c.projectId))).rejects.toBeInstanceOf(NotFoundError);
    await expect(as(b.actor, (s) => trashDesign(s, c.designId))).rejects.toBeInstanceOf(NotFoundError);
    await as(a.actor, (s) => trashDesign(s, c.designId));
    await expect(as(b.actor, (s) => restoreFromTrash(s, "design", c.designId))).rejects.toBeInstanceOf(NotFoundError);
    await expect(as(b.actor, (s) => purgeFromTrash(s, "design", c.designId))).rejects.toBeInstanceOf(NotFoundError);
    // Gestor sem acesso total só vê na lixeira o que ele mesmo excluiu.
    const manager = await addMember(a.org.slug, a.org.id, "manager");
    expect((await as(manager, (s) => listTrash(s))).map((i) => i.id)).toContain(c.designId);
    await as(a.actor, (s) => restoreFromTrash(s, "design", c.designId));
  });

  it("excluir definitivamente apaga o cliente e mantém despesas da agência", async () => {
    const c = await seedClient(a, "Gama");
    const [version] = await withSystem((tx) =>
      tx.select({ key: fileVersions.storageKey }).from(fileVersions).where(eq(fileVersions.fileId, c.fileId)),
    );
    expect(await getStorage().exists(version!.key)).toBe(true);
    await as(a.actor, (s) => trashClient(s, c.clientId, { confirmFinance: true }));
    await as(a.actor, (s) => purgeFromTrash(s, "client", c.clientId));

    const left = await withSystem(async (tx) => ({
      clients: await tx.select().from(clients).where(eq(clients.id, c.clientId)),
      projects: await tx.select().from(projects).where(eq(projects.id, c.projectId)),
      tasks: await tx.select().from(tasks).where(eq(tasks.id, c.taskId)),
      files: await tx.select().from(files).where(eq(files.id, c.fileId)),
      designs: await tx.select().from(designs).where(eq(designs.id, c.designId)),
      invoices: await tx.select().from(invoices).where(eq(invoices.clientId, c.clientId)),
      expenses: await tx
        .select()
        .from(expenses)
        .where(and(eq(expenses.organizationId, a.org.id), eq(expenses.description, "Banco de imagens"))),
    }));
    expect(left.clients).toHaveLength(0);
    expect(left.projects).toHaveLength(0);
    expect(left.tasks).toHaveLength(0);
    expect(left.files).toHaveLength(0);
    expect(left.designs).toHaveLength(0);
    expect(left.invoices).toHaveLength(0);
    // Despesas são da agência: ficam, sem o vínculo.
    expect(left.expenses.some((e) => e.clientId === null && e.projectId === null)).toBe(true);

    // O arquivo só sai do armazenamento quando o evento é processado (depois do commit).
    const [ev] = await withSystem((tx) => tx.select().from(domainEvents).where(eq(domainEvents.type, "storage.purge")));
    expect((ev!.payload as { keys: string[] }).keys).toContain(version!.key);
    await dispatchPendingEvents(100);
    expect(await getStorage().exists(version!.key)).toBe(false);
    expect((await as(a.actor, (s) => listTrash(s))).map((i) => i.id)).not.toContain(c.clientId);
  });

  it("excluir um projeto de vez mantém arquivos, solicitações e faturas no cliente", async () => {
    const c = await seedClient(a, "Delta");
    await as(a.actor, (s) => trashProject(s, c.projectId));
    await expect(as(a.actor, (s) => getFile(s, c.fileId))).rejects.toBeInstanceOf(NotFoundError);
    await as(a.actor, (s) => purgeFromTrash(s, "project", c.projectId));
    const file = await as(a.actor, (s) => getFile(s, c.fileId));
    expect(file.file.projectId).toBeNull();
    expect(file.file.clientId).toBe(c.clientId);
    const inv = await as(a.actor, (s) => listInvoices(s, {}, c.clientId));
    expect(inv.rows[0]?.projectId).toBeNull();
    expect((await as(a.actor, (s) => listRequests(s, {}))).rows.map((r) => r.id)).toContain(c.requestId);
    expect((await as(a.actor, (s) => getDesign(s, c.designId))).design.clientId).toBe(c.clientId);
  });

  it("agência: só o proprietário exclui, todos perdem o acesso e ele pode restaurar", async () => {
    const ctx = await createOrgWithOwner("Agência Temporária");
    const admin = await addMember(ctx.org.slug, ctx.org.id, "admin");
    await expect(as(admin, (s) => trashOrganization(s, "Agência Temporária"))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(as(ctx.actor, (s) => trashOrganization(s, "outra"))).rejects.toBeInstanceOf(ValidationError);
    await as(ctx.actor, (s) => trashOrganization(s, "Agência Temporária"));

    expect(await resolveActor(ctx.owner.id, ctx.org.slug)).toBeNull();
    expect(await resolveActor(admin.userId, ctx.org.slug)).toBeNull();
    expect((await listUserOrganizations(ctx.owner.id)).map((o) => o.id)).not.toContain(ctx.org.id);
    expect((await listTrashedOrganizations(admin.userId)).length).toBe(0);
    await expect(restoreOrganization(admin.userId, ctx.org.id)).rejects.toBeInstanceOf(NotFoundError);
    // Outra agência não é afetada.
    expect(await resolveActor(a.owner.id, a.org.slug)).not.toBeNull();

    const trashed = await listTrashedOrganizations(ctx.owner.id);
    expect(trashed.map((o) => o.id)).toEqual([ctx.org.id]);
    await restoreOrganization(ctx.owner.id, ctx.org.id);
    expect(await resolveActor(admin.userId, ctx.org.slug)).not.toBeNull();
  });

  it("a rotina diária apaga de vez o que passou de 30 dias", async () => {
    const ctx = await createOrgWithOwner("Agência Expirada");
    const c = await seedClient(ctx, "Epsilon");
    const design = await as(a.actor, (s) => createDesign(s, { name: "Arte velha", width: 50, height: 50 }));
    await as(a.actor, (s) => trashDesign(s, design.id));
    await as(ctx.actor, (s) => trashOrganization(s, "Agência Expirada"));

    // Antes do prazo nada é apagado.
    let res = await purgeExpiredTrash(new Date(Date.now() + 29 * 86_400_000));
    expect(res.organizations).toBe(0);
    expect(res.designs).toBe(0);

    res = await purgeExpiredTrash(new Date(Date.now() + 31 * 86_400_000));
    expect(res.organizations).toBe(1);
    expect(res.designs).toBeGreaterThanOrEqual(1);
    const gone = await withSystem((tx) => tx.select().from(clients).where(eq(clients.id, c.clientId)));
    expect(gone).toHaveLength(0);
    expect(await listTrashedOrganizations(ctx.owner.id)).toHaveLength(0);
    // A agência A continua intacta.
    expect(await resolveActor(a.owner.id, a.org.slug)).not.toBeNull();
  });
});
