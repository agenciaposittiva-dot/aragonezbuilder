import { PORTAL_NAV, WORKSPACE_NAV, type NavGroup } from "./nav-config";

export type NavKey = "workspace" | "portal";

/** A configuração de navegação vive no cliente (ícones são componentes). */
export function getNav(key: NavKey): NavGroup[] {
  return key === "portal" ? PORTAL_NAV : WORKSPACE_NAV;
}
