import { and, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { clients, files, projects, requests, tasks } from "@/server/db/schema";
import { can, clientScope, fileScope, projectScope, taskScope, type Scope } from "@/server/authz";

export type SearchHit = {
  type: "client" | "project" | "task" | "file" | "request";
  id: string;
  title: string;
  subtitle?: string | null;
  href: string;
};

function escapeLike(q: string) {
  return q.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Busca global respeitando permissões e escopo de dados do ator. */
export async function globalSearch(s: Scope, rawQuery: string): Promise<SearchHit[]> {
  const q = rawQuery.trim();
  if (q.length < 2) return [];
  const like = `%${escapeLike(q)}%`;
  const base = s.actor.kind === "client" ? `/portal/${s.actor.orgSlug}/ir` : `/w/${s.actor.orgSlug}`;
  const hits: SearchHit[] = [];
  const internal = s.actor.kind === "internal";

  if (can(s.actor, "clients.read") && internal) {
    const rows = await s.db
      .select({
        id: clients.id,
        name: clients.name,
        industry: clients.industry,
      })
      .from(clients)
      .where(and(isNull(clients.archivedAt), ilike(clients.name, like), clientScope(s.actor)))
      .orderBy(clients.name)
      .limit(5);
    hits.push(
      ...rows.map((r) => ({
        type: "client" as const,
        id: r.id,
        title: r.name,
        subtitle: r.industry,
        href: `${base}/clients/${r.id}`,
      })),
    );
  }

  if (can(s.actor, "projects.read")) {
    const rows = await s.db
      .select({ id: projects.id, name: projects.name, client: clients.name })
      .from(projects)
      .innerJoin(clients, eq(clients.id, projects.clientId))
      .where(and(isNull(projects.archivedAt), ilike(projects.name, like), projectScope(s.actor)))
      .orderBy(desc(projects.updatedAt))
      .limit(5);
    hits.push(
      ...rows.map((r) => ({
        type: "project" as const,
        id: r.id,
        title: r.name,
        subtitle: r.client,
        href: `${base}/projects/${r.id}`,
      })),
    );
  }

  if (can(s.actor, "tasks.read") && internal) {
    const rows = await s.db
      .select({ id: tasks.id, title: tasks.title, project: projects.name })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(and(isNull(tasks.archivedAt), ilike(tasks.title, like), taskScope(s.actor)))
      .orderBy(desc(tasks.updatedAt))
      .limit(6);
    hits.push(
      ...rows.map((r) => ({
        type: "task" as const,
        id: r.id,
        title: r.title,
        subtitle: r.project,
        href: `${base}/tasks/${r.id}`,
      })),
    );
  }

  if (can(s.actor, "requests.read")) {
    const asNumber = Number(q.replace(/^#/, ""));
    const rows = await s.db
      .select({
        id: requests.id,
        title: requests.title,
        number: requests.number,
        client: clients.name,
      })
      .from(requests)
      .innerJoin(clients, eq(clients.id, requests.clientId))
      .where(
        and(
          or(
            ilike(requests.title, like),
            Number.isInteger(asNumber) && asNumber > 0 ? eq(requests.number, asNumber) : sql`false`,
          ),
          clientScope(s.actor),
        ),
      )
      .orderBy(desc(requests.createdAt))
      .limit(5);
    hits.push(
      ...rows.map((r) => ({
        type: "request" as const,
        id: r.id,
        title: `#${r.number} · ${r.title}`,
        subtitle: r.client,
        href: `${base}/requests/${r.id}`,
      })),
    );
  }

  if (can(s.actor, "files.read")) {
    const rows = await s.db
      .select({ id: files.id, name: files.name, client: clients.name })
      .from(files)
      .leftJoin(clients, eq(clients.id, files.clientId))
      .where(and(or(ilike(files.name, like), sql`${q.toLowerCase()} = any(${files.tags})`), fileScope(s.actor)))
      .orderBy(desc(files.updatedAt))
      .limit(5);
    hits.push(
      ...rows.map((r) => ({
        type: "file" as const,
        id: r.id,
        title: r.name,
        subtitle: r.client,
        href: `${base}/files/${r.id}`,
      })),
    );
  }

  return hits;
}
