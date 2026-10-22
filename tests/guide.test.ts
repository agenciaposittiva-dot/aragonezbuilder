import { beforeAll, describe, expect, it } from "vitest";
import type { Actor } from "@/server/authz";
import { createClient } from "@/server/services/clients";
import { guideSteps } from "@/server/services/guide";
import { createProject } from "@/server/services/projects";
import { createTask } from "@/server/services/tasks";
import { addMember, as, createOrgWithOwner, resetDb } from "./helpers";

type Ctx = Awaited<ReturnType<typeof createOrgWithOwner>>;

describe("Me guie: primeiros passos com dados reais", () => {
  let ctx: Ctx;
  const doneOf = async (actor: Actor) =>
    Object.fromEntries((await as(actor, (s) => guideSteps(s))).map((st) => [st.key, st.done]));

  beforeAll(async () => {
    await resetDb();
    ctx = await createOrgWithOwner("Agência Guia");
  });

  it("agência nova: todos os passos pendentes, com destino em cada um", async () => {
    const steps = await as(ctx.actor, (s) => guideSteps(s));
    expect(steps.map((st) => st.key)).toEqual([
      "logo",
      "client",
      "team",
      "project",
      "demand",
      "design",
      "ai",
      "portal",
      "brand",
    ]);
    expect(steps.every((st) => !st.done)).toBe(true);
    expect(steps.every((st) => st.path.startsWith("/"))).toBe(true);
  });

  it("os passos se completam com o que existe no banco", async () => {
    const clientId = (await as(ctx.actor, (s) => createClient(s, { name: "Cliente Guia" }))).id;
    const projectId = (await as(ctx.actor, (s) => createProject(s, { clientId, name: "Projeto Guia" }))).id;
    await as(ctx.actor, (s) => createTask(s, { projectId, title: "Primeira demanda" }));
    await addMember(ctx.org.slug, ctx.org.id, "designer", { name: "Dani" });
    expect(await doneOf(ctx.actor)).toMatchObject({
      client: true,
      project: true,
      demand: true,
      team: true,
      logo: false,
      design: false,
      ai: false,
      portal: false,
      brand: false,
    });
  });

  it("cada pessoa só vê os passos que pode fazer", async () => {
    const finance = await addMember(ctx.org.slug, ctx.org.id, "finance", { name: "Fábio" });
    const keys = (await as(finance, (s) => guideSteps(s))).map((st) => st.key);
    expect(keys).not.toContain("logo");
    expect(keys).not.toContain("team");
    expect(keys).not.toContain("ai");
    expect(keys).not.toContain("design");
  });
});
