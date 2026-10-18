import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { z } from "zod";
import { todayISO } from "@/lib/format";
import { applyTemplateInput, templateInput } from "@/lib/validators/tasks";
import { taskChecklistItems, tasks, taskTemplates, taskTemplateSteps } from "@/server/db/schema";
import { eachInSequence } from "@/server/db/sequence";
import { assertCan, assertInternal, assertProjectAccess, assertTaskAccess, type Scope } from "@/server/authz";
import { NotFoundError, ValidationError } from "@/server/errors";
import { recordActivity } from "./activity";
import { createTask } from "./tasks";

/*
 * Modelos de tarefa para processos recorrentes (ex.: briefing → copy → arte →
 * revisão → aprovação → entrega). Aplicar um modelo cria a tarefa principal,
 * as etapas como subtarefas e os checklists, com prazos calculados a partir de
 * uma data base. Nada é atribuído a outras pessoas sem a permissão de atribuir.
 */

function plusDays(iso: string, days: number) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
}

export async function listTemplates(s: Scope) {
  assertInternal(s.actor);
  assertCan(s.actor, "tasks.read");
  return s.db
    .select({
      id: taskTemplates.id,
      name: taskTemplates.name,
      description: taskTemplates.description,
      priority: taskTemplates.priority,
      dueOffsetDays: taskTemplates.dueOffsetDays,
      steps: sql<number>`(select count(*)::int from ${taskTemplateSteps} st where st.template_id = ${taskTemplates.id})`,
      updatedAt: taskTemplates.updatedAt,
    })
    .from(taskTemplates)
    .orderBy(asc(sql`lower(${taskTemplates.name})`));
}

export type TemplateRow = Awaited<ReturnType<typeof listTemplates>>[number];

export async function getTemplate(s: Scope, id: string) {
  assertInternal(s.actor);
  assertCan(s.actor, "tasks.read");
  const [template] = await s.db.select().from(taskTemplates).where(eq(taskTemplates.id, id));
  if (!template) throw new NotFoundError("Modelo não encontrado.");
  const steps = await s.db
    .select()
    .from(taskTemplateSteps)
    .where(eq(taskTemplateSteps.templateId, id))
    .orderBy(asc(taskTemplateSteps.position));
  return { template, steps };
}

export async function saveTemplate(s: Scope, raw: z.input<typeof templateInput>) {
  assertInternal(s.actor);
  assertCan(s.actor, "tasks.write");
  const data = templateInput.parse(raw);
  const values = {
    name: data.name,
    description: data.description,
    priority: data.priority,
    dueOffsetDays: data.dueOffsetDays,
    estimateMinutes: data.estimateMinutes,
    checklist: data.checklist,
  };
  let id = data.id;
  if (id) {
    const res = await s.db
      .update(taskTemplates)
      .set(values)
      .where(eq(taskTemplates.id, id))
      .returning({ id: taskTemplates.id });
    if (!res.length) throw new NotFoundError("Modelo não encontrado.");
    await s.db.delete(taskTemplateSteps).where(eq(taskTemplateSteps.templateId, id));
  } else {
    const [row] = await s.db
      .insert(taskTemplates)
      .values({ ...values, organizationId: s.actor.orgId, createdByUserId: s.actor.userId })
      .returning({ id: taskTemplates.id });
    id = row!.id;
  }
  if (data.steps.length) {
    await s.db.insert(taskTemplateSteps).values(
      data.steps.map((st, position) => ({
        organizationId: s.actor.orgId,
        templateId: id!,
        position,
        title: st.title,
        dueOffsetDays: st.dueOffsetDays,
        estimateMinutes: st.estimateMinutes,
        checklist: st.checklist,
      })),
    );
  }
  await recordActivity(s, {
    action: data.id ? "updated" : "created",
    entityType: "task_template",
    entityId: id,
    summary: `${data.id ? "Modelo atualizado" : "Modelo criado"}: ${data.name}`,
    event: false,
  });
  return { id: id! };
}

export async function deleteTemplate(s: Scope, id: string) {
  assertInternal(s.actor);
  assertCan(s.actor, "tasks.delete");
  const [row] = await s.db
    .delete(taskTemplates)
    .where(eq(taskTemplates.id, id))
    .returning({ name: taskTemplates.name });
  if (!row) throw new NotFoundError("Modelo não encontrado.");
  await recordActivity(s, {
    action: "deleted",
    entityType: "task_template",
    entityId: id,
    summary: `Modelo excluído: ${row.name}`,
    event: false,
  });
}

async function addChecklist(s: Scope, taskId: string, titles: string[]) {
  if (!titles.length) return;
  await s.db
    .insert(taskChecklistItems)
    .values(titles.map((title, position) => ({ organizationId: s.actor.orgId, taskId, title, position })));
}

/** Aplica o modelo num projeto: tarefa principal + etapas como subtarefas, prazos a partir da data base. */
export async function applyTemplate(s: Scope, raw: z.input<typeof applyTemplateInput>) {
  assertInternal(s.actor);
  assertCan(s.actor, "tasks.write");
  const data = applyTemplateInput.parse(raw);
  await assertProjectAccess(s, data.projectId);
  const { template, steps } = await getTemplate(s, data.templateId);
  const base = data.startDate ?? todayISO();
  const due = (offset: number | null) => (offset === null ? null : plusDays(base, offset));
  const lastStep = steps.reduce<number | null>(
    (max, st) => (st.dueOffsetDays === null ? max : Math.max(max ?? 0, st.dueOffsetDays)),
    null,
  );

  // createTask confere a permissão de atribuir a outras pessoas.
  const parent = await createTask(s, {
    projectId: data.projectId,
    title: data.title ?? template.name,
    description: template.description,
    priority: template.priority,
    assigneeMembershipId: data.assigneeMembershipId,
    startDate: base,
    dueDate: due(template.dueOffsetDays ?? lastStep),
    estimateMinutes: template.estimateMinutes,
  });
  await addChecklist(s, parent.id, template.checklist);
  await eachInSequence(steps, async (st) => {
    const child = await createTask(s, {
      projectId: data.projectId,
      parentTaskId: parent.id,
      title: st.title,
      priority: template.priority,
      assigneeMembershipId: data.assigneeMembershipId,
      dueDate: due(st.dueOffsetDays),
      estimateMinutes: st.estimateMinutes,
    });
    await addChecklist(s, child.id, st.checklist);
  });
  await recordActivity(s, {
    action: "template_applied",
    entityType: "task",
    entityId: parent.id,
    summary: `Criada a partir do modelo "${template.name}" (${steps.length} etapa${steps.length === 1 ? "" : "s"})`,
    event: false,
  });
  return { id: parent.id };
}

/** Salva uma tarefa (com subtarefas e checklists) como modelo; prazos viram deslocamentos a partir do início. */
export async function templateFromTask(s: Scope, taskId: string, name?: string) {
  assertInternal(s.actor);
  assertCan(s.actor, "tasks.write");
  await assertTaskAccess(s, taskId);
  const [task] = await s.db.select().from(tasks).where(eq(tasks.id, taskId));
  if (!task) throw new NotFoundError("Tarefa não encontrada.");
  if (task.parentTaskId) throw new ValidationError("Salve como modelo a tarefa principal, não uma subtarefa.");
  const children = await s.db
    .select()
    .from(tasks)
    .where(and(eq(tasks.parentTaskId, taskId), isNull(tasks.archivedAt)))
    .orderBy(asc(tasks.position), asc(tasks.createdAt));
  const checklistOf = async (id: string) =>
    (
      await s.db
        .select({ title: taskChecklistItems.title })
        .from(taskChecklistItems)
        .where(eq(taskChecklistItems.taskId, id))
        .orderBy(asc(taskChecklistItems.position))
    ).map((c) => c.title);
  const base = task.startDate ?? task.createdAt.toISOString().slice(0, 10);
  const offset = (d: string | null) => (d ? Math.max(0, daysBetween(base, d)) : null);
  const steps: { title: string; dueOffsetDays: number | null; estimateMinutes: number | null; checklist: string[] }[] =
    [];
  await eachInSequence(children, async (c) => {
    steps.push({
      title: c.title,
      dueOffsetDays: offset(c.dueDate),
      estimateMinutes: c.estimateMinutes,
      checklist: await checklistOf(c.id),
    });
  });
  return saveTemplate(s, {
    name: (name?.trim() || task.title).slice(0, 120),
    description: task.description,
    priority: task.priority,
    dueOffsetDays: offset(task.dueDate),
    estimateMinutes: task.estimateMinutes,
    checklist: await checklistOf(task.id),
    steps,
  });
}
