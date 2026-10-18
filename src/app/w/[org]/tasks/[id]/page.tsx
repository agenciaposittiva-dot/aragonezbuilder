import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TaskDetail } from "@/components/tasks/detail/task-detail";
import { requireActor } from "@/server/auth/session";

export const metadata: Metadata = { title: "Tarefa" };

export default async function TaskDetailPage({ params }: PageProps<"/w/[org]/tasks/[id]">) {
  const { org, id } = await params;
  const actor = await requireActor(org, { kind: "internal", permission: "tasks.read" });
  const detail = await TaskDetail({ actor, id, variant: "page" });
  if (!detail) notFound();
  return detail;
}
