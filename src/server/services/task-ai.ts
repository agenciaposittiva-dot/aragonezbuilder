import { and, asc, count, desc, eq, isNull, sql, type SQL } from "drizzle-orm";
import type { z } from "zod";
import { AI_TASKS } from "@/lib/ai-tasks";
import { formatDate, PRIORITY_LABEL, todayISO } from "@/lib/format";
import {
  applyBreakdownInput,
  applyPlanInput,
  citedDates,
  PRIORITIES,
  TASK_AI_MODES,
  taskAiRequest,
  type PlanItem,
  type Priority,
  type TaskAiMode,
  type TaskAiResult,
} from "@/lib/task-ai";
import {
  assertCan,
  assertInternal,
  assertProjectAccess,
  assertRequestAccess,
  assertTaskAccess,
  can,
  taskScope,
  type Scope,
} from "@/server/authz";
import {
  clients,
  files,
  projects,
  requests,
  taskChecklistItems,
  taskDependencies,
  tasks,
  workflowStatuses,
} from "@/server/db/schema";
import { eachInSequence } from "@/server/db/sequence";
import { NotFoundError, ValidationError } from "@/server/errors";
import { recordActivity } from "./activity";
import { assertCanGenerate, CostConfirmationError, estimateMaxCostMicros, type PreparedGeneration } from "./ai";
import { aiSelectionInput, getPickerData, resolveSelection } from "./ai-models";
import { listComments } from "./comments";
import { listInternalMembers } from "./members";
import { getSettings } from "./organizations";
import { listRequests } from "./requests";
import { addChecklist } from "./task-templates";
import { createTask, getTask } from "./tasks";

/*
 * Assistente de IA da Central de Tarefas. A IA só propõe: o resultado volta
 * normalizado para uma prévia editável e nada é gravado sem a confirmação
 * explícita da pessoa (applyTaskPlan / applyTaskBreakdown / ações comuns).
 *
 * Política: com "Enviar contexto dos clientes" desligado, só o texto que a
 * pessoa digitou vai ao provedor. Dados de tarefas, comentários e solicitações
 * exigem a autorização da organização (ou o modo demonstração, que é local).
 */

export const POLICY_MESSAGE =
  "A política de IA da organização não permite enviar dados de tarefas e clientes ao provedor. Um administrador pode liberar em Configurações → Inteligência artificial (“Enviar contexto dos clientes ao provedor”).";

const SYSTEM = `Você organiza o trabalho de produção de uma agência de marketing brasileira.
Responda SOMENTE com JSON válido no formato pedido, em português do Brasil, sem texto fora do JSON.
Use apenas as informações fornecidas: não invente clientes, números, pessoas, entregas ou prazos.
Uma data só é prazo combinado quando aparece no pedido; qualquer outra data é apenas sugestão.`;

const STR = { type: "string" } as const;
const STR_LIST = { type: "array", items: STR } as const;
const PRIORITY = { type: "string", enum: [...PRIORITIES] } as const;
const obj = (properties: Record<string, unknown>) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

const SCHEMAS: Record<TaskAiMode, Record<string, unknown>> = {
  plan: obj({
    items: {
      type: "array",
      items: obj({
        title: STR,
        description: STR,
        priority: PRIORITY,
        dueDate: STR,
        dueOrigin: { type: "string", enum: ["texto", "sugestao", "nenhum"] },
        assigneeHint: STR,
        estimateMinutes: { type: "integer" },
        subtasks: STR_LIST,
        checklist: STR_LIST,
      }),
    },
  }),
  demand: {},
  breakdown: obj({
    subtasks: { type: "array", items: obj({ title: STR, estimateMinutes: { type: "integer" } }) },
    checklist: STR_LIST,
  }),
  triage: obj({ priority: PRIORITY, priorityReason: STR, dueDate: STR, dueReason: STR }),
  summary: obj({ summary: STR, decisions: STR_LIST, pending: STR_LIST }),
};
SCHEMAS.demand = SCHEMAS.plan;

const PLAN_FORMAT = `{"items":[{"title":string,"description":string,"priority":"low"|"medium"|"high"|"urgent","dueDate":"AAAA-MM-DD" ou "","dueOrigin":"texto"|"sugestao"|"nenhum","assigneeHint":string,"estimateMinutes":number,"subtasks":[string],"checklist":[string]}]}`;

const PLAN_RULES = [
  "Converta o pedido em tarefas de produção claras e acionáveis (de 1 a 12), na ordem de execução.",
  "Cada tarefa: título curto começando com verbo; descrição objetiva do que entregar; prioridade (urgent/high só quando o pedido indicar urgência ou importância); subtarefas quando houver passos menores; checklist com critérios de pronto. estimateMinutes = 0 quando não houver base.",
  'Prazos: preencha dueDate e use dueOrigin "texto" SOMENTE quando o pedido citar a data. Para sugerir um prazo não citado, use dueOrigin "sugestao". Sem base: dueDate "" e dueOrigin "nenhum".',
  'Responsável: em assigneeHint copie o nome da pessoa apenas se o pedido disser quem fará; senão "".',
  `Formato: ${PLAN_FORMAT}`,
];

const WEEKDAY = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
function todayLine(today: string) {
  return `Hoje é ${WEEKDAY[new Date(`${today}T12:00:00Z`).getUTCDay()]}, ${formatDate(today)} (${today}).`;
}

const block = (content: string) => `<<<\n${content}\n>>>`;
const line = (label: string, value: string | number | null | undefined) =>
  value === null || value === undefined || value === "" ? null : `${label}: ${value}`;
const join = (parts: (string | null)[]) => parts.filter(Boolean).join("\n");

type Member = { membershipId: string; name: string };

type Ctx = {
  mode: TaskAiMode;
  today: string;
  /** Texto de onde vieram as tarefas (para conferir as datas citadas). */
  source: string;
  requestDue: string | null;
  members: Member[];
  projectId: string | null;
  requestId: string | null;
  task: { id: string; priority: Priority; dueDate: string | null; subtasks: string[]; checklist: string[] } | null;
  commentCount: number;
};

export type PreparedTaskAi = { generation: PreparedGeneration; input: Record<string, string>; ctx: Ctx };

/** Pessoas que a pessoa pode indicar como responsáveis (todas, com tasks.assign; senão só ela mesma). */
async function assignable(s: Scope): Promise<Member[]> {
  const all = await listInternalMembers(s);
  const list = can(s.actor, "tasks.assign") ? all : all.filter((m) => m.membershipId === s.actor.membershipId);
  return list.map((m) => ({ membershipId: m.membershipId, name: m.name }));
}

async function taskContext(s: Scope, taskId: string) {
  const detail = await getTask(s, taskId);
  const [project] = await s.db
    .select({ dueDate: projects.dueDate })
    .from(projects)
    .where(eq(projects.id, detail.task.projectId));
  return { detail, projectDue: project?.dueDate ?? null };
}

/**
 * Valida o pedido, aplica permissões e a política de IA, resolve o modelo
 * (seletor universal, módulo "tasks") e monta o prompt com o contexto que a
 * pessoa pode ver.
 */
export async function prepareTaskAi(s: Scope, raw: z.input<typeof taskAiRequest>): Promise<PreparedTaskAi> {
  assertInternal(s.actor);
  const data = taskAiRequest.parse(raw);
  const def = TASK_AI_MODES[data.mode];
  if (data.mode === "summary") assertCan(s.actor, "tasks.read");
  else assertCan(s.actor, "tasks.write");
  if (data.mode === "demand") assertCan(s.actor, "requests.triage");

  const settings = await assertCanGenerate(s);
  const selection = aiSelectionInput.parse(data.selection ?? {});
  const resolved = await resolveSelection(s, { module: "tasks", task: def.task, selection });
  const demo = resolved.def.id === "demo";
  const mayShare = demo || settings.allowClientContext;
  const today = todayISO();

  const ctx: Ctx = {
    mode: data.mode,
    today,
    source: "",
    requestDue: null,
    members: [],
    projectId: null,
    requestId: null,
    task: null,
    commentCount: 0,
  };
  let prompt = "";
  let clientId: string | null = null;
  let contextUsed = false;

  if (data.mode === "plan") {
    ctx.source = data.text;
    ctx.members = await assignable(s);
    let projectLine: string | null = null;
    if (data.projectId) {
      const p = await assertProjectAccess(s, data.projectId);
      ctx.projectId = p.id;
      clientId = p.clientId;
      if (mayShare) {
        const [row] = await s.db
          .select({ name: projects.name, clientName: clients.name })
          .from(projects)
          .innerJoin(clients, eq(clients.id, projects.clientId))
          .where(eq(projects.id, p.id));
        if (row) {
          projectLine = `Projeto: ${row.name} (cliente ${row.clientName})`;
          contextUsed = true;
        }
      }
    }
    prompt = join([todayLine(today), ...PLAN_RULES, "", projectLine, "Pedido:", block(data.text)]);
  } else if (data.mode === "demand") {
    if (!mayShare) throw new ValidationError(POLICY_MESSAGE);
    await assertRequestAccess(s, data.requestId);
    const [req] = await s.db.select().from(requests).where(eq(requests.id, data.requestId));
    if (!req) throw new NotFoundError("Solicitação não encontrada.");
    if (["draft", "rejected", "cancelled", "delivered"].includes(req.status))
      throw new ValidationError("Esta solicitação não está aberta para produção.");
    const briefing = Object.entries(req.briefing ?? {})
      .filter(([, v]) => typeof v === "string" && v.trim())
      .map(([k, v]) => `- ${k}: ${String(v).slice(0, 800)}`);
    ctx.source = join([
      `Solicitação #${req.number}: ${req.title}`,
      line("Objetivo", req.objective),
      line("Descrição", req.description),
      line("Público", req.audience),
      line("Canal", req.channel),
      line("Formato", req.format),
      line("Quantidade de peças", req.piecesCount),
      line("Prazo desejado pelo cliente", req.desiredDueDate ? formatDate(req.desiredDueDate) : null),
      line("Texto de apoio", req.copyText),
      briefing.length ? `Briefing:\n${briefing.join("\n")}` : null,
    ]).slice(0, 12000);
    ctx.requestDue = req.desiredDueDate;
    ctx.requestId = req.id;
    ctx.projectId = req.projectId;
    ctx.members = await assignable(s);
    clientId = req.clientId;
    contextUsed = true;
    prompt = join([
      todayLine(today),
      ...PLAN_RULES,
      'O "prazo desejado pelo cliente" é um pedido do cliente: use-o só na entrega final, com dueOrigin "texto".',
      "",
      "Pedido:",
      block(ctx.source),
    ]);
  } else {
    if (!mayShare) throw new ValidationError(POLICY_MESSAGE);
    const { detail, projectDue } = await taskContext(s, data.taskId);
    const t = detail.task;
    clientId = detail.clientId;
    contextUsed = true;
    ctx.task = {
      id: t.id,
      priority: t.priority,
      dueDate: t.dueDate,
      subtasks: detail.subtasks.map((x) => x.title),
      checklist: detail.checklist.map((x) => x.title),
    };
    ctx.projectId = t.projectId;
    const head = [
      line("Título", t.title),
      line("Descrição", t.description?.slice(0, 4000)),
      line("Projeto", `${detail.projectName} (cliente ${detail.clientName})`),
    ];
    if (data.mode === "breakdown") {
      prompt = join([
        t.parentTaskId
          ? "Monte um checklist de verificação (até 12 itens, critérios objetivos de pronto) para a subtarefa abaixo. Não crie subtarefas: devolva subtasks vazio."
          : "Quebre a tarefa abaixo em subtarefas executáveis (até 10, em ordem) e um checklist de verificação (até 12 itens, critérios objetivos de pronto).",
        "Não repita subtarefas ou itens que já existem. estimateMinutes = 0 quando não houver base.",
        `Formato: {"subtasks":[{"title":string,"estimateMinutes":number}],"checklist":[string]}`,
        "",
        "Tarefa:",
        block(
          join([
            ...head,
            line("Subtarefas existentes", ctx.task.subtasks.join("; ")),
            line("Checklist existente", ctx.task.checklist.join("; ")),
            line("Observações de quem pediu", data.notes),
          ]),
        ),
      ]);
    } else if (data.mode === "triage") {
      const openDeps = detail.dependsOn.filter((d) => !d.completedAt).length;
      const openBlocking = detail.blocking.filter((d) => !d.completedAt).length;
      prompt = join([
        todayLine(today),
        "Sugira a prioridade (low|medium|high|urgent) e, se fizer sentido, um prazo para a tarefa, com justificativas curtas baseadas só nos dados abaixo.",
        'O prazo é apenas uma sugestão e nunca deve ser apresentado como combinado. Se a tarefa já tem prazo, só proponha outro com motivo claro (ex.: depois do prazo do projeto); sem motivo, devolva dueDate "".',
        `Formato: {"priority":"low"|"medium"|"high"|"urgent","priorityReason":string,"dueDate":"AAAA-MM-DD" ou "","dueReason":string}`,
        "",
        "Tarefa:",
        block(
          join([
            ...head,
            line("Status", detail.status.name),
            line("Prioridade atual", PRIORITY_LABEL[t.priority]),
            line("Início", t.startDate),
            line("Prazo atual", t.dueDate),
            line("Prazo do projeto", projectDue),
            line("Estimativa (min)", t.estimateMinutes),
            line("Depende de tarefas abertas", openDeps || null),
            line("Bloqueia outras tarefas abertas", openBlocking || null),
            line("Subtarefas abertas", detail.subtasks.filter((x) => !x.completedAt).length || null),
          ]),
        ),
      ]);
    } else {
      const list = await listComments(s, { taskId: t.id });
      if (!list.length) throw new ValidationError("Esta tarefa ainda não tem comentários para resumir.");
      const recent = list.slice(-80);
      ctx.commentCount = list.length;
      const lines = recent.map(
        (c) =>
          `[${formatDate(c.createdAt)}] ${c.authorName ?? "Pessoa removida"}${c.internal ? " (interno)" : ""}: ${c.body.replace(/\s+/g, " ").slice(0, 1200)}`,
      );
      prompt = join([
        "Resuma os comentários da tarefa: um parágrafo curto com a situação atual, as decisões tomadas e as pendências (com responsável quando citado). Use só o que está nos comentários.",
        `Formato: {"summary":string,"decisions":[string],"pending":[string]}`,
        "",
        line("Tarefa", t.title),
        "Comentários (do mais antigo ao mais recente):",
        block(lines.join("\n")),
      ]);
    }
  }

  const maxTokens = Math.min(4000, resolved.model.maxOutputTokens ?? Infinity);
  const estimateMicros = estimateMaxCostMicros(resolved.model, SYSTEM.length + prompt.length, maxTokens);
  if (
    settings.confirmAboveMicros > 0 &&
    estimateMicros !== null &&
    estimateMicros > settings.confirmAboveMicros &&
    !data.confirmCost
  ) {
    throw new CostConfirmationError(estimateMicros);
  }

  // Registro no histórico de gerações: o texto digitado ou só a referência ao registro analisado.
  const input: Record<string, string> =
    data.mode === "plan"
      ? { text: data.text }
      : { text: def.label, ref: "taskId" in data ? data.taskId : data.requestId };

  return {
    ctx,
    input,
    generation: {
      operation: def.operation,
      label: def.label,
      structured: true,
      jsonSchema: SCHEMAS[data.mode],
      system: SYSTEM,
      prompt,
      maxTokens,
      model: resolved.model,
      provider: resolved.def.text!(resolved.apiKey ?? "", { baseUrl: resolved.baseUrl }),
      providerId: resolved.def.id,
      providerLabel: resolved.def.label,
      demo,
      module: "tasks",
      task: def.task as keyof typeof AI_TASKS,
      source: resolved.source,
      keySource: resolved.keySource,
      reason: resolved.reason,
      warnings: resolved.warnings,
      clientId,
      projectId: ctx.projectId,
      contextUsed,
      estimateMicros,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Normalização da resposta (nada aqui grava dados)                    */
/* ------------------------------------------------------------------ */

const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
function strings(v: unknown, max: number, skip: string[] = []) {
  const seen = new Set(skip.map((x) => x.toLowerCase()));
  const out: string[] = [];
  for (const item of Array.isArray(v) ? v : []) {
    const t = text(item, 200);
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}
const priority = (v: unknown, fallback: Priority): Priority =>
  PRIORITIES.includes(v as Priority) ? (v as Priority) : fallback;
function estimate(v: unknown) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? Math.min(n, 100_000) : null;
}
function isoDate(v: unknown) {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T12:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? null : v;
}
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** Encontra a pessoa citada pela IA entre as que podem ser indicadas (nunca adivinha entre homônimos). */
export function matchMember(hint: string, members: Member[]): string | null {
  const h = fold(hint).replace(/^@/, "");
  if (!h) return null;
  const exact = members.filter((m) => fold(m.name) === h);
  if (exact.length === 1) return exact[0]!.membershipId;
  const first = members.filter((m) => fold(m.name).split(/\s+/)[0] === h.split(/\s+/)[0]);
  if (first.length === 1) return first[0]!.membershipId;
  return null;
}

/** Converte a resposta da IA na prévia editável, aplicando as proteções de prazo e responsável. */
export function normalizeTaskAi(ctx: Ctx, data: unknown): TaskAiResult {
  const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  if (ctx.mode === "plan" || ctx.mode === "demand") {
    const cited = citedDates(ctx.source, ctx.today);
    const items: PlanItem[] = [];
    for (const raw of Array.isArray(d.items) ? d.items.slice(0, 20) : []) {
      const r = (raw ?? {}) as Record<string, unknown>;
      const title = text(r.title, 200);
      if (!title) continue;
      let due = isoDate(r.dueDate);
      let origin: PlanItem["dueOrigin"] = null;
      if (due) {
        if (cited.has(due)) origin = "texto";
        else if (due === ctx.requestDue) origin = "solicitacao";
        else if (due >= ctx.today) origin = "sugestao";
        else due = null;
      }
      const hint = text(r.assigneeHint, 120);
      items.push({
        title,
        description: text(r.description, 4000),
        priority: priority(r.priority, "medium"),
        dueDate: due,
        dueOrigin: origin,
        assigneeHint: hint,
        assigneeMembershipId: matchMember(hint, ctx.members),
        estimateMinutes: estimate(r.estimateMinutes),
        subtasks: strings(r.subtasks, 15),
        checklist: strings(r.checklist, 20),
      });
    }
    if (!items.length) throw new ValidationError("A resposta não trouxe tarefas. Tente novamente ou detalhe o pedido.");
    return { mode: ctx.mode, items, projectId: ctx.projectId, requestId: ctx.requestId };
  }
  const task = ctx.task!;
  if (ctx.mode === "breakdown") {
    const seen = new Set(task.subtasks.map((x) => x.toLowerCase()));
    const subtasks: { title: string; estimateMinutes: number | null }[] = [];
    for (const raw of Array.isArray(d.subtasks) ? d.subtasks : []) {
      const r = (raw ?? {}) as Record<string, unknown>;
      const title = text(typeof raw === "string" ? raw : r.title, 200);
      if (!title || seen.has(title.toLowerCase())) continue;
      seen.add(title.toLowerCase());
      subtasks.push({ title, estimateMinutes: estimate(r.estimateMinutes) });
      if (subtasks.length >= 20) break;
    }
    const checklist = strings(d.checklist, 30, task.checklist);
    if (!subtasks.length && !checklist.length)
      throw new ValidationError("A resposta não trouxe subtarefas nem itens novos. Tente novamente.");
    return { mode: "breakdown", taskId: task.id, subtasks, checklist };
  }
  if (ctx.mode === "triage") {
    const due = isoDate(d.dueDate);
    return {
      mode: "triage",
      taskId: task.id,
      current: { priority: task.priority, dueDate: task.dueDate },
      priority: priority(d.priority, task.priority),
      priorityReason: text(d.priorityReason, 500),
      dueDate: due && due >= ctx.today && due !== task.dueDate ? due : null,
      dueReason: text(d.dueReason, 500),
    };
  }
  const summary = text(d.summary, 3000);
  if (!summary) throw new ValidationError("A resposta não trouxe um resumo. Tente novamente.");
  return {
    mode: "summary",
    taskId: task.id,
    summary,
    decisions: strings(d.decisions, 10),
    pending: strings(d.pending, 10),
    commentCount: ctx.commentCount,
  };
}

/* ------------------------------------------------------------------ */
/* Aplicação (somente após a confirmação na prévia)                    */
/* ------------------------------------------------------------------ */

/** Cria as tarefas revisadas (com subtarefas e checklists) numa única transação. */
export async function applyTaskPlan(s: Scope, raw: z.input<typeof applyPlanInput>) {
  assertInternal(s.actor);
  assertCan(s.actor, "tasks.write");
  const data = applyPlanInput.parse(raw);
  const project = await assertProjectAccess(s, data.projectId);
  let request: typeof requests.$inferSelect | null = null;
  if (data.requestId) {
    assertCan(s.actor, "requests.triage");
    await assertRequestAccess(s, data.requestId);
    [request = null] = await s.db.select().from(requests).where(eq(requests.id, data.requestId));
    if (!request) throw new NotFoundError("Solicitação não encontrada.");
    if (request.clientId !== project.clientId) throw new ValidationError("O projeto escolhido é de outro cliente.");
    if (["draft", "rejected", "cancelled", "delivered"].includes(request.status))
      throw new ValidationError("Esta solicitação não está aberta para produção.");
  }

  const ids: string[] = [];
  let subtaskCount = 0;
  // createTask confere acesso ao projeto, a permissão de atribuir e pessoas ativas.
  await eachInSequence(data.tasks, async (t) => {
    const parent = await createTask(s, {
      projectId: project.id,
      title: t.title,
      description: t.description || null,
      priority: t.priority,
      assigneeMembershipId: t.assigneeMembershipId ?? null,
      dueDate: t.dueDate ?? null,
      estimateMinutes: t.estimateMinutes || null,
      requestId: request?.id ?? null,
    });
    await eachInSequence(t.subtasks, async (title) => {
      await createTask(s, {
        projectId: project.id,
        parentTaskId: parent.id,
        title,
        priority: t.priority,
        assigneeMembershipId: t.assigneeMembershipId ?? null,
      });
      subtaskCount++;
    });
    await addChecklist(s, parent.id, t.checklist);
    ids.push(parent.id);
  });

  if (request && !request.projectId) {
    await s.db
      .update(files)
      .set({ projectId: project.id })
      .where(and(eq(files.requestId, request.id), isNull(files.projectId)));
    await s.db
      .update(requests)
      .set({ projectId: project.id, status: "in_progress" })
      .where(eq(requests.id, request.id));
    await recordActivity(s, {
      action: "converted",
      entityType: "request",
      entityId: request.id,
      summary: `Solicitação #${request.number} em produção`,
      clientVisible: true,
      event: {
        type: "request.converted",
        payload: { requestId: request.id, clientId: request.clientId, projectId: project.id },
      },
    });
  }
  await recordActivity(s, {
    action: "ai_tasks_created",
    entityType: "project",
    entityId: project.id,
    summary: `${ids.length} tarefa${ids.length === 1 ? "" : "s"} criada${ids.length === 1 ? "" : "s"} com o assistente de IA${request ? ` (solicitação #${request.number})` : ""}`,
    metadata: { taskIds: ids, subtasks: subtaskCount },
    event: false,
  });
  return { created: ids.length, subtasks: subtaskCount, ids, projectId: project.id };
}

/** Adiciona as subtarefas e os itens de checklist revisados a uma tarefa. */
export async function applyTaskBreakdown(s: Scope, raw: z.input<typeof applyBreakdownInput>) {
  assertInternal(s.actor);
  assertCan(s.actor, "tasks.write");
  const data = applyBreakdownInput.parse(raw);
  await assertTaskAccess(s, data.taskId);
  const [task] = await s.db.select().from(tasks).where(eq(tasks.id, data.taskId));
  if (!task) throw new NotFoundError("Tarefa não encontrada.");
  if (task.parentTaskId && data.subtasks.length)
    throw new ValidationError("Uma subtarefa não pode ter subtarefas. Use o checklist.");
  // Só repete o responsável quando a pessoa pode atribuir (ou é ela mesma).
  const assignee =
    task.assigneeMembershipId && (task.assigneeMembershipId === s.actor.membershipId || can(s.actor, "tasks.assign"))
      ? task.assigneeMembershipId
      : null;
  await eachInSequence(data.subtasks, async (st) => {
    await createTask(s, {
      projectId: task.projectId,
      parentTaskId: task.id,
      title: st.title,
      priority: task.priority,
      assigneeMembershipId: assignee,
      estimateMinutes: st.estimateMinutes || null,
    });
  });
  if (data.checklist.length) {
    const [{ max } = { max: -1 }] = await s.db
      .select({ max: sql<number>`coalesce(max(${taskChecklistItems.position}), -1)::int` })
      .from(taskChecklistItems)
      .where(eq(taskChecklistItems.taskId, task.id));
    await s.db.insert(taskChecklistItems).values(
      data.checklist.map((title, i) => ({
        organizationId: s.actor.orgId,
        taskId: task.id,
        title,
        position: Number(max) + 1 + i,
      })),
    );
  }
  await recordActivity(s, {
    action: "ai_breakdown",
    entityType: "task",
    entityId: task.id,
    summary: `Assistente de IA: ${data.subtasks.length} subtarefa${data.subtasks.length === 1 ? "" : "s"} e ${data.checklist.length} ite${data.checklist.length === 1 ? "m" : "ns"} de checklist adicionados`,
    event: false,
  });
  return { subtasks: data.subtasks.length, checklist: data.checklist.length };
}

/* ------------------------------------------------------------------ */
/* Pendências da carteira (sem IA: nada sai da plataforma)             */
/* ------------------------------------------------------------------ */

const openDepsSql = sql<
  string | null
>`(select string_agg(dep.title, ' · ' order by dep.title) from ${taskDependencies} d join ${tasks} dep on dep.id = d.depends_on_task_id where d.task_id = ${tasks.id} and dep.completed_at is null and dep.archived_at is null)`;

/** Tarefas abertas sem responsável, sem prazo e bloqueadas, com o motivo do bloqueio. */
export async function taskHealth(s: Scope) {
  assertInternal(s.actor);
  assertCan(s.actor, "tasks.read");
  const open = and(taskScope(s.actor), isNull(tasks.archivedAt), isNull(tasks.completedAt));
  const blocked = sql`exists (select 1 from ${taskDependencies} d join ${tasks} dep on dep.id = d.depends_on_task_id where d.task_id = ${tasks.id} and dep.completed_at is null and dep.archived_at is null)`;
  const pick = async (cond: SQL) => {
    const where = and(open, cond);
    const rows = await s.db
      .select({
        id: tasks.id,
        title: tasks.title,
        dueDate: tasks.dueDate,
        priority: tasks.priority,
        projectName: projects.name,
        clientName: clients.name,
        statusName: workflowStatuses.name,
        blockers: openDepsSql,
      })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .innerJoin(clients, eq(clients.id, projects.clientId))
      .innerJoin(workflowStatuses, eq(workflowStatuses.id, tasks.statusId))
      .where(where)
      .orderBy(
        sql`${tasks.dueDate} asc nulls last`,
        desc(sql`case ${tasks.priority} when 'urgent' then 4 when 'high' then 3 when 'medium' then 2 else 1 end`),
        asc(tasks.createdAt),
      )
      .limit(8);
    const [{ n } = { n: 0 }] = await s.db.select({ n: count() }).from(tasks).where(where);
    return { total: n, rows };
  };
  return {
    unassigned: await pick(sql`${tasks.assigneeMembershipId} is null`),
    undated: await pick(sql`${tasks.dueDate} is null`),
    blocked: await pick(blocked),
  };
}
export type TaskHealth = Awaited<ReturnType<typeof taskHealth>>;

/* ------------------------------------------------------------------ */
/* Dados do diálogo (carregados só quando ele abre)                    */
/* ------------------------------------------------------------------ */

export async function taskAiSetup(s: Scope) {
  assertInternal(s.actor);
  assertCan(s.actor, "tasks.read");
  const health = await taskHealth(s);
  if (!can(s.actor, "ai.use")) return { canUse: false as const, health };
  const settings = (await getSettings(s)).ai;
  const picker = await getPickerData(s);
  const ready = picker.providers.filter((p) => p.ready);
  const requestOptions =
    can(s.actor, "requests.triage") && can(s.actor, "tasks.write")
      ? (await listRequests(s, { open: true, pageSize: 50 })).rows
          .filter((r) => !["draft", "rejected", "cancelled", "delivered"].includes(r.status))
          .map((r) => ({
            id: r.id,
            number: r.number,
            title: r.title,
            clientName: r.clientName,
            projectId: r.projectId,
          }))
      : [];
  return {
    canUse: true as const,
    health,
    enabled: settings.enabled,
    allowClientContext: settings.allowClientContext,
    configured: ready.length > 0,
    demo: ready.length > 0 && ready.every((p) => p.id === "demo"),
    picker,
    requests: requestOptions,
  };
}
export type TaskAiSetup = Awaited<ReturnType<typeof taskAiSetup>>;
