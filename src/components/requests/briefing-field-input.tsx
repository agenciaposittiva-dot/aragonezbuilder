"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { BriefingField } from "@/server/db/schema";

/** Renderiza um campo de briefing configurável pelo seu tipo. */
export function BriefingFieldInput({
  field,
  value,
  onChange,
  error,
}: {
  field: BriefingField;
  value: unknown;
  onChange: (v: unknown) => void;
  error?: string;
}) {
  const id = `bf-${field.key}`;
  const common = { id, "aria-invalid": !!error || undefined, placeholder: field.placeholder };
  let control: React.ReactNode;
  switch (field.type) {
    case "textarea":
      control = (
        <Textarea {...common} rows={3} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />
      );
      break;
    case "number":
      control = (
        <Input
          {...common}
          type="number"
          inputMode="decimal"
          value={value === undefined || value === null ? "" : String(value)}
          onChange={(e) => onChange(e.target.value)}
        />
      );
      break;
    case "date":
      control = (
        <Input {...common} type="date" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />
      );
      break;
    case "url":
      control = (
        <Input
          {...common}
          type="url"
          placeholder={field.placeholder ?? "https://"}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
        />
      );
      break;
    case "select":
      control = (
        <NativeSelect {...common} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
          <option value="">Selecione…</option>
          {field.options?.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </NativeSelect>
      );
      break;
    case "multiselect": {
      const list = Array.isArray(value) ? (value as string[]) : [];
      control = (
        <div className="flex flex-wrap gap-2" role="group" aria-labelledby={`${id}-label`}>
          {field.options?.map((o) => {
            const on = list.includes(o);
            return (
              <button
                key={o}
                type="button"
                aria-pressed={on}
                onClick={() => onChange(on ? list.filter((x) => x !== o) : [...list, o])}
                className={cn(
                  "rounded-full border px-3 py-1 text-[13px] transition-colors",
                  on
                    ? "border-accent bg-accent-soft text-accent-soft-fg"
                    : "border-border bg-surface text-fg-muted hover:border-border-strong",
                )}
              >
                {o}
              </button>
            );
          })}
        </div>
      );
      break;
    }
    case "checkbox":
      return (
        <label className="flex items-start gap-2 text-sm">
          <Checkbox checked={value === true} onCheckedChange={(v) => onChange(v === true)} className="mt-0.5" />
          <span>
            {field.label}
            {field.help ? <span className="block text-xs text-fg-subtle">{field.help}</span> : null}
          </span>
        </label>
      );
    default:
      control = <Input {...common} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />;
  }
  return (
    <Field
      label={<span id={`${id}-label`}>{field.label}</span>}
      htmlFor={field.type === "multiselect" ? undefined : id}
      required={field.required}
      hint={field.help}
      error={error}
    >
      {control}
    </Field>
  );
}
