import { beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import {
  clientCategoryTree,
  deleteClientCategory,
  listClientCategories,
  reorderClientCategories,
  saveClientCategory,
  setClientCategory,
} from "@/server/services/client-categories";
import { createClient, getClient, listClients, setClientArchived, updateClient } from "@/server/services/clients";
import { createProject, listProjects } from "@/server/services/projects";
import { addMember, as, createOrgWithOwner, resetDb } from "./helpers";

type Ctx = Awaited<ReturnType<typeof createOrgWithOwner>>;

describe("categorias de clientes", () => {
  let ctx: Ctx;
  let other: Ctx;

  beforeAll(async () => {
    await resetDb();
    ctx = await createOrgWithOwner("Agência Categorias");
    other = await createOrgWithOwner("Agência Vizinha");
  });

  it("toda agência nova começa com as categorias padrão, na ordem", async () => {
    const { categories, uncategorized } = await as(ctx.actor, listClientCategories);
    expect(categories.map((c) => c.name)).toEqual(["Clientes ativos", "Projetos avulsos", "Ex-clientes"]);
    expect(categories.every((c) => c.count === 0)).toBe(true);
    expect(uncategorized).toBe(0);
  });

  it("criar, renomear, reordenar e nome único (sem diferenciar maiúsculas)", async () => {
    const vip = await as(ctx.actor, (s) => saveClientCategory(s, { name: "Contas VIP", color: "violet" }));
    await expect(as(ctx.actor, (s) => saveClientCategory(s, { name: "contas vip" }))).rejects.toBeInstanceOf(
      ValidationError,
    );
    await as(ctx.actor, (s) => saveClientCategory(s, { id: vip.id, name: "Contas estratégicas", color: "blue" }));
    let { categories } = await as(ctx.actor, listClientCategories);
    expect(categories.at(-1)).toMatchObject({ id: vip.id, name: "Contas estratégicas", color: "blue" });

    const ids = categories.map((c) => c.id);
    await as(ctx.actor, (s) => reorderClientCategories(s, { ids: [vip.id, ...ids.filter((i) => i !== vip.id)] }));
    ({ categories } = await as(ctx.actor, listClientCategories));
    expect(categories[0]!.id).toBe(vip.id);
  });

  it("mover um cliente não duplica nada e preserva projetos; contagens e filtro acompanham", async () => {
    const { categories } = await as(ctx.actor, listClientCategories);
    const active = categories.find((c) => c.name === "Clientes ativos")!;
    const former = categories.find((c) => c.name === "Ex-clientes")!;
    const c = await as(ctx.actor, (s) => createClient(s, { name: "Padaria Sol", categoryId: active.id }));
    const p = await as(ctx.actor, (s) => createProject(s, { clientId: c.id, name: "Cardápio" }));
    await as(ctx.actor, (s) => createClient(s, { name: "Sem categoria Ltda" }));

    let list = await as(ctx.actor, listClientCategories);
    expect(list.categories.find((x) => x.id === active.id)!.count).toBe(1);
    expect(list.uncategorized).toBe(1);

    await as(ctx.actor, (s) => setClientCategory(s, { clientId: c.id, categoryId: former.id }));
    list = await as(ctx.actor, listClientCategories);
    expect(list.categories.find((x) => x.id === active.id)!.count).toBe(0);
    expect(list.categories.find((x) => x.id === former.id)!.count).toBe(1);
    const filtered = await as(ctx.actor, (s) => listClients(s, { category: former.id }));
    expect(filtered.rows.map((r) => r.id)).toEqual([c.id]);
    expect((await as(ctx.actor, (s) => listClients(s, { category: "none" }))).rows.map((r) => r.name)).toEqual([
      "Sem categoria Ltda",
    ]);
    // Mesmo cliente, mesmos projetos: nada foi copiado.
    expect((await as(ctx.actor, (s) => listClients(s, {}))).total).toBe(2);
    expect((await as(ctx.actor, (s) => listProjects(s, { clientId: c.id }))).rows.map((r) => r.id)).toEqual([p.id]);

    // Editar o cliente por outro formulário (sem categoria na entrada) mantém a categoria.
    await as(ctx.actor, (s) => updateClient(s, c.id, { name: "Padaria Sol & Lua" }));
    expect((await as(ctx.actor, (s) => getClient(s, c.id))).client.categoryId).toBe(former.id);
    // Arquivado some da contagem do menu.
    await as(ctx.actor, (s) => setClientArchived(s, c.id, true));
    expect((await as(ctx.actor, listClientCategories)).categories.find((x) => x.id === former.id)!.count).toBe(0);
    await as(ctx.actor, (s) => setClientArchived(s, c.id, false));

    const tree = await as(ctx.actor, (s) => clientCategoryTree(s));
    expect(tree.clients.find((x) => x.id === c.id)?.categoryId).toBe(former.id);
  });

  it("excluir a categoria deixa os clientes sem categoria (nenhum cliente é apagado)", async () => {
    const tmp = await as(ctx.actor, (s) => saveClientCategory(s, { name: "Temporária" }));
    const c = await as(ctx.actor, (s) => createClient(s, { name: "Cliente temporário", categoryId: tmp.id }));
    const res = await as(ctx.actor, (s) => deleteClientCategory(s, tmp.id));
    expect(res.moved).toBe(1);
    expect((await as(ctx.actor, (s) => getClient(s, c.id))).client.categoryId).toBeNull();
    await expect(as(ctx.actor, (s) => deleteClientCategory(s, tmp.id))).rejects.toBeInstanceOf(NotFoundError);
  });

  it("isolamento entre agências e permissões", async () => {
    const mine = (await as(ctx.actor, listClientCategories)).categories[0]!;
    const theirs = (await as(other.actor, listClientCategories)).categories;
    expect(theirs.map((c) => c.id)).not.toContain(mine.id);
    const c = await as(ctx.actor, (s) => createClient(s, { name: "Cliente isolado" }));
    // Categoria de outra agência não existe para esta (RLS): recusada.
    await expect(
      as(ctx.actor, (s) => setClientCategory(s, { clientId: c.id, categoryId: theirs[0]!.id })),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      as(ctx.actor, (s) => createClient(s, { name: "Com categoria alheia", categoryId: theirs[0]!.id })),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(as(other.actor, (s) => deleteClientCategory(s, mine.id))).rejects.toBeInstanceOf(NotFoundError);

    // Designer vê, mas não organiza categorias.
    const designer = await addMember(ctx.org.slug, ctx.org.id, "designer");
    expect((await as(designer, listClientCategories)).categories.length).toBeGreaterThan(0);
    await expect(as(designer, (s) => saveClientCategory(s, { name: "Minha" }))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      as(designer, (s) => setClientCategory(s, { clientId: c.id, categoryId: mine.id })),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("colaborador só conta os clientes que enxerga", async () => {
    const cat = (await as(ctx.actor, listClientCategories)).categories[0]!;
    await as(ctx.actor, (s) => createClient(s, { name: "Cliente oculto", categoryId: cat.id }));
    const collaborator = await addMember(ctx.org.slug, ctx.org.id, "collaborator");
    const seen = await as(collaborator, listClientCategories);
    expect(seen.categories.find((c) => c.id === cat.id)!.count).toBe(0);
    expect((await as(collaborator, (s) => clientCategoryTree(s))).clients).toEqual([]);
  });
});
