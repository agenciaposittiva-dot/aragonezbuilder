import { Badge } from "@/components/ui/badge";
import { APPROVAL_STATUS_LABEL } from "@/lib/validators/approvals";

const TONE = {
  pending: "info",
  approved: "success",
  changes_requested: "warning",
  superseded: "outline",
  cancelled: "neutral",
} as const;

export function ApprovalStatusBadge({ status }: { status: keyof typeof TONE }) {
  return <Badge tone={TONE[status]}>{APPROVAL_STATUS_LABEL[status]}</Badge>;
}
