import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NotFoundError } from "@/server/errors";
import { createClient } from "@/server/services/clients";
import { createDesign, listDesigns, toggleDesignFavorite } from "@/server/services/designs";
import { addMember, as, createOrgWithOwner, resetDb } from "./helpers";

/*
 * Favoritos de modelos do Estúdio Criador: por pessoa, dentro do escopo de
 * artes que ela pode ver; o filtro "favoritos" devolve só os dela.
 */

describe("favoritos de modelos", () => {
  let ctx: Awaited<ReturnType<typeof createOrgWithOwner>>;
  let templateA: string;
  let templateB: string;
  let clientTemplate: string;

  beforeAll(async () => {
    await resetDb();
    ctx = await createOrgWithOwner("Agência Favoritos");
    const clientId = (await as(ctx.actor, (s) => createClient(s, { name: "Cliente Favorito" }))).id;
    const mk = (name: string, extra: Record<string, unknown> = {}) =>
      as(ctx.actor, (s) =>
        createDesign(s, { name, width: 1080, height: 1350, isTemplate: true, templateCategory: "editorial", ...extra }),
      );
    templateA = (await mk("Modelo A")).id;
    templateB = (await mk("Modelo B")).id;
    clientTemplate = (await mk("Modelo do cliente", { clientId })).id;
  });

  afterAll(async () => {
    await resetDb();
  });

  it("marca e desmarca; a listagem traz o sinal e o filtro devolve só os favoritos da pessoa", async () => {
    expect(await as(ctx.actor, (s) => toggleDesignFavorite(s, templateA))).toEqual({ favorite: true });
    let all = await as(ctx.actor, (s) => listDesigns(s, { templates: true }));
    expect(all.find((t) => t.id === templateA)?.favorite).toBe(true);
    expect(all.find((t) => t.id === templateB)?.favorite).toBe(false);
    const favorites = await as(ctx.actor, (s) => listDesigns(s, { templates: true, favorites: true }));
    expect(favorites.map((t) => t.id)).toEqual([templateA]);

    // Outra pessoa da agência não herda o favorito.
    const designer = await addMember(ctx.org.slug, ctx.org.id, "designer");
    const theirs = await as(designer, (s) => listDesigns(s, { templates: true, favorites: true }));
    expect(theirs).toEqual([]);
    expect(
      (await as(designer, (s) => listDesigns(s, { templates: true }))).find((t) => t.id === templateA)?.favorite,
    ).toBe(false);

    expect(await as(ctx.actor, (s) => toggleDesignFavorite(s, templateA))).toEqual({ favorite: false });
    all = await as(ctx.actor, (s) => listDesigns(s, { templates: true, favorites: true }));
    expect(all).toEqual([]);
  });

  it("só o que a pessoa pode ver pode ser favoritado (modelo de cliente fora do escopo: não encontrado)", async () => {
    const collaborator = await addMember(ctx.org.slug, ctx.org.id, "collaborator");
    await expect(as(collaborator, (s) => toggleDesignFavorite(s, clientTemplate))).rejects.toBeInstanceOf(
      NotFoundError,
    );
    // Modelos sem cliente são da agência inteira: pode favoritar.
    expect(await as(collaborator, (s) => toggleDesignFavorite(s, templateB))).toEqual({ favorite: true });
  });
});
