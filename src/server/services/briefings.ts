import { and, asc, eq } from "drizzle-orm";
import type { z } from "zod";
import { briefingTemplateInput } from "@/lib/validators/briefings";
import { briefingTemplates, requests, type BriefingField } from "@/server/db/schema";
import { assertCan, assertInternal, type Scope } from "@/server/authz";
import { NotFoundError, ValidationError } from "@/server/errors";
import { recordActivity } from "./activity";

export async function listTemplates(s: Scope, opts: { activeOnly?: boolean } = {}) {
  return s.db
    .select()
    .from(briefingTemplates)
    .where(opts.activeOnly ? eq(briefingTemplates.isActive, true) : undefined)
    .orderBy(asc(briefingTemplates.name));
}

export async function getTemplate(s: Scope, id: string) {
  const [row] = await s.db.select().from(briefingTemplates).where(eq(briefingTemplates.id, id));
  if (!row) throw new NotFoundError("Modelo de briefing não encontrado.");
  return row;
}

export async function saveTemplate(s: Scope, raw: z.input<typeof briefingTemplateInput>) {
  assertInternal(s.actor);
  assertCan(s.actor, "briefings.manage");
  const data = briefingTemplateInput.parse(raw);
  const fields: BriefingField[] = data.fields.map((f) => ({
    key: f.key,
    label: f.label,
    type: f.type,
    required: f.required || undefined,
    help: f.help || undefined,
    placeholder: f.placeholder || undefined,
    options: ["select", "multiselect"].includes(f.type) ? f.options : undefined,
  }));
  const values = {
    name: data.name,
    category: data.category,
    description: data.description,
    isActive: data.isActive,
    fields,
  };
  let id = data.id;
  if (id) {
    const res = await s.db
      .update(briefingTemplates)
      .set(values)
      .where(eq(briefingTemplates.id, id))
      .returning({ id: briefingTemplates.id });
    if (!res.length) throw new NotFoundError("Modelo de briefing não encontrado.");
  } else {
    const [row] = await s.db
      .insert(briefingTemplates)
      .values({ ...values, organizationId: s.actor.orgId })
      .returning({ id: briefingTemplates.id });
    id = row!.id;
  }
  await recordActivity(s, {
    action: data.id ? "updated" : "created",
    entityType: "briefing_template",
    entityId: id,
    summary: `Modelo de briefing ${data.id ? "atualizado" : "criado"}: ${data.name}`,
    event: false,
  });
  return { id };
}

export async function deleteTemplate(s: Scope, id: string) {
  assertInternal(s.actor);
  assertCan(s.actor, "briefings.manage");
  const [used] = await s.db.select({ id: requests.id }).from(requests).where(eq(requests.templateId, id)).limit(1);
  if (used) {
    // Preserva o histórico das solicitações: apenas desativa.
    await s.db.update(briefingTemplates).set({ isActive: false }).where(eq(briefingTemplates.id, id));
    return { deactivated: true };
  }
  const res = await s.db
    .delete(briefingTemplates)
    .where(and(eq(briefingTemplates.id, id)))
    .returning({ name: briefingTemplates.name });
  if (!res.length) throw new NotFoundError("Modelo de briefing não encontrado.");
  await recordActivity(s, {
    action: "deleted",
    entityType: "briefing_template",
    entityId: id,
    summary: `Modelo de briefing excluído: ${res[0]!.name}`,
    event: false,
  });
  return { deactivated: false };
}

function isEmpty(v: unknown) {
  return v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0) || v === false;
}

/**
 * Valida e normaliza as respostas do briefing conforme os campos do modelo.
 * Campos desconhecidos são descartados.
 */
export function validateBriefing(fields: BriefingField[], answers: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  const errors: Record<string, string[]> = {};
  for (const f of fields) {
    const raw = answers[f.key];
    if (f.required && f.type !== "checkbox" && isEmpty(raw)) {
      errors[`briefing.${f.key}`] = [`Preencha "${f.label}"`];
      continue;
    }
    if (isEmpty(raw)) {
      if (f.type === "checkbox") out[f.key] = false;
      continue;
    }
    switch (f.type) {
      case "number": {
        const n = typeof raw === "number" ? raw : Number(String(raw).replace(",", "."));
        if (!Number.isFinite(n)) errors[`briefing.${f.key}`] = ["Número inválido"];
        else out[f.key] = n;
        break;
      }
      case "date":
        if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw))
          errors[`briefing.${f.key}`] = ["Data inválida"];
        else out[f.key] = raw;
        break;
      case "url":
        try {
          const u = new URL(String(raw));
          if (!["http:", "https:"].includes(u.protocol)) throw new Error();
          out[f.key] = u.toString();
        } catch {
          errors[`briefing.${f.key}`] = ["Link inválido (use http:// ou https://)"];
        }
        break;
      case "select":
        if (!f.options?.includes(String(raw))) errors[`briefing.${f.key}`] = ["Opção inválida"];
        else out[f.key] = String(raw);
        break;
      case "multiselect": {
        const list = Array.isArray(raw) ? raw.map(String) : [String(raw)];
        if (list.some((v) => !f.options?.includes(v))) errors[`briefing.${f.key}`] = ["Opção inválida"];
        else out[f.key] = list;
        break;
      }
      case "checkbox":
        out[f.key] = raw === true || raw === "true" || raw === "on";
        break;
      default:
        out[f.key] = String(raw).slice(0, f.type === "textarea" ? 10000 : 1000);
    }
  }
  if (Object.keys(errors).length) throw new ValidationError("Revise o briefing.", errors);
  return out;
}
