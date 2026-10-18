"use client";

import { MessagesSquare } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/components/shell/workspace-context";
import { useOrgAction } from "@/hooks/use-action";
import { openProjectConversationAction, openTaskConversationAction } from "@/server/actions/chat";

/** Abre (ou cria) a conversa do projeto/tarefa no Chat da Equipe. Some sem a permissão do chat. */
export function OpenChatButton({
  kind,
  id,
  label,
  variant = "secondary",
}: {
  kind: "project" | "task";
  id: string;
  label?: string;
  variant?: "secondary" | "primary";
}) {
  const router = useRouter();
  const { orgSlug, permissions } = useWorkspace();
  const go = (d: { id: string }) => router.push(`/w/${orgSlug}/chat/${d.id}`);
  const project = useOrgAction(openProjectConversationAction, { onSuccess: go });
  const task = useOrgAction(openTaskConversationAction, { onSuccess: go });
  if (!permissions.includes("chat.use")) return null;
  const pending = project.pending || task.pending;
  return (
    <Button
      variant={variant}
      size={label ? "sm" : "icon"}
      loading={pending}
      aria-label={label ? undefined : kind === "task" ? "Conversa da tarefa" : "Conversa do projeto"}
      title={kind === "task" ? "Conversa da tarefa no Chat da Equipe" : "Conversa do projeto no Chat da Equipe"}
      onClick={() => (kind === "project" ? project.run({ projectId: id }) : task.run({ taskId: id }))}
    >
      <MessagesSquare />
      {label}
    </Button>
  );
}
