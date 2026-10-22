import { beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@/server/services/clients";
import { createDesign, getDesign, listDesigns } from "@/server/services/designs";
import { createProject } from "@/server/services/projects";
import { createTask } from "@/server/services/tasks";
import { as, createOrgWithOwner, resetDb } from "./helpers";

type Ctx = Awaited<ReturnType<typeof createOrgWithOwner>>;

describe("artes ligadas a demandas e projetos", () => {
  let ctx: Ctx;
  let clientId: string;
  let projectId: string;
  let taskId: string;

  beforeAll(async () => {
    await resetDb();
    ctx = await createOrgWithOwner("Agência Artes");
    clientId = (await as(ctx.actor, (s) => createClient(s, { name: "Cliente Artes" }))).id;
    projectId = (await as(ctx.actor, (s) => createProject(s, { clientId, name: "Projeto Artes" }))).id;
    taskId = (await as(ctx.actor, (s) => createTask(s, { projectId, title: "Carrossel de lançamento" }))).id;
  });

  it("arte criada pela demanda herda projeto e cliente e aparece na demanda e no projeto", async () => {
    const d = await as(ctx.actor, (s) =>
      createDesign(s, { name: "Carrossel", width: 1080, height: 1350, taskId, preset: "carousel-portrait", carousel: true, pages: 3 }),
    );
    const got = await as(ctx.actor, (s) => getDesign(s, d.id));
    expect(got.design).toMatchObject({ taskId, projectId, clientId });

    const loose = await as(ctx.actor, (s) => createDesign(s, { name: "Avulsa", width: 1080, height: 1080, projectId }));
    const byTask = await as(ctx.actor, (s) => listDesigns(s, { taskId }));
    expect(byTask.map((x) => x.id)).toEqual([d.id]);
    expect(byTask[0]?.pageCount).toBe(3);
    const byProject = await as(ctx.actor, (s) => listDesigns(s, { projectId }));
    expect(byProject.map((x) => x.id).sort()).toEqual([d.id, loose.id].sort());
    expect((await as(ctx.actor, (s) => listDesigns(s, { projectId, limit: 1 })))).toHaveLength(1);
  });

  it("demanda de outro projeto ou de outra agência é recusada", async () => {
    const other = await as(ctx.actor, (s) => createProject(s, { clientId, name: "Outro projeto" }));
    await expect(
      as(ctx.actor, (s) => createDesign(s, { name: "X", width: 100, height: 100, taskId, projectId: other.id })),
    ).rejects.toThrow(/não pertence ao projeto/);
    const foreign = await createOrgWithOwner("Agência Alheia");
    await expect(
      as(foreign.actor, (s) => createDesign(s, { name: "X", width: 100, height: 100, taskId })),
    ).rejects.toThrow();
  });
});
