import { eq } from "drizzle-orm";
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { todayISO } from "@/lib/format";
import { withOrg, withSystem } from "@/server/db";
import { aiGenerations, designs, memberships } from "@/server/db/schema";
import { markOverdueInvoices } from "@/server/events/schedules";
import { createClient, saveService } from "@/server/services/clients";
import { getDashboard } from "@/server/services/dashboard";
import { createDesign } from "@/server/services/designs";
import { createInvoice } from "@/server/services/finance";
import { storeUpload } from "@/server/services/files";
import { createProject } from "@/server/services/projects";
import { createTask } from "@/server/services/tasks";
import { addMember, as, createOrgWithOwner, resetDb } from "./helpers";

type Ctx = Awaited<ReturnType<typeof createOrgWithOwner>>;
const THUMB = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";

function plusDays(days: number) {
  const d = new Date(`${todayISO()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

describe("dashboard: estúdio, projetos recentes, agenda e IA com dados reais", () => {
  let ctx: Ctx;
  let clientId: string;

  beforeAll(async () => {
    await resetDb();
    ctx = await createOrgWithOwner("Agência Painel");
    clientId = (await as(ctx.actor, (s) => createClient(s, { name: "Cliente Painel" }))).id;
  });

  it("sem dados: blocos vazios (nada fictício)", async () => {
    const d = await as(ctx.actor, getDashboard);
    expect(d.studio).toMatchObject({ recent: [], carouselsInProgress: 0, approvedThisMonth: 0 });
    expect(d.recentProjects).toEqual([]);
    expect(d.deadlines).toEqual([]);
    expect(d.ai).toEqual({ total: 0, images: 0 });
  });

  it("carrossel em andamento até exportar; projeto recente pela atividade, com miniatura", async () => {
    const quiet = await as(ctx.actor, (s) => createProject(s, { clientId, name: "Projeto parado" }));
    const busy = await as(ctx.actor, (s) =>
      createProject(s, { clientId, name: "Projeto ativo", dueDate: plusDays(3) }),
    );
    const carousel = await as(ctx.actor, (s) =>
      createDesign(s, {
        name: "Carrossel",
        width: 1080,
        height: 1350,
        projectId: busy.id,
        preset: "carousel-portrait",
        carousel: true,
        pages: 3,
      }),
    );
    await withOrg(ctx.org.id, (tx) => tx.update(designs).set({ thumbnail: THUMB }).where(eq(designs.id, carousel.id)));
    // Atividade mais recente no projeto ativo (tarefa nova depois do projeto parado).
    await as(ctx.actor, (s) => createTask(s, { projectId: busy.id, title: "Revisar textos" }));

    let d = await as(ctx.actor, getDashboard);
    expect(d.studio?.carouselsInProgress).toBe(1);
    expect(d.studio?.recent[0]?.id).toBe(carousel.id);
    expect(d.recentProjects.map((p) => p.id)).toEqual([busy.id, quiet.id]);
    expect(d.recentProjects[0]).toMatchObject({ thumbnail: THUMB, designCount: 1, openTasks: 1 });
    expect(d.deadlines.map((p) => p.id)).toEqual([busy.id]);

    // Exportado (arquivo de saída gravado) = não está mais "em andamento".
    const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: "#123456" } })
      .png()
      .toBuffer();
    const out = await as(ctx.actor, (s) =>
      storeUpload(s, { buffer: png, originalName: "carrossel.png" }, { clientId }),
    );
    await withOrg(ctx.org.id, (tx) =>
      tx.update(designs).set({ outputFileId: out.fileId }).where(eq(designs.id, carousel.id)),
    );
    d = await as(ctx.actor, getDashboard);
    expect(d.studio?.carouselsInProgress).toBe(0);
  });

  it("gerações de IA contam só as da própria pessoa no mês", async () => {
    const other = await addMember(ctx.org.slug, ctx.org.id, "designer", { name: "Outra" });
    await withOrg(ctx.org.id, (tx) =>
      tx.insert(aiGenerations).values([
        {
          organizationId: ctx.org.id,
          userId: ctx.actor.userId,
          kind: "text",
          title: "Legenda",
          output: "x",
          provider: "demo",
          model: "demo",
        },
        {
          organizationId: ctx.org.id,
          userId: ctx.actor.userId,
          kind: "image",
          title: "Imagem",
          output: "x",
          provider: "demo",
          model: "demo",
        },
        {
          organizationId: ctx.org.id,
          userId: other.userId,
          kind: "text",
          title: "Dela",
          output: "x",
          provider: "demo",
          model: "demo",
        },
      ]),
    );
    expect((await as(ctx.actor, getDashboard)).ai).toEqual({ total: 2, images: 1 });
  });
});

describe("dashboard: inadimplência, contratos a vencer e carga da equipe", () => {
  let ctx: Ctx;
  let clientId: string;

  beforeAll(async () => {
    ctx = await createOrgWithOwner("Agência Alertas Painel");
    clientId = (await as(ctx.actor, (s) => createClient(s, { name: "Cliente Alertas" }))).id;
  });

  it("indicadores financeiros só com permissão; carga por pessoa marca sobrecarga", async () => {
    const before = await as(ctx.actor, getDashboard);
    expect(before.kpis).toMatchObject({ delinquentClients: 0, expiringContracts: 0, overloaded: 0, teamLoad: [] });

    await as(ctx.actor, (s) =>
      createInvoice(s, {
        clientId,
        description: "Vencida",
        amount: "10",
        issueDate: "2026-01-01",
        dueDate: plusDays(-2),
      }),
    );
    await markOverdueInvoices();
    await as(ctx.actor, (s) =>
      saveService(s, { clientId, name: "Contrato curto", amount: "100", billingType: "one_time", endsOn: plusDays(7) }),
    );
    const designer = await addMember(ctx.org.slug, ctx.org.id, "designer");
    await withSystem((tx) =>
      tx.update(memberships).set({ weeklyCapacityMinutes: 60 }).where(eq(memberships.id, designer.membershipId)),
    );
    const project = await as(ctx.actor, (s) => createProject(s, { clientId, name: "Projeto carga" }));
    await as(ctx.actor, (s) =>
      createTask(s, {
        projectId: project.id,
        title: "Tarefa grande",
        assigneeMembershipId: designer.membershipId,
        dueDate: plusDays(2),
        estimateMinutes: 120,
      }),
    );

    const d = await as(ctx.actor, getDashboard);
    expect(d.kpis).toMatchObject({ delinquentClients: 1, expiringContracts: 1, overloaded: 1 });
    const row = d.kpis!.teamLoad.find((m) => m.membershipId === designer.membershipId);
    expect(row).toMatchObject({ open: 1, overdue: 0, upcomingMinutes: 120, capacity: 60, load: 2 });

    // Sem papel de gestão (colaborador vê só o próprio escopo): nenhum indicador.
    const collaborator = await addMember(ctx.org.slug, ctx.org.id, "collaborator");
    expect((await as(collaborator, getDashboard)).kpis).toBeNull();
  });
});
