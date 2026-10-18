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
};

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
