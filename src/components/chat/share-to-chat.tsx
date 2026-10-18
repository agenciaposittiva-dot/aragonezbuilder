"use client";

import { Share2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { NativeSelect, Textarea } from "@/components/ui/input";
import { useWorkspace } from "@/components/shell/workspace-context";
import { useOrgAction } from "@/hooks/use-action";
import { shareToConversationAction } from "@/server/actions/chat";

/** Compartilha um projeto/tarefa/arte/arquivo numa conversa (o link só abre para quem tem acesso ao item). */
export function ShareToChatButton({
  type,
  id,
  conversations,
}: {
  type: "projects" | "tasks" | "studio" | "files";
  id: string;
  conversations: { id: string; name: string; kind: string }[];
}) {
  const router = useRouter();
  const { orgSlug } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [conversationId, setConversationId] = useState("");
  const [note, setNote] = useState("");
  const share = useOrgAction(shareToConversationAction, {
    success: "Compartilhado no chat",
    onSuccess: () => {
      setOpen(false);
      router.push(`/w/${orgSlug}/chat/${conversationId}`);
    },
  });
  if (!conversations.length) return null;
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <Share2 /> Compartilhar numa conversa
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Compartilhar numa conversa</DialogTitle>
            <DialogDescription>Quem não tiver acesso ao item vê só o link, sem os detalhes.</DialogDescription>
          </DialogHeader>
          <DialogBody className="grid gap-3">
            <Field label="Conversa">
              <NativeSelect value={conversationId} onChange={(e) => setConversationId(e.target.value)}>
                <option value="">Escolha…</option>
                {conversations.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.kind === "channel" ? "#" : ""}
                    {c.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Mensagem (opcional)">
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={2000} />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button
              disabled={!conversationId}
              loading={share.pending}
              onClick={() => share.run({ conversationId, type, id, note: note.trim() || undefined })}
            >
              Compartilhar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
