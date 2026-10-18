import type { CSSProperties } from "react";
import { luminance, readableOn, type PortalSettings } from "./portal-settings";

/**
 * Converte as cores da marca do cliente em variáveis do design system,
 * aplicadas só dentro do portal daquele cliente. Sem cores definidas, nada é
 * sobrescrito (vale o tema padrão da agência, claro ou escuro).
 * Os valores vêm de cores hexadecimais validadas: nenhum texto livre vira CSS.
 */
export function portalThemeStyle(s: PortalSettings): CSSProperties {
  const vars: Record<string, string> = {};
  const { primary, secondary, accent, background, text } = s.colors;

  if (background) {
    const dark = luminance(background) < 0.2;
    const fg = text ?? readableOn(background);
    vars["--bg"] = background;
    vars["--fg"] = fg;
    vars["--fg-muted"] = `color-mix(in oklab, ${fg} 68%, ${background})`;
    vars["--fg-subtle"] = `color-mix(in oklab, ${fg} 48%, ${background})`;
    vars["--surface"] = dark
      ? `color-mix(in oklab, ${background} 90%, ${fg})`
      : luminance(background) > 0.95
        ? `color-mix(in oklab, ${background} 97%, ${fg})`
        : "#ffffff";
    vars["--surface-2"] = `color-mix(in oklab, ${background} ${dark ? 84 : 94}%, ${fg})`;
    vars["--surface-3"] = `color-mix(in oklab, ${background} ${dark ? 78 : 89}%, ${fg})`;
    vars["--border"] = `color-mix(in oklab, ${background} ${dark ? 78 : 86}%, ${fg})`;
    vars["--border-strong"] = `color-mix(in oklab, ${background} ${dark ? 68 : 78}%, ${fg})`;
    vars.colorScheme = dark ? "dark" : "light";
  } else if (text) {
    vars["--fg"] = text;
  }

  if (primary) {
    vars["--accent"] = primary;
    vars["--accent-hover"] = `color-mix(in oklab, ${primary} 85%, var(--fg))`;
    vars["--accent-fg"] = readableOn(primary);
    vars["--accent-soft"] = `color-mix(in oklab, ${primary} 16%, var(--surface))`;
    vars["--accent-soft-fg"] = `color-mix(in oklab, ${primary} 55%, var(--fg))`;
    vars["--accent-text"] = `color-mix(in oklab, ${primary} 62%, var(--fg))`;
    vars["--ring"] = `color-mix(in oklab, ${primary} 60%, transparent)`;
  }
  vars["--portal-secondary"] = secondary ?? "var(--sidebar-bg)";
  vars["--portal-highlight"] = accent ?? primary ?? "var(--accent)";
  return vars as CSSProperties;
}
