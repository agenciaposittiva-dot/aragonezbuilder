import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { withOrg } from "@/server/db";
import { automationRuns, domainEvents, tasks } from "@/server/db/schema";
import { interpolate, matchesConditions } from "@/server/events/automation-engine";
import { dispatchPendingEvents } from "@/server/events/dispatcher";
import { assertSafeWebhookUrl, isPrivateAddress } from "@/server/events/webhook";
import { saveRule, setRuleEnabled } from "@/server/services/automations";
import { createClient } from "@/server/services/clients";
import { changeProjectStatus, createProject } from "@/server/services/projects";
import { listStatuses } from "@/server/services/workflow";
import { addMember, as, createOrgWithOwner, resetDb } from "./helpers";

describe("condições de automação", () => {
  const payload = {
    priority: "urgent",
    stage: "client",
    versionNumber: 3,
    dueDate: "2026-10-20",
    tags: ["a", "b"],
    title: "Post de Natal",
    empty: "",
  };

  it("avalia operadores", () => {
    expect(matchesConditions([{ field: "priority", op: "eq", value: "urgent" }], payload)).toBe(true);
    expect(matchesConditions([{ field: "priority", op: "neq", value: "urgent" }], payload)).toBe(false);
    expect(matchesConditions([{ field: "stage", op: "in", value: ["internal", "client"] }], payload)).toBe(true);
    expect(matchesConditions([{ field: "stage", op: "in", value: "internal, x" }], payload)).toBe(false);
    expect(matchesConditions([{ field: "title", op: "contains", value: "natal" }], payload)).toBe(true);
    expect(matchesConditions([{ field: "tags", op: "contains", value: "b" }], payload)).toBe(true);
    expect(matchesConditions([{ field: "versionNumber", op: "gt", value: 2 }], payload)).toBe(true);
    expect(matchesConditions([{ field: "versionNumber", op: "lt", value: "2" }], payload)).toBe(false);
    expect(matchesConditions([{ field: "dueDate", op: "lt", value: "2026-11-01" }], payload)).toBe(true);
    expect(matchesConditions([{ field: "empty", op: "exists" }], payload)).toBe(false);
    expect(matchesConditions([{ field: "missing", op: "exists" }], payload)).toBe(false);
    expect(matchesConditions([], payload)).toBe(true);
    expect(
      matchesConditions(
        [
          { field: "priority", op: "eq", value: "urgent" },
          { field: "stage", op: "eq", value: "internal" },
        ],
        payload,
      ),
    ).toBe(false);
  });

  it("interpola variáveis do evento", () => {
    expect(interpolate("Aprovar {{title}} (v{{versionNumber}})", payload, "approval.requested")).toBe(
      "Aprovar Post de Natal (v3)",
    );
    expect(interpolate("{{evento}}: {{nada}}", payload, "approval.requested")).toBe("Aprovação solicitada: ");
  });
});

describe("proteção SSRF dos webhooks", () => {
  it("bloqueia redes privadas, loopback, link-local e metadados", () => {
    for (const ip of [
      "10.0.0.1",
      "127.0.0.1",
      "172.16.5.4",
      "192.168.1.10",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "::1",
      "fd00::1",
      "fe80::1",
      "::ffff:192.168.1.1",
      "::ffff:7f00:1",
    ]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"]) expect(isPrivateAddress(ip), ip).toBe(false);
  });

  it("recusa URLs inseguras antes de conectar", () => {
    expect(() => assertSafeWebhookUrl("http://example.com/hook")).toThrow(/https/);
    expect(() => assertSafeWebhookUrl("https://localhost/hook")).toThrow();
    expect(() => assertSafeWebhookUrl("https://169.254.169.254/latest/meta-data")).toThrow();
    expect(() => assertSafeWebhookUrl("https://[::1]/x")).toThrow();
    expect(() => assertSafeWebhookUrl("https://user:pass@example.com")).toThrow();
    expect(assertSafeWebhookUrl("https://hooks.example.com/x").hostname).toBe("hooks.example.com");
  });
});

describe("execução de automações", () => {
  let ctx: Awaited<ReturnType<typeof createOrgWithOwner>>;
  let projectId: string;
  let statusByKey: Record<string, string>;

  beforeAll(async () => {
    await resetDb();
    ctx = await createOrgWithOwner("Agência Automática");
    const clientId = (await as(ctx.actor, (s) => createClient(s, { name: "Cliente" }))).id;
    projectId = (await as(ctx.actor, (s) => createProject(s, { clientId, name: "Site novo" }))).id;
    statusByKey = Object.fromEntries(
      (await as(ctx.actor, (s) => listStatuses(s, "project"))).map((st) => [st.key, st.id]),
    );
    await dispatchPendingEvents(200);
  });

  it("designer não pode criar automações", async () => {
    const designer = await addMember(ctx.org.slug, ctx.org.id, "designer");
    await expect(
      as(designer, (s) =>
        saveRule(s, { name: "x", trigger: "task.created", actions: [{ type: "notify_client", title: "oi" }] }),
      ),
    ).rejects.toThrow(/permissão/i);
  });

  it("recusa webhook para rede privada ao salvar", async () => {
    await expect(
      as(ctx.actor, (s) =>
        saveRule(s, {
          name: "Hook",
          trigger: "task.created",
          actions: [{ type: "webhook", url: "https://10.1.2.3/hook" }],
        }),
      ),
    ).rejects.toThrow(/Webhook/);
  });

  it("recusa condição com campo que não pertence ao gatilho", async () => {
    await expect(
      as(ctx.actor, (s) =>
        saveRule(s, {
          name: "x",
          trigger: "task.created",
          conditions: [{ field: "decision", op: "eq", value: "approved" }],
          actions: [{ type: "notify_client", title: "oi" }],
        }),
      ),
    ).rejects.toThrow(/não existe/);
  });

  it("create_task cria a tarefa no projeto do evento, sem disparar laços", async () => {
    const { id: ruleId } = await as(ctx.actor, (s) =>
      saveRule(s, {
        name: "Encerramento",
        trigger: "project.status_changed",
        conditions: [{ field: "toCategory", op: "eq", value: "done" }],
        actions: [{ type: "create_task", title: "Encerramento: {{name}}", dueInDays: 3 }],
      }),
    );
    // regra que reagiria à tarefa criada (não deve rodar para eventos de automação)
    const { id: loopRule } = await as(ctx.actor, (s) =>
      saveRule(s, {
        name: "Laço",
        trigger: "task.created",
        actions: [{ type: "create_task", title: "Não deveria existir" }],
      }),
    );

    await as(ctx.actor, (s) => changeProjectStatus(s, projectId, statusByKey.active!));
    await dispatchPendingEvents();
    let created = await withOrg(ctx.org.id, (tx) => tx.select().from(tasks).where(eq(tasks.projectId, projectId)));
    expect(created).toHaveLength(0); // "Em andamento" não atende a condição

    await as(ctx.actor, (s) => changeProjectStatus(s, projectId, statusByKey.done!));
    await dispatchPendingEvents();
    await dispatchPendingEvents(); // processa também os eventos gerados pela automação
    created = await withOrg(ctx.org.id, (tx) => tx.select().from(tasks).where(eq(tasks.projectId, projectId)));
    expect(created.map((t) => t.title)).toEqual(["Encerramento: Site novo"]);
    expect(created[0]!.dueDate).not.toBeNull();

    const runs = await withOrg(ctx.org.id, (tx) =>
      tx.select().from(automationRuns).where(eq(automationRuns.ruleId, ruleId)),
    );
    expect(runs.map((r) => r.status).sort()).toEqual(["skipped", "success"]);
    const loopRuns = await withOrg(ctx.org.id, (tx) =>
      tx.select().from(automationRuns).where(eq(automationRuns.ruleId, loopRule)),
    );
    expect(loopRuns).toHaveLength(0);
    const events = await withOrg(ctx.org.id, (tx) =>
      tx
        .select()
        .from(domainEvents)
        .where(and(eq(domainEvents.type, "task.created"))),
    );
    expect((events[0]!.payload as { viaAutomation?: string }).viaAutomation).toBe(ruleId);
    await as(ctx.actor, (s) => setRuleEnabled(s, loopRule, false));
  });

  it("falha numa regra é registrada e não impede as outras", async () => {
    const { id: bad } = await as(ctx.actor, (s) =>
      saveRule(s, {
        name: "Status sem tarefa",
        trigger: "project.status_changed",
        actions: [{ type: "set_task_status", statusKey: "done" }],
      }),
    );
    const { id: good } = await as(ctx.actor, (s) =>
      saveRule(s, {
        name: "Avisar dona",
        trigger: "project.status_changed",
        actions: [{ type: "notify_members", roleKeys: ["owner"], title: "Projeto mudou" }],
      }),
    );
    await as(ctx.actor, (s) => changeProjectStatus(s, projectId, statusByKey.active!));
    await dispatchPendingEvents();
    const badRuns = await withOrg(ctx.org.id, (tx) =>
      tx.select().from(automationRuns).where(eq(automationRuns.ruleId, bad)),
    );
    expect(badRuns[0]?.status).toBe("failed");
    expect(badRuns[0]?.error).toMatch(/tarefa/);
    const goodRuns = await withOrg(ctx.org.id, (tx) =>
      tx.select().from(automationRuns).where(eq(automationRuns.ruleId, good)),
    );
    expect(goodRuns[0]?.status).toBe("success");
  });
});
