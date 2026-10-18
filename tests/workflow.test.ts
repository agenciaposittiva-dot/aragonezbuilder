import { beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@/server/services/clients";
import { changeProjectStatus, createProject, getProject } from "@/server/services/projects";
import { listStatuses } from "@/server/services/workflow";
import { as, createOrgWithOwner, resetDb } from "./helpers";

describe("fluxo de status de projetos", () => {
  let ctx: Awaited<ReturnType<typeof createOrgWithOwner>>;
  let projectId: string;
  let byKey: Record<string, string>;

  beforeAll(async () => {
    await resetDb();
    ctx = await createOrgWithOwner("Agência Fluxo");
    const clientId = (await as(ctx.actor, (s) => createClient(s, { name: "Cliente" }))).id;
    projectId = (await as(ctx.actor, (s) => createProject(s, { clientId, name: "Projeto" }))).id;
    const statuses = await as(ctx.actor, (s) => listStatuses(s, "project"));
    byKey = Object.fromEntries(statuses.map((st) => [st.key, st.id]));
  });

  it("novo projeto começa no status padrão", async () => {
    const p = await as(ctx.actor, (s) => getProject(s, projectId));
    expect(p.status.key).toBe("planning");
  });

  it("aceita transição válida e registra conclusão", async () => {
    await as(ctx.actor, (s) => changeProjectStatus(s, projectId, byKey.active!));
    await as(ctx.actor, (s) => changeProjectStatus(s, projectId, byKey.done!));
    const p = await as(ctx.actor, (s) => getProject(s, projectId));
    expect(p.status.key).toBe("done");
    expect(p.project.completedAt).not.toBeNull();
  });

  it("recusa transição não permitida", async () => {
    // done → planning não está nas transições padrão
    await expect(as(ctx.actor, (s) => changeProjectStatus(s, projectId, byKey.planning!))).rejects.toThrow(
      /não permitida/i,
    );
  });
});
