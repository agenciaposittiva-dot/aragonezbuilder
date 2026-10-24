import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { todayISO } from "@/lib/format";
import { addDays } from "@/lib/recurrence";
import { withOrg } from "@/server/db";
import { taskRecurrences, tasks } from "@/server/db/schema";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import { createClient } from "@/server/services/clients";
import { createProject } from "@/server/services/projects";
import { deleteReference, listReferences, saveReference } from "@/server/services/references";
import {
  deleteRoutine,
  generateRoutineTasks,
  listRoutines,
  saveRoutine,
  setRoutineActive,
} from "@/server/services/task-routines";
import { addMember, as, createOrgWithOwner, resetDb } from "./helpers";

type Ctx = Awaited<ReturnType<typeof createOrgWithOwner>>;

describe("rotina (tarefas recorrentes)", () => {
  let ctx: Ctx;
  let projectId: string;
  const today = todayISO();

  beforeAll(async () => {
    await resetDb();
    ctx = await createOrgWithOwner("Agência Rotina");
    const clientId = (await as(ctx.actor, (s) => createClient(s, { name: "Cliente Rotina" }))).id;
    projectId = (await as(ctx.actor, (s) => createProject(s, { clientId, name: "Projeto Rotina" }))).id;
  });

  it("gera a tarefa no dia, com prazo e responsável, e nunca duplica", async () => {
    const r = await as(ctx.actor, (s) =>
      saveRoutine(s, {
        projectId,
        title: "Organizar pastas do cliente",
        frequency: "daily",
        interval: 1,
        dueInDays: 2,
        assigneeMembershipId: ctx.actor.membershipId,
      }),
    );
    expect(r.nextRunOn).toBe(today);
    const first = await generateRoutineTasks(today);
    expect(first.created).toBe(1);
    // Rodar de novo no mesmo dia (worker + cron) não cria outra.
    expect((await generateRoutineTasks(today)).created).toBe(0);
    const made = await withOrg(ctx.org.id, (tx) => tx.select().from(tasks).where(eq(tasks.recurrenceId, r.id)));
    expect(made).toHaveLength(1);
    expect(made[0]).toMatchObject({
      title: "Organizar pastas do cliente",
      dueDate: addDays(today, 2),
      assigneeMembershipId: ctx.actor.membershipId,
      recurrenceOn: today,
    });
    const [rule] = await withOrg(ctx.org.id, (tx) =>
      tx.select().from(taskRecurrences).where(eq(taskRecurrences.id, r.id)),
    );
    expect(rule).toMatchObject({ nextRunOn: addDays(today, 1), lastRunOn: today });
    // No dia seguinte, a próxima.
    expect((await generateRoutineTasks(addDays(today, 1))).created).toBe(1);
    const rows = await as(ctx.actor, listRoutines);
    expect(rows.find((x) => x.id === r.id)).toMatchObject({ generated: 2, ruleText: "Todos os dias" });
  });

  it("pausada não gera; ao retomar recomeça de hoje; excluir mantém as tarefas", async () => {
    const r = await as(ctx.actor, (s) =>
      saveRoutine(s, {
        projectId,
        title: "Relatório semanal",
        frequency: "weekly",
        interval: 1,
        weekday: new Date(`${today}T12:00:00Z`).getUTCDay(),
      }),
    );
    await as(ctx.actor, (s) => setRoutineActive(s, r.id, false));
    expect((await generateRoutineTasks(today)).created).toBe(0);
    await as(ctx.actor, (s) => setRoutineActive(s, r.id, true));
    expect((await generateRoutineTasks(today)).created).toBe(1);
    await as(ctx.actor, (s) => deleteRoutine(s, r.id));
    const kept = await withOrg(ctx.org.id, (tx) => tx.select().from(tasks).where(eq(tasks.title, "Relatório semanal")));
    expect(kept).toHaveLength(1);
    expect(kept[0]!.recurrenceId).toBeNull();
  });

  it("validação e permissões", async () => {
    await expect(
      as(ctx.actor, (s) => saveRoutine(s, { projectId, title: "Sem dia", frequency: "weekly", interval: 1 })),
    ).rejects.toThrow();
    await expect(
      as(ctx.actor, (s) =>
        saveRoutine(s, { projectId, title: "Dia 31", frequency: "monthly", interval: 1, monthday: 31 }),
      ),
    ).rejects.toThrow();
    const finance = await addMember(ctx.org.slug, ctx.org.id, "finance");
    await expect(
      as(finance, (s) => saveRoutine(s, { projectId, title: "X", frequency: "daily", interval: 1 })),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("biblioteca de referências", () => {
  let ctx: Ctx;
  let clientId: string;

  beforeAll(async () => {
    ctx = await createOrgWithOwner("Agência Referências");
    clientId = (await as(ctx.actor, (s) => createClient(s, { name: "Cliente Ref" }))).id;
  });

  it("identifica a origem pelo endereço, monta a miniatura do YouTube e filtra", async () => {
    await as(ctx.actor, (s) =>
      saveReference(s, { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", tags: ["Reels", "Gancho"], clientId }),
    );
    await as(ctx.actor, (s) =>
      saveReference(s, { url: "https://br.pinterest.com/pin/123456/", title: "Paleta outono" }),
    );
    await as(ctx.actor, (s) =>
      saveReference(s, { url: "https://www.instagram.com/p/ABC123/", note: "Carrossel com dados" }),
    );
    const all = await as(ctx.actor, (s) => listReferences(s));
    expect(all.map((r) => r.kind).sort()).toEqual(["instagram", "pinterest", "youtube"]);
    const yt = all.find((r) => r.kind === "youtube")!;
    expect(yt.thumbnail).toBe("https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg");
    expect(yt.tags).toEqual(["reels", "gancho"]);
    expect(yt.title).toContain("youtube.com");
    expect((await as(ctx.actor, (s) => listReferences(s, { kind: "pinterest" }))).map((r) => r.title)).toEqual([
      "Paleta outono",
    ]);
    expect((await as(ctx.actor, (s) => listReferences(s, { q: "dados" }))).map((r) => r.kind)).toEqual(["instagram"]);
    expect((await as(ctx.actor, (s) => listReferences(s, { q: "reels" }))).map((r) => r.kind)).toEqual(["youtube"]);
    expect((await as(ctx.actor, (s) => listReferences(s, { clientId }))).map((r) => r.kind)).toEqual(["youtube"]);
  });

  it("só https; isolamento entre agências; quem não envia arquivos não salva", async () => {
    await expect(as(ctx.actor, (s) => saveReference(s, { url: "http://site.com" }))).rejects.toThrow();
    await expect(as(ctx.actor, (s) => saveReference(s, { url: "javascript:alert(1)" }))).rejects.toThrow();
    const other = await createOrgWithOwner("Agência Outra Ref");
    expect(await as(other.actor, (s) => listReferences(s))).toEqual([]);
    const mine = (await as(ctx.actor, (s) => listReferences(s)))[0]!;
    await expect(as(other.actor, (s) => deleteReference(s, mine.id))).rejects.toBeInstanceOf(NotFoundError);
    const finance = await addMember(ctx.org.slug, ctx.org.id, "finance");
    await expect(as(finance, (s) => saveReference(s, { url: "https://exemplo.com" }))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(
      as(ctx.actor, (s) =>
        saveReference(s, { url: "https://exemplo.com", clientId, projectId: "00000000-0000-0000-0000-000000000000" }),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
