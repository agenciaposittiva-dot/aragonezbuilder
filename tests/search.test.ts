import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withSystem } from "@/server/db";
import { clientMembers } from "@/server/db/schema";
import { createClient } from "@/server/services/clients";
import { createDesign } from "@/server/services/designs";
import { globalSearch } from "@/server/services/search";
import { addMember, as, createOrgWithOwner, resetDb } from "./helpers";

/*
 * Busca global (⌘K): artes do Estúdio Criador entram nos resultados, dentro do
 * escopo de clientes de quem busca — nunca uma arte de cliente fora do escopo.
 */

describe("busca global — artes do Estúdio", () => {
  let ctx: Awaited<ReturnType<typeof createOrgWithOwner>>;
  let clientA: string;
  let clientB: string;

  beforeAll(async () => {
    await resetDb();
    ctx = await createOrgWithOwner("Agência Busca");
    clientA = (await as(ctx.actor, (s) => createClient(s, { name: "Cliente Alfa" }))).id;
    clientB = (await as(ctx.actor, (s) => createClient(s, { name: "Cliente Beta" }))).id;
    await as(ctx.actor, (s) =>
      createDesign(s, { name: "Campanha Verão Alfa", width: 1080, height: 1080, clientId: clientA }),
    );
    await as(ctx.actor, (s) =>
      createDesign(s, { name: "Campanha Verão Beta", width: 1080, height: 1080, clientId: clientB }),
    );
    await as(ctx.actor, (s) => createDesign(s, { name: "Verão interno", width: 1080, height: 1350 }));
    await as(ctx.actor, (s) =>
      createDesign(s, {
        name: "Modelo Verão",
        width: 1080,
        height: 1350,
        isTemplate: true,
        templateCategory: "editorial",
      }),
    );
  });

  afterAll(async () => {
    await resetDb();
  });

  it("quem vê todos os clientes encontra as artes (com cliente, internas e templates) e abre o editor", async () => {
    const hits = await as(ctx.actor, (s) => globalSearch(s, "verão"));
    const designs = hits.filter((h) => h.type === "design");
    expect(designs.map((h) => h.title).sort()).toEqual([
      "Campanha Verão Alfa",
      "Campanha Verão Beta",
      "Modelo Verão",
      "Verão interno",
    ]);
    const alfa = designs.find((h) => h.title === "Campanha Verão Alfa")!;
    expect(alfa.subtitle).toBe("Cliente Alfa");
    expect(alfa.href).toMatch(new RegExp(`^/w/${ctx.org.slug}/studio/[0-9a-f-]{36}$`));
    expect(designs.find((h) => h.title === "Modelo Verão")?.subtitle).toBe("Template");
  });

  it("colaborador com acesso só ao cliente Alfa não vê a arte do cliente Beta", async () => {
    // Colaborador (sem "todos os clientes") só vê clientes da equipe dele (client_members) ou de projetos atribuídos.
    const collaborator = await addMember(ctx.org.slug, ctx.org.id, "collaborator");
    await withSystem((tx) =>
      tx
        .insert(clientMembers)
        .values({ organizationId: ctx.org.id, clientId: clientA, membershipId: collaborator.membershipId }),
    );
    const hits = await as(collaborator, (s) => globalSearch(s, "verão"));
    const titles = hits.filter((h) => h.type === "design").map((h) => h.title);
    expect(titles).toContain("Campanha Verão Alfa");
    expect(titles).toContain("Verão interno");
    expect(titles).not.toContain("Campanha Verão Beta");
  });
});
