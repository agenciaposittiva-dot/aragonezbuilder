import { EVENT_CATALOG, type EventType } from "@/lib/events";
import { ACTION_LABEL, CONDITION_OP_LABEL } from "@/lib/validators/automations";
import type { AutomationAction, AutomationCondition } from "@/server/db/schema";

export function triggerLabel(trigger: string) {
  return EVENT_CATALOG[trigger as EventType]?.label ?? trigger;
}

export function describeConditions(trigger: string, conditions: AutomationCondition[]) {
  if (!conditions.length) return "Sempre";
  const fields = EVENT_CATALOG[trigger as EventType]?.fields ?? [];
  return conditions
    .map((c) => {
      const f = fields.find((x) => x.key === c.field);
      const options =
        f && "options" in f ? (f.options as readonly { value: string; label: string }[] | undefined) : undefined;
      const show = (v: unknown) =>
        options?.find((o) => o.value === String(v))?.label ?? (f?.type === "uuid" ? "(selecionado)" : String(v));
      const value = c.op === "exists" ? "" : Array.isArray(c.value) ? c.value.map(show).join(", ") : show(c.value);
      return `${f?.label ?? c.field} ${CONDITION_OP_LABEL[c.op]}${value ? ` ${value}` : ""}`;
    })
    .join(" e ");
}

export function describeActions(actions: AutomationAction[]) {
  return actions.map((a) => ACTION_LABEL[a.type]).join(" → ");
}
