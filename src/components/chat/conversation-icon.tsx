import { FileText, Hash, ListPlus, Users } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

const BOX = {
  sm: { box: "size-6 rounded", icon: "size-3.5", avatar: "sm" },
  md: { box: "size-8 rounded-md", icon: "size-4", avatar: "md" },
  xl: { box: "size-24 rounded-xl", icon: "size-9", avatar: "xl" },
} as const;

/**
 * Imagem da conversa: foto da outra pessoa (diretas), foto do grupo/canal
 * quando houver, ou o ícone do tipo de conversa. Usada na lista, no
 * cabeçalho, na busca, nos detalhes e nos avisos.
 */
export function ConversationIcon({
  kind,
  name,
  image,
  size = "md",
  className,
}: {
  kind: string;
  name: string;
  image: string | null;
  size?: keyof typeof BOX;
  className?: string;
}) {
  const b = BOX[size];
  if (kind === "direct") {
    return (
      <Avatar name={name} src={image} size={b.avatar} className={cn(size === "xl" && "size-24 text-2xl", className)} />
    );
  }
  if (image) {
    return (
      <span className={cn("inline-flex shrink-0 overflow-hidden bg-surface-2 ring-1 ring-border", b.box, className)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image} alt="" className="size-full object-cover" data-testid="chat-conversation-photo" />
      </span>
    );
  }
  const Icon = kind === "project" ? FileText : kind === "task" ? ListPlus : kind === "channel" ? Hash : Users;
  return (
    <span
      className={cn("flex shrink-0 items-center justify-center bg-surface-2 text-fg-muted", b.box, className)}
      data-testid="chat-conversation-default-icon"
    >
      <Icon className={b.icon} />
    </span>
  );
}
