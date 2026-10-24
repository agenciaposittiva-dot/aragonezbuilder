"use client";

import { Cloud, Compass, LogOut, Palette, ShieldCheck, Sparkles, UserRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Avatar } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { authClient } from "@/lib/auth-client";
import { useGuideHidden } from "./guide-panel";
import { ThemeMenuItems } from "./theme-toggle";
import { useWorkspace } from "./workspace-context";

/** `guide`: oferece mostrar de novo o botão "Me guie" escondido (só na área da equipe). */
export function UserMenu({ accountHref, guide = false }: { accountHref: string; guide?: boolean }) {
  const ws = useWorkspace();
  const router = useRouter();
  const [guideHidden, setGuideHidden] = useGuideHidden();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="rounded-full" aria-label="Menu do perfil">
        <Avatar name={ws.userName} src={ws.userImage} size="sm" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="flex items-center gap-2.5 font-normal">
          <Avatar name={ws.userName} src={ws.userImage} size="lg" />
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-fg">{ws.userName}</span>
            <span className="block truncate text-xs text-fg-muted">{ws.userEmail}</span>
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href={accountHref}>
            <UserRound /> Meu perfil
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={`${accountHref}#seguranca`}>
            <ShieldCheck /> Segurança e sessões
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={`${accountHref}/ai`}>
            <Sparkles /> Minhas inteligências artificiais
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={`${accountHref}/integrations`}>
            <Cloud /> Armazenamento e integrações
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Palette /> Tema
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <ThemeMenuItems />
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        {guide && guideHidden ? (
          <DropdownMenuItem onSelect={() => setGuideHidden(false)}>
            <Compass /> Mostrar o botão “Me guie”
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={async () => {
            await authClient.signOut();
            router.replace("/login");
            router.refresh();
          }}
        >
          <LogOut /> Sair
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
