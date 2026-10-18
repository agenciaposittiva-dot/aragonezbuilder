"use client";

import { LogOut, Palette, ShieldCheck, UserRound } from "lucide-react";
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
import { ThemeMenuItems } from "./theme-toggle";
import { useWorkspace } from "./workspace-context";

export function UserMenu({ accountHref }: { accountHref: string }) {
  const ws = useWorkspace();
  const router = useRouter();
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
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Palette /> Tema
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <ThemeMenuItems />
          </DropdownMenuSubContent>
        </DropdownMenuSub>
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
