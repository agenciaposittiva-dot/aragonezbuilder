/**
 * Cria uma organização de demonstração com equipe, clientes, projetos,
 * tarefas, solicitações, materiais em aprovação e lançamentos financeiros,
 * usando os mesmos serviços da aplicação (com as mesmas regras de acesso).
 *
 * Só insere dados: não altera nem apaga nada que já exista. Se a organização
 * de demonstração já existir, o script para sem fazer nada.
 *
 * Uso: npm run db:seed
 *      ENV_FILE=.env.outro npm run db:seed
 *      SEED_PASSWORD=minha-senha npm run db:seed
 *
 * Em produção (NODE_ENV=production) é preciso passar --allow-production,
 * porque as contas criadas têm senha conhecida.
 */
import "../src/worker/load-env";
import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";
import sharp from "sharp";
import type { SystemRoleKey } from "@/lib/permissions";
import { inOrg, type Scope } from "@/server/authz";
import { resolveActor, type Actor } from "@/server/authz/actor";
import { pool, withSystem } from "@/server/db";
import { account, clientAccess, memberships, organizations, roles, user, workflowStatuses } from "@/server/db/schema";
import { dispatchPendingEvents } from "@/server/events/dispatcher";
import { decideApproval, requestApproval } from "@/server/services/approvals";
import { createClient, saveContact, saveService, updateBrandProfile } from "@/server/services/clients";
import { addComment } from "@/server/services/comments";
import { createInvoice, markInvoicePaid, saveExpense } from "@/server/services/finance";
import { storeUpload } from "@/server/services/files";
import { createOrganization } from "@/server/services/organizations";
import { createProject } from "@/server/services/projects";
import { convertRequest, createRequest } from "@/server/services/requests";
import { createTask } from "@/server/services/tasks";
import { addTimeEntry } from "@/server/services/time-entries";

const ORG_SLUG = "estudio-aurora";
const PASSWORD = process.env.SEED_PASSWORD || "aurora-demo-2026";
const DOMAIN = "demo.aragonez.app";

if (process.env.NODE_ENV === "production" && !process.argv.includes("--allow-production")) {
  console.error("Recusado: NODE_ENV=production. Use --allow-production se tiver certeza.");
  process.exit(1);
}

/** Data relativa a hoje (YYYY-MM-DD), no fuso de São Paulo. */
function day(offset: number) {
  const d = new Date(Date.now() + offset * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(d);
}

async function createLoginUser(name: string, email: string) {
  const id = randomUUID();
  const hash = await hashPassword(PASSWORD);
  await withSystem(async (tx) => {
    await tx.insert(user).values({ id, name, email, emailVerified: true });
    await tx
      .insert(account)
      .values({ id: randomUUID(), accountId: id, providerId: "credential", userId: id, password: hash });
  });
  return id;
}

async function addMember(
  orgId: string,
  roleKey: SystemRoleKey,
  u: { name: string; email: string; jobTitle?: string; hourlyCostCents?: number; clientIds?: string[] },
): Promise<Actor> {
  const userId = await createLoginUser(u.name, u.email);
  await withSystem(async (tx) => {
    const [role] = await tx
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.organizationId, orgId), eq(roles.key, roleKey)));
    if (!role) throw new Error(`Papel ${roleKey} não encontrado`);
    const [m] = await tx
      .insert(memberships)
      .values({
        organizationId: orgId,
        userId,
        roleId: role.id,
        jobTitle: u.jobTitle ?? null,
        hourlyCostCents: u.hourlyCostCents ?? null,
      })
      .returning({ id: memberships.id });
    for (const clientId of u.clientIds ?? []) {
      await tx.insert(clientAccess).values({ organizationId: orgId, clientId, membershipId: m!.id });
    }
  });
  return actorFor(userId);
}

async function actorFor(userId: string) {
  const actor = await resolveActor(userId, ORG_SLUG);
  if (!actor) throw new Error("Ator não resolvido");
  return actor;
}

/** Peça fictícia gerada na hora (PNG), nas cores da marca. */
async function artwork(title: string, subtitle: string, bg: string, fg: string) {
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080">
    <rect width="1080" height="1080" fill="${bg}"/>
    <circle cx="880" cy="200" r="260" fill="${fg}" opacity="0.12"/>
    <circle cx="160" cy="940" r="200" fill="${fg}" opacity="0.08"/>
    <text x="90" y="520" font-family="Helvetica, Arial, sans-serif" font-size="92" font-weight="700" fill="${fg}">${esc(title)}</text>
    <text x="90" y="610" font-family="Helvetica, Arial, sans-serif" font-size="40" fill="${fg}" opacity="0.8">${esc(subtitle)}</text>
    <rect x="90" y="860" width="260" height="76" rx="38" fill="${fg}"/>
    <text x="220" y="910" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="30" font-weight="700" fill="${bg}">Peça agora</text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function statusIds(s: Scope) {
  const rows = await s.db.select().from(workflowStatuses);
  const get = (entity: "task" | "project", key: string) => {
    const row = rows.find((r) => r.entity === entity && r.key === key);
    if (!row) throw new Error(`Status ${entity}/${key} não encontrado`);
    return row.id;
  };
  return { task: (k: string) => get("task", k), project: (k: string) => get("project", k) };
}

async function main() {
  const existing = await withSystem((tx) =>
    tx.select({ id: organizations.id }).from(organizations).where(eq(organizations.slug, ORG_SLUG)),
  );
  if (existing.length) {
    console.log(`A organização de demonstração "${ORG_SLUG}" já existe. Nada foi alterado.`);
    return;
  }

  /* Organização e equipe ------------------------------------------------ */
  const ownerId = await createLoginUser("Helena Prado", `helena@${DOMAIN}`);
  const org = await createOrganization(ownerId, { name: "Estúdio Aurora", slug: ORG_SLUG });
  const owner = await actorFor(ownerId);
  await withSystem((tx) =>
    tx
      .update(memberships)
      .set({ jobTitle: "Diretora de criação", hourlyCostCents: 18000 })
      .where(eq(memberships.id, owner.membershipId)),
  );

  const account_ = await addMember(org.id, "account", {
    name: "Rafael Nunes",
    email: `rafael@${DOMAIN}`,
    jobTitle: "Atendimento",
    hourlyCostCents: 9000,
  });
  const designer = await addMember(org.id, "designer", {
    name: "Marina Costa",
    email: `marina@${DOMAIN}`,
    jobTitle: "Designer sênior",
    hourlyCostCents: 11000,
  });
  const copy = await addMember(org.id, "copywriter", {
    name: "Tiago Alves",
    email: `tiago@${DOMAIN}`,
    jobTitle: "Redator",
    hourlyCostCents: 8500,
  });
  await addMember(org.id, "finance", { name: "Lúcia Ferraz", email: `lucia@${DOMAIN}`, jobTitle: "Financeiro" });

  /* Clientes ---------------------------------------------------------------- */
  const { cafe, clinica, st } = await inOrg(owner, async (s) => {
    const st = await statusIds(s);
    const cafe = await createClient(s, {
      name: "Café Serra Azul",
      legalName: "Serra Azul Torrefação Ltda.",
      industry: "Alimentos e bebidas",
      email: "marketing@serraazul.example",
      website: "https://serraazul.example",
      notesInternal: "Cliente sensível a prazo. Aprovações costumam sair em 48 h.",
      leadMembershipId: account_.membershipId,
    });
    await saveContact(s, {
      clientId: cafe.id,
      name: "Paula Ribeiro",
      email: `paula@${DOMAIN}`,
      position: "Gerente de marketing",
      isPrimary: true,
    });
    await updateBrandProfile(s, {
      clientId: cafe.id,
      toneOfVoice: "Acolhedor, próximo e com orgulho da origem. Frases curtas, sem jargão.",
      audience: "Adultos de 25 a 45 anos que valorizam café especial e consumo consciente.",
      objectives: "Fortalecer a linha de cafés especiais e aumentar as vendas na loja online.",
      positioning: "Café de origem, torrado na semana, direto da serra para a sua xícara.",
      keywords: ["origem", "torra fresca", "serra", "ritual"],
      avoid: "Evitar tom de luxo inacessível e comparações com concorrentes.",
      colors: [
        { name: "Azul serra", hex: "#1F3A5F" },
        { name: "Creme", hex: "#F3E9DC" },
        { name: "Caramelo", hex: "#C08552" },
      ],
      fonts: [{ name: "Fraunces", usage: "Títulos" }],
    });
    await saveService(s, {
      clientId: cafe.id,
      name: "Gestão de redes sociais",
      billingType: "monthly",
      amount: 4500,
      billingDay: 10,
      startsOn: day(-120),
    });
    const clinica = await createClient(s, {
      name: "Clínica Vitta",
      industry: "Saúde",
      email: "contato@vitta.example",
      leadMembershipId: account_.membershipId,
    });
    await saveService(s, {
      clientId: clinica.id,
      name: "Campanhas de tráfego pago",
      billingType: "monthly",
      amount: 3200,
      billingDay: 5,
      startsOn: day(-60),
    });
    return { cafe, clinica, st };
  });

  const clientUser = await addMember(org.id, "client", {
    name: "Paula Ribeiro",
    email: `paula@${DOMAIN}`,
    clientIds: [cafe.id],
  });

  /* Projetos e tarefas ----------------------------------------------------- */
  const team = [designer.membershipId, copy.membershipId, account_.membershipId];
  const { winter, social } = await inOrg(owner, async (s) => {
    const winter = await createProject(s, {
      clientId: cafe.id,
      name: "Lançamento Linha Inverno",
      objective: "Apresentar os três novos blends de inverno e gerar 400 pedidos no primeiro mês.",
      ownerMembershipId: account_.membershipId,
      statusId: st.project("active"),
      priority: "high",
      startDate: day(-20),
      dueDate: day(25),
      budget: 18000,
      memberIds: team,
    });
    const social = await createProject(s, {
      clientId: cafe.id,
      name: "Social media — mês corrente",
      ownerMembershipId: account_.membershipId,
      statusId: st.project("active"),
      startDate: day(-10),
      dueDate: day(20),
      memberIds: team,
    });
    await createProject(s, {
      clientId: clinica.id,
      name: "Campanha Check-up Anual",
      ownerMembershipId: owner.membershipId,
      statusId: st.project("planning"),
      startDate: day(5),
      dueDate: day(45),
      budget: 9000,
      memberIds: [designer.membershipId],
    });
    return { winter, social };
  });

  const tasks = await inOrg(owner, async (s) => {
    const t = (
      title: string,
      projectId: string,
      status: string,
      assignee: string,
      due: number,
      extra: { priority?: "low" | "medium" | "high" | "urgent"; estimate?: number; description?: string } = {},
    ) =>
      createTask(s, {
        projectId,
        title,
        description: extra.description,
        statusId: st.task(status),
        assigneeMembershipId: assignee,
        priority: extra.priority ?? "medium",
        startDate: day(Math.min(due - 3, 0)),
        dueDate: day(due),
        estimateMinutes: extra.estimate ?? 240,
      });
    return {
      keyVisual: await t("Key visual da campanha", winter.id, "client_review", designer.membershipId, 2, {
        priority: "high",
        estimate: 600,
        description: "Peça principal que guia os desdobramentos. Usar a paleta de inverno.",
      }),
      manifesto: await t("Texto manifesto e headlines", winter.id, "done", copy.membershipId, -4, { estimate: 300 }),
      reels: await t("Roteiro do reels de lançamento", winter.id, "doing", copy.membershipId, 4),
      email: await t("E-mail marketing de lançamento", winter.id, "todo", designer.membershipId, 9),
      landing: await t("Ajustes na página de produto", winter.id, "backlog", designer.membershipId, 15, {
        priority: "low",
      }),
      calendar: await t("Calendário editorial do mês", social.id, "done", account_.membershipId, -6),
      posts: await t("Carrossel: métodos de preparo", social.id, "internal_review", designer.membershipId, 1, {
        priority: "high",
      }),
      overdue: await t("Respostas da caixa de mensagens", social.id, "doing", account_.membershipId, -1, {
        priority: "urgent",
        estimate: 60,
      }),
    };
  });

  /* Tempo registrado (alimenta relatórios e rentabilidade) ---------------- */
  await inOrg(designer, async (s) => {
    await addTimeEntry(s, { taskId: tasks.keyVisual.id, date: day(-3), minutes: 210, note: "Primeiras direções" });
    await addTimeEntry(s, { taskId: tasks.keyVisual.id, date: day(-1), minutes: 180, note: "Refinamento" });
    await addTimeEntry(s, { taskId: tasks.posts.id, date: day(-1), minutes: 150 });
  });
  await inOrg(copy, async (s) => {
    await addTimeEntry(s, { taskId: tasks.manifesto.id, date: day(-5), minutes: 240 });
    await addTimeEntry(s, { taskId: tasks.reels.id, date: day(0), minutes: 90 });
  });

  /* Materiais e aprovações -------------------------------------------------- */
  const kv = await inOrg(designer, async (s) =>
    storeUpload(
      s,
      {
        buffer: await artwork("Linha Inverno", "Três blends para dias frios", "#1F3A5F", "#F3E9DC"),
        originalName: "key-visual-inverno.png",
      },
      { projectId: winter.id, taskId: tasks.keyVisual.id, category: "deliverable", note: "Versão para aprovação" },
    ),
  );
  const carousel = await inOrg(designer, async (s) =>
    storeUpload(
      s,
      {
        buffer: await artwork("Métodos de preparo", "Coado, prensa e espresso", "#F3E9DC", "#1F3A5F"),
        originalName: "carrossel-preparo.png",
      },
      { projectId: social.id, taskId: tasks.posts.id, category: "deliverable" },
    ),
  );
  const kvApproval = await inOrg(owner, async (s) => {
    const internal = await requestApproval(s, { fileId: kv.fileId, stage: "internal" });
    await decideApproval(s, { approvalId: internal.id, decision: "approved", note: "Pode seguir para o cliente." });
    const client = await requestApproval(s, {
      fileId: kv.fileId,
      stage: "client",
      message: "Paula, segue o key visual da Linha Inverno. Ele guia todos os desdobramentos da campanha.",
      dueDate: day(2),
    });
    await requestApproval(s, { fileId: carousel.fileId, stage: "internal", dueDate: day(1) });
    await addComment(s, {
      target: { fileId: kv.fileId },
      body: "Usamos o azul serra como base para reforçar a origem. Os textos finais entram no desdobramento.",
      internal: false,
    });
    await addComment(s, {
      target: { fileId: kv.fileId },
      body: "Margem de lucro apertada neste job: evitar mais de uma rodada extra de ajustes.",
      internal: true,
    });
    return client;
  });

  /* Solicitações do cliente ------------------------------------------------- */
  await inOrg(clientUser, async (s) => {
    await createRequest(s, {
      clientId: cafe.id,
      title: "Posts para a Semana do Café",
      category: "social_media",
      objective: "Divulgar a degustação gratuita na loja e o desconto de 15% no site.",
      description: "Precisamos de 4 posts e 3 stories. A degustação acontece no sábado, das 9 h às 13 h.",
      channel: "Instagram",
      format: "Feed 1080×1350 e stories",
      piecesCount: 7,
      desiredDueDate: day(6),
      priority: "high",
    });
  });
  const banner = await inOrg(clientUser, (s) =>
    createRequest(s, {
      clientId: cafe.id,
      title: "Banner para o site — frete grátis",
      category: "other",
      description: "Banner do topo do site anunciando frete grátis acima de R$ 150.",
      desiredDueDate: day(12),
    }),
  );
  await inOrg(owner, (s) => convertRequest(s, { requestId: banner.id, mode: "existing", projectId: social.id }));

  /* Financeiro --------------------------------------------------------------- */
  await inOrg(owner, async (s) => {
    const paid = await createInvoice(s, {
      clientId: cafe.id,
      description: "Gestão de redes sociais — mês anterior",
      amount: 4500,
      issueDate: day(-35),
      dueDate: day(-25),
    });
    await markInvoicePaid(s, { id: paid.id, paidAt: day(-26) });
    await createInvoice(s, {
      clientId: cafe.id,
      projectId: winter.id,
      description: "Lançamento Linha Inverno — 50% de entrada",
      amount: 9000,
      issueDate: day(-5),
      dueDate: day(10),
    });
    await createInvoice(s, {
      clientId: clinica.id,
      description: "Campanhas de tráfego pago — mês corrente",
      amount: 3200,
      issueDate: day(-12),
      dueDate: day(-2),
    });
    await saveExpense(s, {
      projectId: winter.id,
      clientId: cafe.id,
      category: "Produção",
      supplier: "Estúdio Foto Luz",
      description: "Ensaio fotográfico dos produtos",
      amount: 2400,
      dueDate: day(3),
    });
    await saveExpense(s, {
      category: "Ferramentas",
      supplier: "Banco de imagens",
      description: "Assinatura mensal",
      amount: 189.9,
      dueDate: day(-8),
      status: "paid",
      paidAt: day(-8),
    });
  });

  /* Processa os eventos gerados (notificações, automações, miniaturas) ----- */
  for (let i = 0; i < 20; i++) {
    const r = await dispatchPendingEvents(100);
    if (!r.processed && !r.failed) break;
  }

  console.log(`
Organização de demonstração criada: Estúdio Aurora (/w/${ORG_SLUG})
Senha de todas as contas: ${PASSWORD}

  Proprietária   helena@${DOMAIN}
  Atendimento    rafael@${DOMAIN}
  Designer       marina@${DOMAIN}
  Redator        tiago@${DOMAIN}
  Financeiro     lucia@${DOMAIN}
  Cliente        paula@${DOMAIN}   (área do cliente: /portal/${ORG_SLUG})

Aprovação aguardando a cliente: ${kvApproval.id}
`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
