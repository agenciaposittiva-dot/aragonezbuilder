import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { withOrg } from "@/server/db";
import { tasks } from "@/server/db/schema";
import { listTemplates, saveTemplate } from "@/server/services/briefings";
import { createClient } from "@/server/services/clients";
import { getProject } from "@/server/services/projects";
import {
  changeRequestStatus,
  convertRequest,
  createRequest,
  getRequest,
  listRequests,
} from "@/server/services/requests";
import { addMember, as, createOrgWithOwner, resetDb } from "./helpers";

describe("solicitações e briefings", () => {
  let a: Awaited<ReturnType<typeof createOrgWithOwner>>;
  let b: Awaited<ReturnType<typeof createOrgWithOwner>>;
  let clientA: string;
  let clientA2: string;

  beforeAll(async () => {
    await resetDb();
    a = await createOrgWithOwner("Agência Pedidos");
    b = await createOrgWithOwner("Outra Agência");
    clientA = (await as(a.actor, (s) => createClient(s, { name: "Loja" }))).id;
    clientA2 = (await as(a.actor, (s) => createClient(s, { name: "Restaurante" }))).id;
  });

  it("numera solicitações em sequência por organização", async () => {
    const n1 = await as(a.actor, (s) => createRequest(s, { clientId: clientA, title: "Post 1" }));
    const n2 = await as(a.actor, (s) => createRequest(s, { clientId: clientA2, title: "Post 2" }));
    const clientB = (await as(b.actor, (s) => createClient(s, { name: "Cliente B" }))).id;
    const nb = await as(b.actor, (s) => createRequest(s, { clientId: clientB, title: "Primeiro da B" }));
    expect([n1.number, n2.number]).toEqual([1, 2]);
    expect(nb.number).toBe(1);
  });

  it("cliente só abre solicitação para a própria empresa", async () => {
    const clientUser = await addMember(a.org.slug, a.org.id, "client", { clientIds: [clientA] });
    const own = await as(clientUser, (s) => createRequest(s, { clientId: clientA, title: "Banner" }));
    expect(own.number).toBeGreaterThan(0);
    await expect(as(clientUser, (s) => createRequest(s, { clientId: clientA2, title: "Invasão" }))).rejects.toThrow(
      /sua empresa/i,
    );
    const list = await as(clientUser, (s) => listRequests(s, {}));
    expect(list.rows.every((r) => r.clientId === clientA)).toBe(true);
  });

  it("exige os campos obrigatórios do briefing", async () => {
    const templates = await as(a.actor, (s) => listTemplates(s));
    const social = templates.find((t) => t.category === "social_media")!;
    await expect(
      as(a.actor, (s) =>
        createRequest(s, { clientId: clientA, title: "Sem redes", templateId: social.id, briefing: {} }),
      ),
    ).rejects.toThrow(/briefing/i);
    const ok = await as(a.actor, (s) =>
      createRequest(s, {
        clientId: clientA,
        title: "Com redes",
        templateId: social.id,
        briefing: { redes: ["Instagram"], extra: "ignorado" },
      }),
    );
    const detail = await as(a.actor, (s) => getRequest(s, ok.id));
    expect(detail.request.briefing).toEqual({ redes: ["Instagram"], legenda_pronta: false });
  });

  it("modelo personalizado valida tipos e opções", async () => {
    const t = await as(a.actor, (s) =>
      saveTemplate(s, {
        name: "Teste",
        category: "other",
        fields: [
          { key: "site", label: "Site", type: "url", required: true },
          { key: "formato", label: "Formato", type: "select", options: ["A", "B"] },
        ],
      }),
    );
    await expect(
      as(a.actor, (s) =>
        createRequest(s, {
          clientId: clientA,
          title: "x",
          templateId: t.id,
          briefing: { site: "ftp://x", formato: "C" },
        }),
      ),
    ).rejects.toThrow(/briefing/i);
  });

  it("converte em projeto com tarefa inicial e vincula a solicitação", async () => {
    const r = await as(a.actor, (s) =>
      createRequest(s, { clientId: clientA, title: "Campanha de verão", desiredDueDate: "2026-12-20" }),
    );
    const res = await as(a.actor, (s) => convertRequest(s, { requestId: r.id, mode: "new" }));
    const detail = await as(a.actor, (s) => getRequest(s, r.id));
    expect(detail.request.projectId).toBe(res.projectId);
    expect(detail.request.status).toBe("in_progress");
    const project = await as(a.actor, (s) => getProject(s, res.projectId));
    expect(project.project.clientId).toBe(clientA);
    const [task] = await withOrg(a.org.id, (tx) => tx.select().from(tasks).where(eq(tasks.id, res.taskId)));
    expect(task?.requestId).toBe(r.id);
    expect(task?.projectId).toBe(res.projectId);
    await expect(as(a.actor, (s) => convertRequest(s, { requestId: r.id, mode: "new" }))).rejects.toThrow(
      /já está vinculada/i,
    );
  });

  it("recusa exige motivo e respeita transições", async () => {
    const r = await as(a.actor, (s) => createRequest(s, { clientId: clientA, title: "Recusar" }));
    await expect(as(a.actor, (s) => changeRequestStatus(s, r.id, "rejected"))).rejects.toThrow(/motivo/i);
    await as(a.actor, (s) => changeRequestStatus(s, r.id, "rejected", "Fora do escopo"));
    await expect(as(a.actor, (s) => changeRequestStatus(s, r.id, "delivered"))).rejects.toThrow(/não permitida/i);
  });

  it("solicitação de outra organização é invisível", async () => {
    const r = await as(a.actor, (s) => createRequest(s, { clientId: clientA, title: "Privada" }));
    await expect(as(b.actor, (s) => getRequest(s, r.id))).rejects.toThrow(/não encontrada/i);
  });
});
