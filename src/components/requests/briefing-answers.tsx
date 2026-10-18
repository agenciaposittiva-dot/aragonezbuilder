import { formatDate } from "@/lib/format";
import type { BriefingField } from "@/server/db/schema";

function show(field: BriefingField, value: unknown) {
  if (value === undefined || value === null || value === "") return <span className="text-fg-subtle">—</span>;
  switch (field.type) {
    case "checkbox":
      return value ? "Sim" : "Não";
    case "date":
      return formatDate(String(value));
    case "multiselect":
      return Array.isArray(value) ? value.join(", ") : String(value);
    case "url":
      return (
        <a
          href={String(value)}
          target="_blank"
          rel="noreferrer noopener"
          className="break-all text-accent-text hover:underline"
        >
          {String(value)}
        </a>
      );
    default:
      return <span className="whitespace-pre-wrap">{String(value)}</span>;
  }
}

/** Respostas do briefing na ordem do modelo. */
export function BriefingAnswers({ fields, answers }: { fields: BriefingField[]; answers: Record<string, unknown> }) {
  if (!fields.length) return null;
  return (
    <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
      {fields.map((f) => (
        <div key={f.key} className={f.type === "textarea" ? "sm:col-span-2" : ""}>
          <dt className="text-xs text-fg-subtle">{f.label}</dt>
          <dd className="mt-0.5 text-fg">{show(f, answers[f.key])}</dd>
        </div>
      ))}
    </dl>
  );
}
