import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { SYSTEM_ROLES } from "@/lib/permissions";
import { orgSettingsSchema, parseOrgSettings, type OrgSettings } from "@/lib/org-settings";
import { RESERVED_SLUGS, slugify } from "@/lib/slug";
import { generalSettingsInput } from "@/lib/validators/settings";
import { withOrg, withSystem, type Tx } from "@/server/db";
import { env } from "@/server/env";
import {
  auditLogs,
  briefingTemplates,
  clientCategories,
  memberships,
  organizations,
  roles,
  workflowStatuses,
  workflowTransitions,
} from "@/server/db/schema";
import { assertCan, type Scope } from "@/server/authz";
import { ValidationError } from "@/server/errors";
import { recordActivity } from "./activity";
import {
  DEFAULT_BRIEFING_TEMPLATES,
  DEFAULT_CLIENT_CATEGORIES,
  DEFAULT_PROJECT_STATUSES,
  DEFAULT_PROJECT_TRANSITIONS,
  DEFAULT_TASK_STATUSES,
} from "./defaults";

export const createOrganizationInput = z.object({
  name: z.string().trim().min(2, "Informe o nome da agência").max(80),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Use letras minúsculas, números e hífens")
    .min(3)
    .max(48)
    .optional(),
});

async function uniqueSlug(base: string): Promise<string> {
  const root = slugify(base) || "agencia";
  return withSystem(async (tx) => {
    for (let i = 0; i < 50; i++) {
      const candidate = i === 0 ? root : `${root}-${i + 1}`;
      if (RESERVED_SLUGS.has(candidate)) continue;
      const taken = await tx
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.slug, candidate))
        .limit(1);
      if (!taken.length) return candidate;
    }
    return `${root}-${randomUUID().slice(0, 6)}`;
  });
}

/** Cria a organização com papéis, status, modelos de briefing e o proprietário. */
export async function createOrganization(userId: string, input: z.infer<typeof createOrganizationInput>) {
  const data = createOrganizationInput.parse(input);
  if (data.slug && RESERVED_SLUGS.has(data.slug)) {
    throw new ValidationError("Este endereço é reservado.", {
      slug: ["Escolha outro endereço"],
    });
  }
  const slug = data.slug ?? (await uniqueSlug(data.name));
  if (data.slug && (await slugTaken(slug))) {
    throw new ValidationError("Este endereço já está em uso.", {
      slug: ["Escolha outro endereço"],
    });
  }
  const orgId = randomUUID();

  return withOrg(orgId, async (tx) => {
    // Novas organizações começam com o provedor de IA que tem chave no servidor.
    const settings = orgSettingsSchema.parse({ ai: { provider: env.AI_DEFAULT_PROVIDER } });
    await tx.insert(organizations).values({ id: orgId, name: data.name, slug, settings });
    const roleRows = await tx
      .insert(roles)
      .values(
        SYSTEM_ROLES.map((r) => ({
          organizationId: orgId,
          key: r.key,
          name: r.name,
          description: r.description,
          kind: r.kind,
          permissions: r.permissions,
          isSystem: true,
        })),
      )
      .returning({ id: roles.id, key: roles.key });
    const ownerRole = roleRows.find((r) => r.key === "owner")!;

    const [membership] = await tx
      .insert(memberships)
      .values({ organizationId: orgId, userId, roleId: ownerRole.id })
      .returning();

    await seedWorkflow(tx, orgId);
    await tx.insert(briefingTemplates).values(
      DEFAULT_BRIEFING_TEMPLATES.map((t) => ({
        organizationId: orgId,
        ...t,
      })),
    );
    await tx
      .insert(clientCategories)
      .values(DEFAULT_CLIENT_CATEGORIES.map((c, position) => ({ organizationId: orgId, ...c, position })));
    await tx.insert(auditLogs).values({
      organizationId: orgId,
      actorUserId: userId,
      action: "created",
      entityType: "organization",
      entityId: orgId,
      summary: `Organização ${data.name} criada`,
    });

    return { id: orgId, slug, membershipId: membership!.id };
  });
}

/** O slug é global: a verificação acontece fora do escopo de uma organização. */
async function slugTaken(slug: string) {
  const rows = await withSystem((tx) =>
    tx.select({ id: organizations.id }).from(organizations).where(eq(organizations.slug, slug)).limit(1),
  );
  return rows.length > 0;
}

async function seedWorkflow(tx: Tx, orgId: string) {
  const rows = [
    ...DEFAULT_TASK_STATUSES.map((s, i) => ({
      ...s,
      entity: "task" as const,
      position: i,
    })),
    ...DEFAULT_PROJECT_STATUSES.map((s, i) => ({
      ...s,
      entity: "project" as const,
      position: i,
    })),
  ].map((s) => ({
    organizationId: orgId,
    entity: s.entity,
    key: s.key,
    name: s.name,
    category: s.category,
    color: s.color,
    position: s.position,
    isDefault: s.isDefault ?? false,
  }));
  const inserted = await tx.insert(workflowStatuses).values(rows).returning({
    id: workflowStatuses.id,
    key: workflowStatuses.key,
    entity: workflowStatuses.entity,
  });
  const projectIds = new Map(inserted.filter((s) => s.entity === "project").map((s) => [s.key, s.id]));
  await tx.insert(workflowTransitions).values(
    DEFAULT_PROJECT_TRANSITIONS.map(([from, to]) => ({
      organizationId: orgId,
      fromStatusId: projectIds.get(from)!,
      toStatusId: projectIds.get(to)!,
    })),
  );
}

export async function updateOrganization(s: Scope, input: z.input<typeof generalSettingsInput>) {
  assertCan(s.actor, "org.manage");
  const data = generalSettingsInput.parse(input);
  await s.db
    .update(organizations)
    .set({ name: data.name, logoUrl: data.logoUrl ?? null })
    .where(eq(organizations.id, s.actor.orgId));
  await recordActivity(s, {
    action: "updated",
    entityType: "organization",
    entityId: s.actor.orgId,
    summary: "Dados da organização atualizados",
    event: false,
  });
}

export async function getSettings(s: Scope): Promise<OrgSettings> {
  const [org] = await s.db
    .select({ settings: organizations.settings })
    .from(organizations)
    .where(eq(organizations.id, s.actor.orgId));
  return parseOrgSettings(org?.settings);
}

/** Atualiza uma seção das configurações (validação completa pelo schema). */
export async function updateSettings<K extends keyof OrgSettings>(s: Scope, section: K, value: unknown) {
  const needed = section === "ai" ? "ai.settings" : "org.manage";
  assertCan(s.actor, needed);
  const current = await getSettings(s);
  const next = orgSettingsSchema.parse({ ...current, [section]: value });
  await s.db.update(organizations).set({ settings: next }).where(eq(organizations.id, s.actor.orgId));
  await recordActivity(s, {
    action: "settings_updated",
    entityType: "organization",
    entityId: s.actor.orgId,
    summary: `Configurações atualizadas: ${String(section)}`,
    metadata: { section },
    event: false,
  });
  return next;
}

export async function listRoles(s: Scope) {
  return s.db.select().from(roles).orderBy(roles.kind, roles.name);
}

export async function getRolesByIds(s: Scope, ids: string[]) {
  if (!ids.length) return [];
  return s.db.select().from(roles).where(inArray(roles.id, ids));
}
