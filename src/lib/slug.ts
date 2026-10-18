export function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

/** Slugs reservados para não colidir com rotas da aplicação. */
export const RESERVED_SLUGS = new Set([
  "api", "app", "admin", "login", "signup", "logout", "invite", "onboarding", "portal",
  "settings", "w", "static", "public", "assets", "_next", "auth", "reset-password", "forgot-password",
]);
