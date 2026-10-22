import { type AnyColumn, and, count, eq, gt, isNotNull, isNull, ne } from "drizzle-orm";
import {
  brandRadarProfiles,
  clientPortalSettings,
  clients,
  designs,
  invitations,
  memberships,
  organizations,
  projects,
  roles,
  tasks,
} from "@/server/db/schema";
import { can, clientScope, projectScope, taskScope, type Scope } from "@/server/authz";
import { providerStates } from "./ai-providers";
import { designScope } from "./designs";

/*
 * "Me guie": primeiros passos calculados com dados reais da agência. Cada
 * passo só aparece para quem tem permissão de fazê-lo, e as contagens
 * respeitam o escopo de quem vê (nenhum dado de cliente fora do alcance).
 */

export type GuideStep = {
  key: string;
  title: string;
  description: string;
  /** Caminho a partir de /w/[org]. */
  path: string;
  done: boolean;
};

async function has(q: Promise<{ n: number }[]>) {
  const [row] = await q;
  return (row?.n ?? 0) > 0;
}

export async function guideSteps(s: Scope): Promise<GuideStep[]> {
  const a = s.actor;
  if (a.kind !== "internal") return [];
  const steps: GuideStep[] = [];
  const visibleClient = (col: AnyColumn) => and(eq(clients.id, col), isNull(clients.deletedAt), clientScope(a));

  if (can(a, "org.manage")) {
    const [org] = await s.db
      .select({ logoKey: organizations.logoKey, logoUrl: organizations.logoUrl })
      .from(organizations)
      .where(eq(organizations.id, a.orgId));
    steps.push({
      key: "logo",
      title: "Coloque a logo da agência",
      description: "Ela aparece no menu, nos e-mails e no portal dos clientes.",
      path: "/settings",
      done: Boolean(org?.logoKey || org?.logoUrl),
    });
  }

  if (can(a, "clients.write")) {
    steps.push({
      key: "client",
      title: "Cadastre o primeiro cliente",
      description: "Clientes organizam projetos, arquivos, marca e portal.",
      path: "/clients?novo=1",
      done: await has(
        s.db
          .select({ n: count() })
          .from(clients)
          .where(and(isNull(clients.deletedAt), clientScope(a))),
      ),
    });
  }

  if (can(a, "members.manage")) {
    const others = await has(
      s.db
        .select({ n: count() })
        .from(memberships)
        .innerJoin(roles, eq(roles.id, memberships.roleId))
        .where(and(eq(memberships.status, "active"), eq(roles.kind, "internal"), ne(memberships.userId, a.userId))),
    );
    const pending = await has(
      s.db
        .select({ n: count() })
        .from(invitations)
        .innerJoin(roles, eq(roles.id, invitations.roleId))
        .where(
          and(
            eq(roles.kind, "internal"),
            isNull(invitations.acceptedAt),
            isNull(invitations.revokedAt),
            gt(invitations.expiresAt, new Date()),
          ),
        ),
    );
    steps.push({
      key: "team",
      title: "Convide a equipe",
      description: "Cada pessoa entra com o próprio papel e vê só o que precisa.",
      path: "/team",
      done: others || pending,
    });
  }

  if (can(a, "projects.write")) {
    steps.push({
      key: "project",
      title: "Crie um projeto",
      description: "Projetos reúnem as demandas e as artes de um cliente.",
      path: "/projects?novo=1",
      done: await has(
        s.db
          .select({ n: count() })
          .from(projects)
          .where(and(isNull(projects.deletedAt), projectScope(a))),
      ),
    });
  }

  if (can(a, "tasks.write")) {
    steps.push({
      key: "demand",
      title: "Crie a primeira demanda",
      description: "Com prazo e responsável, ela aparece em Minhas demandas e no Calendário.",
      path: "/demandas",
      done: await has(s.db.select({ n: count() }).from(tasks).where(taskScope(a))),
    });
  }

  if (can(a, "designs.write")) {
    steps.push({
      key: "design",
      title: "Crie um carrossel no Estúdio",
      description: "Comece do zero, de um modelo pronto ou importe uma imagem.",
      path: "/studio",
      done: await has(s.db.select({ n: count() }).from(designs).where(designScope(s))),
    });
  }

  if (can(a, "ai.settings") && can(a, "ai.use")) {
    const states = await providerStates(s);
    steps.push({
      key: "ai",
      title: "Conecte um provedor de IA",
      description: "Com a sua chave, a Criação com IA gera textos e imagens de verdade.",
      path: "/settings/ai",
      done: states.some((p) => p.needsKey && p.ready),
    });
  }

  if (can(a, "clients.write")) {
    steps.push({
      key: "portal",
      title: "Publique o portal de um cliente",
      description: "O cliente acompanha demandas, aprova peças e baixa materiais.",
      path: "/clients",
      done: await has(
        s.db
          .select({ n: count() })
          .from(clientPortalSettings)
          .innerJoin(clients, visibleClient(clientPortalSettings.clientId))
          .where(isNotNull(clientPortalSettings.publishedAt)),
      ),
    });
  }

  if (can(a, "brand.manage")) {
    steps.push({
      key: "brand",
      title: "Analise o Instagram de um cliente",
      description: "O Radar de Marca mostra pontos fortes, falhas e sugestões de bio.",
      path: "/brand-radar",
      done: await has(
        s.db
          .select({ n: count() })
          .from(brandRadarProfiles)
          .innerJoin(clients, visibleClient(brandRadarProfiles.clientId)),
      ),
    });
  }

  return steps;
}
