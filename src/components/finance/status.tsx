import { Badge } from "@/components/ui/badge";
import {
  EXPENSE_STATUS_LABEL,
  INVOICE_STATUS_LABEL,
  type ExpenseStatus,
  type InvoiceStatus,
} from "@/lib/validators/finance";

const INVOICE_TONE = {
  draft: "outline",
  open: "info",
  paid: "success",
  overdue: "danger",
  cancelled: "neutral",
} as const;
const EXPENSE_TONE = { pending: "warning", paid: "success", cancelled: "neutral" } as const;

export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  return <Badge tone={INVOICE_TONE[status]}>{INVOICE_STATUS_LABEL[status]}</Badge>;
}

export function ExpenseStatusBadge({ status }: { status: ExpenseStatus }) {
  return <Badge tone={EXPENSE_TONE[status]}>{EXPENSE_STATUS_LABEL[status]}</Badge>;
}
