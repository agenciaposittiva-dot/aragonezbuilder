import { Badge } from "@/components/ui/badge";
import { CLIENT_STATUS_LABEL } from "@/lib/validators/clients";

const TONE = { lead: "info", active: "success", paused: "warning", inactive: "neutral" } as const;

export function ClientStatusBadge({ status }: { status: keyof typeof TONE }) {
  return <Badge tone={TONE[status]}>{CLIENT_STATUS_LABEL[status]}</Badge>;
}
