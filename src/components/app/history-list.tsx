import { History } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDateTime } from "@/lib/format";

type Entry = {
  id: string;
  summary: string | null;
  action: string;
  changes: Record<string, { from: unknown; to: unknown }> | null;
  createdAt: Date;
  actorName: string | null;
  actorImage: string | null;
};

const FIELD_LABEL: Record<string, string> = {
  name: "Nome",
  status: "Status",
  priority: "Prioridade",
  dueDate: "Prazo",
  startDate: "Início",
  ownerMembershipId: "Responsável",
  assigneeMembershipId: "Responsável",
  description: "Descrição",
  objective: "Objetivo",
  budgetCents: "Orçamento",
  title: "Título",
  email: "E-mail",
  phone: "Telefone",
  industry: "Segmento",
};

function show(v: unknown) {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "string" && v.length > 60) return v.slice(0, 57) + "…";
  if (typeof v === "string" && /^[0-9a-f-]{36}$/.test(v)) return "(alterado)";
  return String(v);
}

/** Linha do tempo de auditoria (quem fez o quê e quando). */
export function HistoryList({ entries }: { entries: Entry[] }) {
  if (!entries.length) {
    return (
      <EmptyState
        compact
        icon={History}
        title="Sem histórico ainda"
        description="As alterações relevantes aparecem aqui."
      />
    );
  }
  return (
    <ol className="relative grid gap-0">
      {entries.map((e, i) => (
        <li key={e.id} className="relative flex gap-3 pb-5 last:pb-0">
          {i < entries.length - 1 ? (
            <span className="absolute top-7 bottom-0 left-3 w-px bg-border" aria-hidden="true" />
          ) : null}
          <Avatar
            name={e.actorName ?? "Sistema"}
            src={e.actorImage}
            size="sm"
            className="relative z-10 ring-4 ring-surface"
          />
          <div className="min-w-0 flex-1 pt-0.5">
            <p className="text-sm text-fg">
              <span className="font-medium">{e.actorName ?? "Sistema"}</span>{" "}
              <span className="text-fg-muted">{e.summary ?? e.action}</span>
            </p>
            {e.changes ? (
              <ul className="mt-1 grid gap-0.5 text-xs text-fg-muted">
                {Object.entries(e.changes)
                  .slice(0, 6)
                  .map(([k, c]) => (
                    <li key={k}>
                      <span className="text-fg-subtle">{FIELD_LABEL[k] ?? k}:</span> {show(c.from)} →{" "}
                      <span className="text-fg">{show(c.to)}</span>
                    </li>
                  ))}
              </ul>
            ) : null}
            <p className="mt-0.5 text-[11px] text-fg-subtle">{formatDateTime(e.createdAt)}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
