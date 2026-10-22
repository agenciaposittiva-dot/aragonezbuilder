import { and, arrayContains, desc, eq, ilike, inArray, isNull, or } from "drizzle-orm";
import type { z } from "zod";
import {
  type ReferenceKind,
  referenceInput,
  referenceKindOf,
  referenceListParams,
  youtubeThumb,
} from "@/lib/validators/files";
import { clients, projects, referenceLinks, user } from "@/server/db/schema";
import {
  assertCan,
  assertClientAccess,
  assertInternal,
  assertProjectAccess,
  clientScope,
  type Scope,
} from "@/server/authz";
import { NotFoundError, ValidationError } from "@/server/errors";
import { recordActivity } from "./activity";

/*
 * Biblioteca de referências: links que a equipe salva para usar como
 * inspiração (YouTube, Pinterest, Instagram, TikTok, Behance ou qualquer
 * página). Só o endereço é guardado — o servidor não acessa o link (sem risco
 * de requisições a endereços internos). A origem vem do endereço; a miniatura
 * só existe para o YouTube (montada pelo id do vídeo).
 */

const ESC = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

function titleFrom(url: string) {
  try {
    const u = new URL(url);
    const path = decodeURIComponent(u.pathname).replace(/\/+$/, "").split("/").filter(Boolean).pop();
    return `${u.hostname.replace(/^www\./, "")}${path ? ` · ${path}` : ""}`.slice(0, 200);
  } catch {
    return url.slice(0, 200);
  }
}

export async function listReferences(s: Scope, raw: z.input<typeof referenceListParams> = {}) {
  assertInternal(s.actor);
  assertCan(s.actor, "files.read");
  const p = referenceListParams.parse(raw);
  const visibleClients = s.db.select({ id: clients.id }).from(clients).where(clientScope(s.actor));
  const rows = await s.db
    .select({
      id: referenceLinks.id,
      url: referenceLinks.url,
      title: referenceLinks.title,
      kind: referenceLinks.kind,
      note: referenceLinks.note,
      tags: referenceLinks.tags,
      clientId: referenceLinks.clientId,
      clientName: clients.name,
      projectId: referenceLinks.projectId,
      projectName: projects.name,
      createdAt: referenceLinks.createdAt,
      createdByName: user.name,
    })
    .from(referenceLinks)
    .leftJoin(clients, eq(clients.id, referenceLinks.clientId))
    .leftJoin(projects, eq(projects.id, referenceLinks.projectId))
    .leftJoin(user, eq(user.id, referenceLinks.createdByUserId))
    .where(
      and(
        // Referências de clientes que a pessoa não vê ficam de fora; as da agência são de todos.
        or(isNull(referenceLinks.clientId), inArray(referenceLinks.clientId, visibleClients)),
        p.clientId ? eq(referenceLinks.clientId, p.clientId) : undefined,
        p.kind ? eq(referenceLinks.kind, p.kind) : undefined,
        p.q
          ? or(
              ilike(referenceLinks.title, ESC(p.q)),
              ilike(referenceLinks.note, ESC(p.q)),
              arrayContains(referenceLinks.tags, [p.q.toLowerCase()]),
            )
          : undefined,
      ),
    )
    .orderBy(desc(referenceLinks.createdAt))
    .limit(200);
  return rows.map((r) => ({
    ...r,
    kind: r.kind as ReferenceKind,
    thumbnail: r.kind === "youtube" ? youtubeThumb(r.url) : null,
  }));
}

export type ReferenceRow = Awaited<ReturnType<typeof listReferences>>[number];

export async function saveReference(s: Scope, raw: z.input<typeof referenceInput>) {
  assertInternal(s.actor);
  assertCan(s.actor, "files.write");
  const data = referenceInput.parse(raw);
  let clientId = data.clientId || null;
  const projectId = data.projectId || null;
  if (projectId) {
    const p = await assertProjectAccess(s, projectId);
    if (clientId && clientId !== p.clientId) throw new ValidationError("O projeto não pertence ao cliente escolhido.");
    clientId = p.clientId;
  }
  if (clientId) await assertClientAccess(s, clientId);
  const values = {
    url: data.url,
    title: data.title?.trim() || titleFrom(data.url),
    kind: referenceKindOf(data.url),
    note: data.note?.trim() || null,
    clientId,
    projectId,
    tags: [...new Set(data.tags.map((t) => t.toLowerCase()))],
  };
  if (data.id) {
    const res = await s.db
      .update(referenceLinks)
      .set(values)
      .where(eq(referenceLinks.id, data.id))
      .returning({ id: referenceLinks.id });
    if (!res.length) throw new NotFoundError("Referência não encontrada.");
    return { id: data.id };
  }
  const [row] = await s.db
    .insert(referenceLinks)
    .values({ organizationId: s.actor.orgId, ...values, createdByUserId: s.actor.userId })
    .returning({ id: referenceLinks.id });
  await recordActivity(s, {
    action: "reference_added",
    entityType: clientId ? "client" : "organization",
    entityId: clientId ?? s.actor.orgId,
    summary: `Referência salva: ${values.title}`,
    event: false,
  });
  return { id: row!.id };
}

export async function deleteReference(s: Scope, id: string) {
  assertInternal(s.actor);
  assertCan(s.actor, "files.write");
  const [row] = await s.db
    .select({ id: referenceLinks.id, clientId: referenceLinks.clientId, title: referenceLinks.title })
    .from(referenceLinks)
    .where(eq(referenceLinks.id, id));
  if (!row) throw new NotFoundError("Referência não encontrada.");
  if (row.clientId) await assertClientAccess(s, row.clientId);
  await s.db.delete(referenceLinks).where(eq(referenceLinks.id, id));
  return { title: row.title };
}
