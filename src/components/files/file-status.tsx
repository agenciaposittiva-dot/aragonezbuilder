import { Badge } from "@/components/ui/badge";
import { FILE_STATUS_LABEL, type FileStatus } from "@/lib/validators/files";

const TONE: Record<FileStatus, "neutral" | "info" | "warning" | "success" | "accent" | "outline"> = {
  draft: "neutral",
  in_review: "info",
  changes_requested: "warning",
  approved: "success",
  final: "accent",
  archived: "outline",
};

export function FileStatusBadge({ status }: { status: FileStatus }) {
  return <Badge tone={TONE[status]}>{FILE_STATUS_LABEL[status]}</Badge>;
}
