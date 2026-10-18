"use client";

import { createContext, use } from "react";
import type { Permission, RoleKind } from "@/lib/permissions";

/** Dados do ator que a interface precisa (sem nada sensível). */
export type WorkspaceInfo = {
  orgSlug: string;
  orgName: string;
  orgLogoUrl: string | null;
  userId: string;
  userName: string;
  userEmail: string;
  userImage: string | null;
  membershipId: string;
  roleName: string;
  kind: RoleKind;
  permissions: Permission[];
  /** Na área do cliente: endereço base do portal do cliente atual (ex.: /portal/agencia/cliente). */
  portalBase?: string;
  /** Na área do cliente: cliente cujo portal está aberto. */
  portalClient?: { id: string; slug: string; name: string };
};

/** Base dos links de páginas compartilhadas (portal do cliente ou área interna). */
export function workspaceBase(ws: WorkspaceInfo) {
  return ws.kind === "client" ? (ws.portalBase ?? `/portal/${ws.orgSlug}/ir`) : `/w/${ws.orgSlug}`;
}

const Ctx = createContext<WorkspaceInfo | null>(null);

export function WorkspaceProvider({ value, children }: { value: WorkspaceInfo; children: React.ReactNode }) {
  return <Ctx value={value}>{children}</Ctx>;
}

export function useWorkspace() {
  const v = use(Ctx);
  if (!v) throw new Error("useWorkspace fora do WorkspaceProvider");
  return v;
}

export function useCan() {
  const { permissions } = useWorkspace();
  return (p: Permission) => permissions.includes(p);
}
