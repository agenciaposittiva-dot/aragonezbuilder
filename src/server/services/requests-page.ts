import { requestListParams, REQUEST_STATUSES } from "@/lib/validators/requests";
import { BRIEFING_CATEGORIES } from "@/lib/validators/briefings";

type SP = Record<string, string | string[] | undefined>;

export function parseRequestFilters(sp: SP, fixed: { clientId?: string } = {}) {
  const pick = (k: string) => (typeof sp[k] === "string" && sp[k] ? (sp[k] as string) : undefined);
  const status = pick("status");
  const category = pick("category");
  const parsed = requestListParams.safeParse({
    q: pick("q"),
    status: REQUEST_STATUSES.includes(status as never) ? status : undefined,
    open: pick("open") === "1" || undefined,
    clientId: fixed.clientId ?? pick("clientId"),
    category: BRIEFING_CATEGORIES.includes(category as never) ? category : undefined,
    assigneeId: pick("assigneeId"),
    page: pick("page") ?? 1,
  });
  return parsed.success ? parsed.data : requestListParams.parse({ ...fixed });
}
