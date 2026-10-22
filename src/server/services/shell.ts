import { and, count, eq, inArray, isNull, lte } from "drizzle-orm";
import { todayISO } from "@/lib/format";
import { approvals, clients, files, requests, tasks } from "@/server/db/schema";
import { can, clientScope, taskScope, type Scope } from "@/server/authz";
import { unreadTotal } from "./chat";
import { unreadCount } from "./notifications";

/** Contadores exibidos na navegação. */
export async function getShellCounts(s: Scope) {
  const unread = await unreadCount(s);
  let pendingRequests = 0;
  let pendingApprovals = 0;

  if (s.actor.kind === "internal" && can(s.actor, "requests.triage")) {
    const [r] = await s.db
      .select({ n: count() })
      .from(requests)
      .where(inArray(requests.status, ["submitted", "triage"]));
    pendingRequests = r?.n ?? 0;
  }

  if (s.actor.kind === "internal" && can(s.actor, "approvals.decide_internal")) {
    const [r] = await s.db
      .select({ n: count() })
      .from(approvals)
      .where(and(eq(approvals.status, "pending"), eq(approvals.stage, "internal")));
    pendingApprovals = r?.n ?? 0;
  }

  if (s.actor.kind === "client" && can(s.actor, "approvals.decide_client") && s.actor.clientIds.length) {
    const [r] = await s.db
      .select({ n: count() })
      .from(approvals)
      .innerJoin(files, eq(files.id, approvals.fileId))
      .innerJoin(clients, eq(clients.id, files.clientId))
      .where(and(eq(approvals.status, "pending"), eq(approvals.stage, "client"), clientScope(s.actor)));
    pendingApprovals = r?.n ?? 0;
  }

  // Minhas demandas que pedem atenção agora: abertas, comigo, atrasadas ou para hoje.
  let demands = 0;
  if (s.actor.kind === "internal" && can(s.actor, "tasks.read")) {
    const [r] = await s.db
      .select({ n: count() })
      .from(tasks)
      .where(
        and(
          taskScope(s.actor),
          isNull(tasks.archivedAt),
          isNull(tasks.completedAt),
          eq(tasks.assigneeMembershipId, s.actor.membershipId),
          lte(tasks.dueDate, todayISO()),
        ),
      );
    demands = r?.n ?? 0;
  }

  const chat = await unreadTotal(s);

  return {
    unread,
    badges: { requests: pendingRequests, approvals: pendingApprovals, chat, demands },
  };
}
