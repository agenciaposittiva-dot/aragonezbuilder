import { APP_NAME } from "@/lib/constants";
import { cn } from "@/lib/utils";

/** Marca da plataforma: asa com flecha (vetor fiel ao logotipo oficial). */
export function LogoGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="60 66 138 122" className={cn("size-5", className)} aria-hidden="true" fill="currentColor">
      <path d="M68 74 H148 A42 42 0 0 1 190 116 V150 L183.5 164 L177 150 V116 A29 29 0 0 0 148 87 H78 Z" />
      <path d="M78 98 H162 L149 111 H88 Z" />
      <path d="M90 122 H140 L127 135 H100 Z" />
      <path d="M105.4 171.4 L171.4 105.4 L180.6 114.6 L114.6 180.6 Z" />
    </svg>
  );
}

/** Ícone quadrado (fundo preto, marca dourada). */
export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-lg bg-[#121110] text-[#F4BF2F] ring-1 ring-white/10",
        className,
      )}
    >
      <LogoGlyph className="size-[62%]" />
    </span>
  );
}

export function Logo({
  className,
  collapsed,
  tone = "default",
}: {
  className?: string;
  collapsed?: boolean;
  tone?: "default" | "inverse";
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark />
      {collapsed ? null : (
        <span
          className={cn(
            "text-[15px] font-semibold tracking-tight whitespace-nowrap",
            tone === "inverse" ? "text-sidebar-fg" : "text-fg",
          )}
        >
          {APP_NAME}
        </span>
      )}
    </span>
  );
}
