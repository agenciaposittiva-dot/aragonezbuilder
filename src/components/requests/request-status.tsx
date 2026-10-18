import { Badge } from "@/components/ui/badge";
import { REQUEST_STATUS_LABEL, type RequestStatus } from "@/lib/validators/requests";

const TONE: Record<RequestStatus, "neutral" | "info" | "warning" | "success" | "danger" | "accent" | "outline"> = {
  draft: "outline",
  submitted: "info",
  triage: "warning",
  in_progress: "accent",
  delivered: "success",
  rejected: "danger",
  cancelled: "neutral",
};

export function RequestStatusBadge({ status }: { status: RequestStatus }) {
  return <Badge tone={TONE[status]}>{REQUEST_STATUS_LABEL[status]}</Badge>;
}
