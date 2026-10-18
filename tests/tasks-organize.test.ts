import { beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { createClient } from "@/server/services/clients";
import { createProject } from "@/server/services/projects";
import {
  deleteLabel,
  deleteSavedView,
  listLabels,
  listSavedViews,
  saveLabel,
  saveView,
  setTaskLabels,
} from "@/server/services/task-labels";
import {
  applyTemplate,
  deleteTemplate,
  getTemplate,
  saveTemplate,
  templateFromTask,
} from "@/server/services/task-templates";
import { createTask, duplicateTask, getTask, listTasks, saveChecklistItem } from "@/server/services/tasks";
import { addMember, as, createOrgWithOwner, resetDb } from "./helpers";

type Ctx = Awaited<ReturnType<typeof createOrgWithOwner>>;

describe("central de tarefas: etiquetas, filtros salvos e modelos", () => {
  let ctx: Ctx;
  let other: Ctx;
  let projectId: string;

  beforeAll(async () => {
    await resetDb();
    ctx = await createOrgWithOwner("Agência Organiza");
    other = await createOrgWithOwner("Agência Outra");
    const clientId = (await as(ctx.actor, (s) => createClient(s, { name: "Cliente Org" }))).id;
    projectId = (await as(ctx.actor, (s) => createProject(s, { clientId, name: "Projeto Org" }))).id;
  });

  it("etiquetas: nome único, filtro na lista, cópia na duplicação e isolamento", async () => {
    const urgent = await as(ctx.actor, (s) => saveLabel(s, { name: "Cliente VIP", color: "red" }));
    await expect(as(ctx.actor, (s) => saveLabel(s, { name: "cliente vip", color: "blue" }))).rejects.toBeInstanceOf(
      ValidationError,
    );
    // A transação continua utilizável depois do nome repetido.
    const reels = await as(ctx.actor, (s) => saveLabel(s, { name: "Reels", color: "violet" }));

    const t = await as(ctx.actor, (s) => createTask(s, { projectId, title: "Reels de lançamento" }));
    const plain = await as(ctx.actor, (s) => createTask(s, { projectId, title: "Sem etiqueta" }));
    await as(ctx.actor, (s) => setTaskLabels(s, t.id, [urgent.id, reels.id]));

    const rows = (await as(ctx.actor, (s) => listTasks(s, { label: reels.id }))).rows;
    expect(rows.map((r) => r.id)).toEqual([t.id]);
    expect(rows[0]?.labels.map((l) => l.name)).toEqual(["Cliente VIP", "Reels"]);
    expect((await as(ctx.actor, (s) => listTasks(s, {}))).rows.find((r) => r.id === plain.id)?.labels).toEqual([]);
    expect((await as(ctx.actor, (s) => getTask(s, t.id))).labels).toHaveLength(2);

    const copy = await as(ctx.actor, (s) => duplicateTask(s, t.id));
    expect((await as(ctx.actor, (s) => getTask(s, copy.id))).labels.map((l) => l.name)).toEqual([
      "Cliente VIP",
      "Reels",
    ]);

    // Etiqueta de outra agência não entra.
    const foreign = await as(other.actor, (s) => saveLabel(s, { name: "Externa", color: "green" }));
    await expect(as(ctx.actor, (s) => setTaskLabels(s, t.id, [foreign.id]))).rejects.toBeInstanceOf(ValidationError);
    expect((await as(other.actor, (s) => listLabels(s))).map((l) => l.name)).toEqual(["Externa"]);

    // Renomear/excluir é de quem gerencia a organização.
    const designer = await addMember(ctx.org.slug, ctx.org.id, "designer");
    await expect(
      as(designer, (s) => saveLabel(s, { id: reels.id, name: "Reels 2", color: "violet" })),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(as(designer, (s) => deleteLabel(s, reels.id))).rejects.toBeInstanceOf(ForbiddenError);
    await as(ctx.actor, (s) => deleteLabel(s, reels.id));
    expect((await as(ctx.actor, (s) => getTask(s, t.id))).labels.map((l) => l.name)).toEqual(["Cliente VIP"]);
  });

  it("filtros salvos: só parâmetros conhecidos, por pessoa", async () => {
    const saved = await as(ctx.actor, (s) =>
      saveView(s, { name: "Minhas vencidas", query: "?view=list&due=overdue&assignee=me&hack=1&redirect=http://x" }),
    );
    expect(saved.query).toBe("assignee=me&due=overdue&view=list");
    await expect(as(ctx.actor, (s) => saveView(s, { name: "Ruim", query: "due=ontem" }))).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(as(ctx.actor, (s) => saveView(s, { name: "Vazio", query: "hack=1" }))).rejects.toBeInstanceOf(
      ValidationError,
    );
    const designer = await addMember(ctx.org.slug, ctx.org.id, "designer");
    expect(await as(designer, (s) => listSavedViews(s))).toEqual([]);
    await expect(as(designer, (s) => deleteSavedView(s, saved.id))).rejects.toBeInstanceOf(NotFoundError);
    expect((await as(ctx.actor, (s) => listSavedViews(s))).map((v) => v.name)).toEqual(["Minhas vencidas"]);
    await as(ctx.actor, (s) => deleteSavedView(s, saved.id));
    expect(await as(ctx.actor, (s) => listSavedViews(s))).toEqual([]);
  });

  it("modelos: aplicar cria principal, etapas e checklists com prazos a partir da data base", async () => {
    const tpl = await as(ctx.actor, (s) =>
      saveTemplate(s, {
        name: "Peça de marketing",
        priority: "high",
        dueOffsetDays: 10,
        checklist: ["Conferir briefing"],
        steps: [
          { title: "Receber briefing", dueOffsetDays: 0 },
          { title: "Criar copy", dueOffsetDays: 2, checklist: ["Revisar ortografia"] },
          { title: "Produzir arte", dueOffsetDays: 5 },
          { title: "Entregar versão final", dueOffsetDays: 9 },
        ],
      }),
    );
    const { id } = await as(ctx.actor, (s) =>
      applyTemplate(s, { templateId: tpl.id, projectId, title: "Post Black Friday", startDate: "2030-11-01" }),
    );
    const parent = await as(ctx.actor, (s) => getTask(s, id));
    expect(parent.task.title).toBe("Post Black Friday");
    expect(parent.task.priority).toBe("high");
    expect(parent.task.startDate).toBe("2030-11-01");
    expect(parent.task.dueDate).toBe("2030-11-11");
    expect(parent.checklist.map((c) => c.title)).toEqual(["Conferir briefing"]);
    expect(parent.subtasks.map((st) => [st.title, st.dueDate])).toEqual([
      ["Receber briefing", "2030-11-01"],
      ["Criar copy", "2030-11-03"],
      ["Produzir arte", "2030-11-06"],
      ["Entregar versão final", "2030-11-10"],
    ]);
    const copy = parent.subtasks.find((st) => st.title === "Criar copy")!;
    expect((await as(ctx.actor, (s) => getTask(s, copy.id))).checklist.map((c) => c.title)).toEqual([
      "Revisar ortografia",
    ]);

    // Sem permissão de atribuir, não aplica com responsável de outra pessoa.
    const designer = await addMember(ctx.org.slug, ctx.org.id, "designer");
    await expect(
      as(designer, (s) =>
        applyTemplate(s, { templateId: tpl.id, projectId, assigneeMembershipId: ctx.actor.membershipId }),
      ),
    ).rejects.toThrow(/permissão para atribuir/i);
    // Outra agência não enxerga o modelo.
    await expect(as(other.actor, (s) => getTemplate(s, tpl.id))).rejects.toBeInstanceOf(NotFoundError);
    await expect(as(designer, (s) => deleteTemplate(s, tpl.id))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("salvar uma tarefa como modelo transforma prazos em deslocamentos", async () => {
    const t = await as(ctx.actor, (s) =>
      createTask(s, { projectId, title: "Campanha mensal", startDate: "2030-03-01", dueDate: "2030-03-20" }),
    );
    await as(ctx.actor, (s) => saveChecklistItem(s, { taskId: t.id, title: "Alinhar calendário" }));
    await as(ctx.actor, (s) =>
      createTask(s, { projectId, parentTaskId: t.id, title: "Planejar pauta", dueDate: "2030-03-04" }),
    );
    const tpl = await as(ctx.actor, (s) => templateFromTask(s, t.id, "Campanha do mês"));
    const { template, steps } = await as(ctx.actor, (s) => getTemplate(s, tpl.id));
    expect(template.name).toBe("Campanha do mês");
    expect(template.dueOffsetDays).toBe(19);
    expect(template.checklist).toEqual(["Alinhar calendário"]);
    expect(steps.map((st) => [st.title, st.dueOffsetDays])).toEqual([["Planejar pauta", 3]]);
  });
});
