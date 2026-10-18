import { ArrowRight } from "lucide-react";
import type { PortalSettings } from "@/lib/portal-settings";
import { cn } from "@/lib/utils";
import { isExternalLink, resolvePortalLink } from "./portal-links";

const OVERLAY = {
  none: () => undefined,
  light: (o: number) => `rgb(255 255 255 / ${o / 100})`,
  dark: (o: number) => `rgb(10 10 10 / ${o / 100})`,
  gradient: (o: number) =>
    `linear-gradient(90deg, rgb(10 10 10 / ${o / 100}) 0%, rgb(10 10 10 / ${(o / 100) * 0.55}) 55%, rgb(10 10 10 / ${(o / 100) * 0.15}) 100%)`,
};

/**
 * Banner de capa do portal, como a capa de um site. Usado no portal e na
 * prévia da personalização. A imagem nunca é deformada (object-fit: cover com
 * ponto de foco); a altura respeita limites e diminui em telas pequenas.
 * Sem imagem, usa um fundo com as cores da marca (nada de espaço vazio).
 */
export function PortalBanner({
  settings,
  name,
  imageUrl,
  logoUrl,
  base,
  fallbackTitle,
  fallbackText,
  preview,
}: {
  settings: PortalSettings;
  name: string;
  imageUrl: string | null;
  logoUrl: string | null;
  base: string;
  fallbackTitle?: string;
  fallbackText?: string | null;
  /** Na prévia, os links não navegam. */
  preview?: boolean;
}) {
  const b = settings.banner;
  const title = b.title ?? settings.welcomeTitle ?? fallbackTitle ?? `Bem-vindo ao portal de ${name}`;
  const subtitle = b.subtitle ?? settings.welcomeText ?? fallbackText ?? null;
  const hasImage = !!imageUrl;
  const darkText = hasImage && b.overlay === "light";
  const overlay = hasImage ? OVERLAY[b.overlay](b.overlayOpacity) : undefined;
  const href = b.buttonUrl ? resolvePortalLink(b.buttonUrl, base) : null;
  const external = href ? isExternalLink(href) : false;

  return (
    <section
      aria-label="Banner"
      className="relative isolate overflow-hidden rounded-2xl border border-border"
      style={{ height: `clamp(180px, 46vw, ${b.height}px)` }}
    >
      {hasImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl}
          alt=""
          className="absolute inset-0 -z-20 size-full object-cover"
          style={{ objectPosition: `${b.focalX}% ${b.focalY}%` }}
        />
      ) : (
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-20"
          style={{
            background:
              "radial-gradient(120% 140% at 100% 0%, color-mix(in oklab, var(--portal-highlight) 55%, transparent) 0%, transparent 55%), linear-gradient(135deg, var(--portal-secondary) 0%, color-mix(in oklab, var(--portal-secondary) 70%, black) 100%)",
          }}
        />
      )}
      {overlay ? <div aria-hidden="true" className="absolute inset-0 -z-10" style={{ background: overlay }} /> : null}
      <div
        className={cn(
          "flex h-full flex-col gap-3 p-5 sm:p-8",
          b.align === "center" && "items-center text-center",
          b.align === "right" && "items-end text-right",
          b.verticalAlign === "top" && "justify-start",
          b.verticalAlign === "center" && "justify-center",
          b.verticalAlign === "bottom" && "justify-end",
          darkText ? "text-[#161513]" : "text-white",
        )}
      >
        {b.showLogo && logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt={name} className="max-h-10 w-auto max-w-[180px] object-contain sm:max-h-12" />
        ) : null}
        <h2 className="max-w-2xl text-xl leading-tight font-semibold tracking-tight text-balance sm:text-3xl">
          {title}
        </h2>
        {subtitle ? (
          <p className={cn("max-w-xl text-sm leading-relaxed sm:text-base", darkText ? "opacity-80" : "opacity-90")}>
            {subtitle}
          </p>
        ) : null}
        {href && b.buttonLabel ? (
          <a
            href={preview ? undefined : href}
            target={external ? "_blank" : undefined}
            rel={external ? "noopener noreferrer" : undefined}
            aria-disabled={preview || undefined}
            className="mt-1 inline-flex h-10 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-accent-fg shadow-sm transition-colors hover:bg-accent-hover"
          >
            {b.buttonLabel} <ArrowRight className="size-4" />
          </a>
        ) : null}
      </div>
    </section>
  );
}
