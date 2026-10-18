import { CalendarDays, KanbanSquare, List } from "lucide-react";
import { SegmentedNav } from "@/components/ui/segmented-nav";

type Params = Record<string, string | string[] | undefined>;

function hrefWith(basePath: string, searchParams: Params, updates: Record<string, string | null>) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) if (typeof v === "string" && k !== "page") qs.set(k, v);
  for (const [k, v] of Object.entries(updates)) {
    if (v === null) qs.delete(k);
    else qs.set(k, v);
  }
  const s = qs.toString();
  return s ? `${basePath}?${s}` : basePath;
}

export function TasksViewSwitcher({
  basePath,
  searchParams,
  defaultView = "list",
}: {
  basePath: string;
  searchParams: Params;
  defaultView?: "list" | "board";
}) {
  const list = {
    label: "Lista",
    value: "list",
    icon: <List />,
    href: hrefWith(basePath, searchParams, { view: defaultView === "list" ? null : "list", month: null }),
  };
  const board = {
    label: "Quadro",
    value: "board",
    icon: <KanbanSquare />,
    href: hrefWith(basePath, searchParams, { view: defaultView === "board" ? null : "board", month: null }),
  };
  const calendar = {
    label: "Calendário",
    value: "calendar",
    icon: <CalendarDays />,
    href: hrefWith(basePath, searchParams, { view: "calendar" }),
  };
  // O primeiro item é o ativo quando não há ?view= na URL.
  return (
    <SegmentedNav param="view" items={defaultView === "board" ? [board, list, calendar] : [list, board, calendar]} />
  );
}

/** Atalho "Todas" / "Minhas tarefas". */
export function MineToggle({ basePath, searchParams }: { basePath: string; searchParams: Params }) {
  return (
    <SegmentedNav
      param="assignee"
      items={[
        { label: "Todas", value: "", href: hrefWith(basePath, searchParams, { assignee: null }) },
        { label: "Minhas tarefas", value: "me", href: hrefWith(basePath, searchParams, { assignee: "me" }) },
      ]}
    />
  );
}
