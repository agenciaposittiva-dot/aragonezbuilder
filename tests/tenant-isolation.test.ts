import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { withOrg } from "@/server/db";
import { clients, projects } from "@/server/db/schema";
import { createClient, getClient, listClients, updateClient } from "@/server/services/clients";
import { createProject, getProject, listProjects } from "@/server/services/projects";
import { addMember, as, createOrgWithOwner, resetDb } from "./helpers";

describe("isolamento entre organizações", () => {
  let a: Awaited<ReturnType<typeof createOrgWithOwner>>;
  let b: Awaited<ReturnType<typeof createOrgWithOwner>>;
  let clientA: string;
  let projectA: string;

  beforeAll(async () => {
    await resetDb();
    a = await createOrgWithOwner("Agência A");
    b = await createOrgWithOwner("Agência B");
    clientA = (await as(a.actor, (s) => createClient(s, { name: "Cliente da A" }))).id;
    projectA = (await as(a.actor, (s) => createProject(s, { clientId: clientA, name: "Projeto da A" }))).id;
  });

  it("listagens de uma organização não trazem dados da outra", async () => {
    const listB = await as(b.actor, (s) => listClients(s, {}));
    expect(listB.rows).toHaveLength(0);
    const projectsB = await as(b.actor, (s) => listProjects(s, {}));
    expect(projectsB.rows).toHaveLength(0);
  });

  it("acesso direto por id a registro de outra organização retorna não encontrado", async () => {
    await expect(as(b.actor, (s) => getClient(s, clientA))).rejects.toThrow(/não encontrado/i);
    await expect(as(b.actor, (s) => getProject(s, projectA))).rejects.toThrow(/não encontrado/i);
  });

  it("não é possível editar registro de outra organização", async () => {
    await expect(as(b.actor, (s) => updateClient(s, clientA, { name: "Invadido" }))).rejects.toThrow();
    const [row] = await withOrg(a.org.id, (tx) => tx.select().from(clients).where(eq(clients.id, clientA)));
    expect(row?.name).toBe("Cliente da A");
  });

  it("não é possível criar projeto da organização B apontando para cliente da A", async () => {
    await expect(
      as(b.actor, (s) => createProject(s, { clientId: clientA, name: "Projeto cruzado" })),
    ).rejects.toThrow();
  });

  it("o RLS do banco bloqueia leitura sem filtro de organização", async () => {
    // Consulta propositalmente SEM where organization_id: o RLS deve restringir à organização da transação.
    const rowsSeenByB = await withOrg(b.org.id, (tx) => tx.select().from(projects));
    expect(rowsSeenByB).toHaveLength(0);
    const rowsSeenByA = await withOrg(a.org.id, (tx) => tx.select().from(projects));
    expect(rowsSeenByA.map((p) => p.id)).toContain(projectA);
  });

  it("o RLS do banco bloqueia inserção em outra organização", async () => {
    const err = await withOrg(b.org.id, (tx) =>
      tx.insert(clients).values({ organizationId: a.org.id, name: "Injetado" }),
    ).catch((e: Error & { cause?: Error }) => e);
    expect(err).toBeInstanceOf(Error);
    expect(String((err as Error & { cause?: Error }).cause?.message)).toMatch(/row-level security/i);
  });
});

describe("permissões por papel", () => {
  let a: Awaited<ReturnType<typeof createOrgWithOwner>>;
  let clientId: string;

  beforeAll(async () => {
    await resetDb();
    a = await createOrgWithOwner("Agência Permissões");
    clientId = (await as(a.actor, (s) => createClient(s, { name: "Cliente X" }))).id;
  });

  it("designer não cria clientes", async () => {
    const designer = await addMember(a.org.slug, a.org.id, "designer");
    await expect(as(designer, (s) => createClient(s, { name: "Novo" }))).rejects.toThrow(/permissão/i);
  });

  it("colaborador só vê projetos em que participa", async () => {
    const visible = (await as(a.actor, (s) => createProject(s, { clientId, name: "Com colaborador" }))).id;
    await as(a.actor, (s) => createProject(s, { clientId, name: "Sem colaborador" }));
    const collaborator = await addMember(a.org.slug, a.org.id, "collaborator");
    // adiciona o colaborador à equipe de um dos projetos
    const { setProjectMembers } = await import("@/server/services/projects");
    await as(a.actor, (s) => setProjectMembers(s, { projectId: visible, membershipIds: [collaborator.membershipId] }));
    const list = await as(collaborator, (s) => listProjects(s, {}));
    expect(list.rows.map((r) => r.name)).toEqual(["Com colaborador"]);
  });

  it("usuário de cliente só enxerga o próprio cliente", async () => {
    const other = (await as(a.actor, (s) => createClient(s, { name: "Outro cliente" }))).id;
    const clientUser = await addMember(a.org.slug, a.org.id, "client", { clientIds: [clientId] });
    await expect(as(clientUser, (s) => getClient(s, other))).rejects.toThrow(/não encontrado/i);
    const own = await as(clientUser, (s) => getClient(s, clientId));
    expect(own.client.name).toBe("Cliente X");
    // dados internos não são expostos ao cliente
    expect(own.client.notesInternal).toBeNull();
    expect(own.contacts).toEqual([]);
  });

  it("valores financeiros ficam ocultos sem permissão de financeiro", async () => {
    const { saveService } = await import("@/server/services/clients");
    await as(a.actor, (s) => saveService(s, { clientId, name: "Gestão de redes", amount: "2500,00" }));
    const designer = await addMember(a.org.slug, a.org.id, "account");
    const seen = await as(designer, (s) => getClient(s, clientId));
    expect(seen.services[0]?.amountCents).toBeNull();
    const owner = await as(a.actor, (s) => getClient(s, clientId));
    expect(owner.services[0]?.amountCents).toBe(250000);
  });
});
