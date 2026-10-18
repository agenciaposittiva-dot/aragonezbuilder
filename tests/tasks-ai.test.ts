import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { citedDates, type TaskAiRequest } from "@/lib/task-ai";
import type { Actor } from "@/server/authz";
import { withOrg } from "@/server/db";
import { requests, tasks } from "@/server/db/schema";
import { env } from "@/server/env";
import { ForbiddenError, ValidationError } from "@/server/errors";
import { updateAiSettings } from "@/server/services/ai";
import { saveProviderKey, setProviderEnabled } from "@/server/services/ai-providers";
import { runGeneration, type GenerationEvent } from "@/server/services/ai-run";
import { createClient } from "@/server/services/clients";
import { addComment } from "@/server/services/comments";
import { createProject } from "@/server/services/projects";
import { createRequest } from "@/server/services/requests";
import {
  applyTaskBreakdown,
  applyTaskPlan,
  matchMember,
  normalizeTaskAi,
  POLICY_MESSAGE,
  prepareTaskAi,
  taskHealth,
} from "@/server/services/task-ai";
import { addDependency, createTask, getTask, listTasks } from "@/server/services/tasks";
import { installAiMock } from "./ai-mocks";
import { addMember, as, createOrgWithOwner, resetDb } from "./helpers";

type Ctx = Awaited<ReturnType<typeof createOrgWithOwner>>;
const KEY = "sk-ant-tarefas-0001";
const policy = { enabled: true, allowClientContext: false, monthlyTokenLimit: 0, userDailyRequestLimit: 0 };

/** Prepara, gera e normaliza — exatamente o caminho da rota /api/tasks/ai, sem gravar nada. */
async function ask(actor: Actor, req: TaskAiRequest) {
  const prepared = await as(actor, (s) => prepareTaskAi(s, req));
  const events: GenerationEvent[] = [];
  await runGeneration(actor, prepared.generation, prepared.input, { send: (e) => events.push(e) });
  const done = events.find((e) => e.t === "done");
  if (!done) throw new Error(events.find((e) => e.t === "error")?.message ?? "sem resposta");
  return { prepared, result: normalizeTaskAi(prepared.ctx, done.data) };
}

const countTasks = (actor: Actor) => as(actor, async (s) => (await s.db.select({ id: tasks.id }).from(tasks)).length);

describe("assistente de IA da Central de Tarefas", () => {
  let demo: Ctx;
  let real: Ctx;
  let mock: ReturnType<typeof installAiMock>;
  let demoProject: string;
  let demoClient: string;
  let realProject: string;
  let helena: Actor;
  const saved = { provider: env.AI_DEFAULT_PROVIDER, anthropic: env.ANTHROPIC_API_KEY };

  beforeAll(async () => {
    env.AI_DEFAULT_PROVIDER = "anthropic";
    env.ANTHROPIC_API_KEY = undefined;
    mock = installAiMock();
    mock.state.valid.anthropic.add(KEY);
    await resetDb();

    demo = await createOrgWithOwner("Agência Demo", "Dona Demo");
    await as(demo.actor, (s) => setProviderEnabled(s, "demo", true));
    helena = await addMember(demo.org.slug, demo.org.id, "designer", { name: "Helena Prado" });
    demoClient = (await as(demo.actor, (s) => createClient(s, { name: "Café Aurora" }))).id;
    demoProject = (await as(demo.actor, (s) => createProject(s, { clientId: demoClient, name: "Lançamento" }))).id;

    real = await createOrgWithOwner("Agência Real");
    expect((await as(real.actor, (s) => saveProviderKey(s, "anthropic", KEY))).ok).toBe(true);
    await as(real.actor, (s) => updateAiSettings(s, policy));
    const c = (await as(real.actor, (s) => createClient(s, { name: "Loja Segredo" }))).id;
    realProject = (await as(real.actor, (s) => createProject(s, { clientId: c, name: "Projeto Sigiloso" }))).id;
  });

  afterAll(() => {
    env.AI_DEFAULT_PROVIDER = saved.provider;
    env.ANTHROPIC_API_KEY = saved.anthropic;
    vi.unstubAllGlobals();
  });

  beforeEach(() => mock.reset());

  it("confere datas citadas no texto (o resto é sugestão)", () => {
    const today = "2026-10-18"; // domingo
    const d = citedDates("Post até 25/12, revisão 2027-01-10, reunião 3 de novembro, entrega sexta e amanhã", today);
    expect(d.has("2026-12-25")).toBe(true);
    expect(d.has("2027-01-10")).toBe(true);
    expect(d.has("2026-11-03")).toBe(true);
    expect(d.has("2026-10-23")).toBe(true);
    expect(d.has("2026-10-19")).toBe(true);
    // dd/mm já passado vai para o ano seguinte.
    expect(citedDates("até 05/01", today).has("2027-01-05")).toBe(true);
    expect(citedDates("sem datas", today).size).toBe(0);
    const members = [
      { membershipId: "a", name: "Helena Prado" },
      { membershipId: "b", name: "Bruno Lima" },
      { membershipId: "c", name: "Bruno Souza" },
    ];
    expect(matchMember("helena", members)).toBe("a");
    expect(matchMember("@Helena Prado", members)).toBe("a");
    // Homônimos não são adivinhados.
    expect(matchMember("Bruno", members)).toBeNull();
  });

  it("cria tarefas a partir de texto: prévia sem gravar e criação só após confirmação", async () => {
    const before = await countTasks(demo.actor);
    const { result, prepared } = await ask(demo.actor, {
      mode: "plan",
      projectId: demoProject,
      text: "- Criar post de lançamento até 20/12 @Helena\n- Revisar legenda\n- Agendar publicação urgente",
    });
    expect(prepared.generation.demo).toBe(true);
    expect(prepared.generation.module).toBe("tasks");
    expect(prepared.generation.task).toBe("task_planning");
    expect(result.mode).toBe("plan");
    if (result.mode !== "plan") return;
    expect(result.items.map((i) => i.title)).toEqual([
      "Criar post de lançamento",
      "Revisar legenda",
      "Agendar publicação urgente",
    ]);
    expect(result.items[0]?.dueOrigin).toBe("texto");
    expect(result.items[0]?.dueDate?.endsWith("-12-20")).toBe(true);
    expect(result.items[0]?.assigneeMembershipId).toBe(helena.membershipId);
    expect(result.items[2]?.priority).toBe("urgent");
    // Gerar não grava nada.
    expect(await countTasks(demo.actor)).toBe(before);

    const applied = await as(demo.actor, (s) =>
      applyTaskPlan(s, {
        projectId: demoProject,
        tasks: [
          { ...result.items[0]!, subtasks: ["Rascunho", "Arte final"], checklist: ["Marca aplicada"] },
          { ...result.items[1]!, dueDate: null },
        ],
      }),
    );
    expect(applied).toMatchObject({ created: 2, subtasks: 2 });
    expect(await countTasks(demo.actor)).toBe(before + 4);
    const detail = await as(demo.actor, (s) => getTask(s, applied.ids[0]!));
    expect(detail.task.assigneeMembershipId).toBe(helena.membershipId);
    expect(detail.subtasks.map((x) => x.title)).toEqual(["Rascunho", "Arte final"]);
    expect(detail.checklist.map((x) => x.title)).toEqual(["Marca aplicada"]);
  });

  it("respeita a política: só o texto digitado vai ao provedor; dados de tarefas exigem autorização", async () => {
    mock.state.reply = JSON.stringify({
      items: [
        {
          title: "Planejar campanha",
          description: "",
          priority: "high",
          dueDate: "2030-05-10",
          dueOrigin: "texto",
          assigneeHint: "",
          estimateMinutes: 60,
          subtasks: [],
          checklist: [],
        },
        {
          title: "Data no passado",
          description: "",
          priority: "x",
          dueDate: "2020-01-01",
          dueOrigin: "texto",
          assigneeHint: "Ninguém",
          estimateMinutes: -5,
          subtasks: ["a", "a"],
          checklist: [],
        },
      ],
    });
    const { result } = await ask(real.actor, { mode: "plan", projectId: realProject, text: "Campanha de inverno" });
    if (result.mode !== "plan") throw new Error("modo inesperado");
    // A IA disse "texto", mas a data não aparece no pedido: vira sugestão.
    expect(result.items[0]).toMatchObject({ dueDate: "2030-05-10", dueOrigin: "sugestao", priority: "high" });
    // Datas passadas são descartadas; prioridade inválida volta ao normal; listas sem repetição.
    expect(result.items[1]).toMatchObject({ dueDate: null, priority: "medium", estimateMinutes: null });
    expect(result.items[1]?.subtasks).toEqual(["a"]);
    expect(result.items[1]?.assigneeMembershipId).toBeNull();
    const sent = JSON.stringify(mock.calls.find((c) => c.url.includes("/v1/messages"))?.body);
    expect(sent).toContain("Campanha de inverno");
    expect(sent).not.toContain("Projeto Sigiloso");
    expect(sent).not.toContain("Loja Segredo");

    const cited = await ask(real.actor, { mode: "plan", text: "Campanha de inverno até 10/05/2030" });
    if (cited.result.mode !== "plan") throw new Error("modo inesperado");
    expect(cited.result.items[0]?.dueOrigin).toBe("texto");

    const t = await as(real.actor, (s) => createTask(s, { projectId: realProject, title: "Tarefa sigilosa" }));
    mock.reset();
    for (const mode of ["breakdown", "triage", "summary"] as const) {
      await expect(as(real.actor, (s) => prepareTaskAi(s, { mode, taskId: t.id }))).rejects.toThrow(POLICY_MESSAGE);
    }
    expect(mock.calls.filter((c) => c.url.includes("/v1/messages"))).toHaveLength(0);

    await as(real.actor, (s) => updateAiSettings(s, { ...policy, allowClientContext: true }));
    mock.state.reply = JSON.stringify({
      priority: "urgent",
      priorityReason: "Bloqueia a campanha.",
      dueDate: "2020-01-01",
      dueReason: "",
    });
    const triage = await ask(real.actor, { mode: "triage", taskId: t.id });
    expect(triage.result).toMatchObject({ mode: "triage", priority: "urgent", dueDate: null });
    expect(JSON.stringify(mock.calls.at(-1)?.body)).toContain("Tarefa sigilosa");
    await as(real.actor, (s) => updateAiSettings(s, policy));
  });

  it("quebra uma tarefa em subtarefas e checklist (sem repetir o que existe)", async () => {
    const t = await as(demo.actor, (s) => createTask(s, { projectId: demoProject, title: "Vídeo institucional" }));
    const { result } = await ask(demo.actor, { mode: "breakdown", taskId: t.id });
    if (result.mode !== "breakdown") throw new Error("modo inesperado");
    expect(result.subtasks.length).toBeGreaterThan(0);
    expect(result.checklist.length).toBeGreaterThan(0);
    await as(demo.actor, (s) =>
      applyTaskBreakdown(s, { taskId: t.id, subtasks: result.subtasks.slice(0, 2), checklist: result.checklist }),
    );
    const detail = await as(demo.actor, (s) => getTask(s, t.id));
    expect(detail.subtasks).toHaveLength(2);
    expect(detail.checklist.map((c) => c.title)).toEqual(result.checklist);

    // A segunda proposta não repete os itens já criados.
    const again = await ask(demo.actor, { mode: "breakdown", taskId: t.id });
    if (again.result.mode !== "breakdown") throw new Error("modo inesperado");
    expect(again.result.subtasks.map((x) => x.title)).not.toContain(result.subtasks[0]!.title);

    const sub = detail.subtasks[0]!;
    await expect(
      as(demo.actor, (s) => applyTaskBreakdown(s, { taskId: sub.id, subtasks: [{ title: "Neta" }] })),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("resume comentários e sugere prioridade sem inventar prazo", async () => {
    const t = await as(demo.actor, (s) => createTask(s, { projectId: demoProject, title: "Campanha de Natal" }));
    await expect(as(demo.actor, (s) => prepareTaskAi(s, { mode: "summary", taskId: t.id }))).rejects.toThrow(
      "ainda não tem comentários",
    );
    await as(demo.actor, (s) => addComment(s, { target: { taskId: t.id }, body: "Cliente aprovado o conceito." }));
    await as(helena, (s) => addComment(s, { target: { taskId: t.id }, body: "Falta a foto do produto?" }));
    const { result } = await ask(demo.actor, { mode: "summary", taskId: t.id });
    expect(result).toMatchObject({ mode: "summary", commentCount: 2 });
    if (result.mode !== "summary") return;
    expect(result.decisions).toEqual(["Cliente aprovado o conceito."]);
    expect(result.pending).toEqual(["Falta a foto do produto?"]);

    const triage = await ask(demo.actor, { mode: "triage", taskId: t.id });
    expect(triage.result).toMatchObject({ mode: "triage", dueDate: null });
  });

  it("converte solicitação em tarefas e a coloca em produção", async () => {
    const req = await as(demo.actor, (s) =>
      createRequest(s, {
        clientId: demoClient,
        title: "Posts de Black Friday",
        description: "Carrossel com ofertas; Stories de contagem regressiva; Post do último dia",
        desiredDueDate: "2030-11-20",
      }),
    );
    const { result } = await ask(demo.actor, { mode: "demand", requestId: req.id });
    if (result.mode !== "demand") throw new Error("modo inesperado");
    expect(result.requestId).toBe(req.id);
    expect(result.items.length).toBeGreaterThanOrEqual(3);

    const otherClient = (await as(demo.actor, (s) => createClient(s, { name: "Outro" }))).id;
    const otherProject = (await as(demo.actor, (s) => createProject(s, { clientId: otherClient, name: "X" }))).id;
    await expect(
      as(demo.actor, (s) =>
        applyTaskPlan(s, { projectId: otherProject, requestId: req.id, tasks: [result.items[0]!] }),
      ),
    ).rejects.toThrow("outro cliente");

    const applied = await as(demo.actor, (s) =>
      applyTaskPlan(s, { projectId: demoProject, requestId: req.id, tasks: result.items }),
    );
    const [row] = await withOrg(demo.org.id, (tx) => tx.select().from(requests).where(eq(requests.id, req.id)));
    expect(row).toMatchObject({ projectId: demoProject, status: "in_progress" });
    const detail = await as(demo.actor, (s) => getTask(s, applied.ids[0]!));
    expect(detail.request?.id).toBe(req.id);
  });

  it("exige permissão, IA ativa e lista pendências sem usar IA", async () => {
    const viewer = await addMember(demo.org.slug, demo.org.id, "finance");
    await expect(as(viewer, (s) => prepareTaskAi(s, { mode: "plan", text: "Qualquer coisa" }))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(
      as(helena, (s) =>
        applyTaskPlan(s, {
          projectId: demoProject,
          tasks: [{ title: "x", assigneeMembershipId: demo.actor.membershipId }],
        }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);

    await as(demo.actor, (s) => updateAiSettings(s, { ...policy, enabled: false }));
    await expect(as(demo.actor, (s) => prepareTaskAi(s, { mode: "plan", text: "Algo para fazer" }))).rejects.toThrow(
      "desativado",
    );
    await as(demo.actor, (s) => updateAiSettings(s, policy));

    // Organização com poucas tarefas, para a lista curta (8 por grupo) conter as novas.
    const a = await as(real.actor, (s) => createTask(s, { projectId: realProject, title: "Base pendente" }));
    const b = await as(real.actor, (s) =>
      createTask(s, {
        projectId: realProject,
        title: "Depende da base",
        assigneeMembershipId: real.actor.membershipId,
        dueDate: "2030-01-10",
      }),
    );
    await as(real.actor, (s) => addDependency(s, b.id, a.id));
    const health = await as(real.actor, taskHealth);
    expect(health.unassigned.rows.map((r) => r.id)).toContain(a.id);
    expect(health.unassigned.rows.map((r) => r.id)).not.toContain(b.id);
    expect(health.undated.rows.map((r) => r.id)).toContain(a.id);
    expect(health.blocked.rows.find((r) => r.id === b.id)?.blockers).toBe("Base pendente");
    expect(health.blocked.total).toBe(1);
    // Nada disso aparece para outra organização.
    const otherHealth = await as(demo.actor, taskHealth);
    expect(otherHealth.blocked.rows.find((r) => r.id === b.id)).toBeUndefined();
    expect(otherHealth.unassigned.total).toBeGreaterThan(0);
    expect((await as(real.actor, (s) => listTasks(s, { blocked: true }))).rows.map((r) => r.id)).toEqual([b.id]);
  });
});
