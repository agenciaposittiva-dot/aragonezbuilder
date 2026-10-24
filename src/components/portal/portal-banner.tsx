"use client";

import { ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
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

type Slide = {
  imageUrl: string | null;
  title: string | null;
  subtitle: string | null;
  buttonLabel: string | null;
  buttonUrl: string | null;
  focalX: number;
  focalY: number;
};

const REDUCED = "(prefers-reduced-motion: reduce)";
function subscribeReducedMotion(cb: () => void) {
  const mq = window.matchMedia(REDUCED);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

/**
 * Banner de capa do portal, como a capa de um site. Usado no portal e na
 * prévia da personalização. A imagem nunca é deformada (object-fit: cover com
 * ponto de foco); a altura respeita limites e diminui em telas pequenas.
 * Sem imagem, usa um fundo com as cores da marca (nada de espaço vazio).
 *
 * Com banners extras (`banner.slides` com imagem), vira um carrossel: setas,
 * pontos, toque para deslizar e rolagem automática no intervalo escolhido,
 * que pausa com o mouse ou o foco sobre o banner e respeita a preferência de
 * menos movimento do sistema.
 */
export function PortalBanner({
  settings,
  name,
  imageUrl,
  slideUrls = [],
  logoUrl,
  base,
  fallbackTitle,
  fallbackText,
  preview,
  frameWidth,
}: {
  settings: PortalSettings;
  name: string;
  imageUrl: string | null;
  /** Imagens dos banners extras, na ordem de `settings.banner.slides` (null = indisponível). */
  slideUrls?: (string | null)[];
  logoUrl: string | null;
  base: string;
  fallbackTitle?: string;
  fallbackText?: string | null;
  /** Na prévia, os links não navegam. */
  preview?: boolean;
  /** Na prévia, largura simulada da tela (px) para calcular a altura como no aparelho. */
  frameWidth?: number;
}) {
  const b = settings.banner;
  const main: Slide = {
    imageUrl,
    title: b.title ?? settings.welcomeTitle ?? fallbackTitle ?? `Bem-vindo ao portal de ${name}`,
    subtitle: b.subtitle ?? settings.welcomeText ?? fallbackText ?? null,
    buttonLabel: b.buttonLabel,
    buttonUrl: b.buttonUrl,
    focalX: b.focalX,
    focalY: b.focalY,
  };
  // Banners extras só entram com imagem disponível (sem imagem quebrada no carrossel).
  const extras = b.slides
    .map<Slide>((s, i) => ({
      imageUrl: slideUrls[i] ?? null,
      title: s.title,
      subtitle: s.subtitle,
      buttonLabel: s.buttonLabel,
      buttonUrl: s.buttonUrl,
      focalX: s.focalX,
      focalY: s.focalY,
    }))
    .filter((s) => !!s.imageUrl);
  const slides = [main, ...extras];
  const count = slides.length;

  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [touchX, setTouchX] = useState<number | null>(null);
  const reduced = useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(REDUCED).matches,
    () => false,
  );
  const active = count > 0 ? index % count : 0;
  const rotate = count > 1 && b.autoplay && !paused && !reduced;

  useEffect(() => {
    if (!rotate) return;
    const id = window.setInterval(() => setIndex((i) => i + 1), b.interval * 1000);
    return () => window.clearInterval(id);
  }, [rotate, b.interval]);

  const go = (delta: number) => setIndex(((active + delta) % count) + count);
  const current = slides[active]!;
  const hasImage = !!current.imageUrl;
  const darkText = hasImage && b.overlay === "light";
  const overlay = hasImage ? OVERLAY[b.overlay](b.overlayOpacity) : undefined;
  const href = current.buttonUrl ? resolvePortalLink(current.buttonUrl, base) : null;
  const external = href ? isExternalLink(href) : false;
  // Na prévia, a largura simulada decide a tipografia (as classes sm: dependem da tela de quem edita).
  const small = frameWidth === undefined ? null : frameWidth < 640;
  const pick = (responsive: string, mobile: string, desktop: string) =>
    small === null ? responsive : small ? mobile : desktop;
  const control = darkText
    ? "bg-black/10 text-[#161513] hover:bg-black/20"
    : "bg-black/40 text-white hover:bg-black/60";

  return (
    <section
      aria-label="Banner"
      aria-roledescription={count > 1 ? "carrossel" : undefined}
      data-banner-count={count}
      data-banner-index={active}
      className="group relative isolate flex overflow-hidden rounded-2xl border border-border"
      style={{
        // Altura mínima: em telas estreitas o conteúdo pode crescer sem ser cortado.
        minHeight: frameWidth
          ? `${Math.round(Math.min(b.height, Math.max(180, frameWidth * 0.46)))}px`
          : `clamp(180px, 46vw, ${b.height}px)`,
      }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
      onTouchStart={(e) => setTouchX(e.touches[0]?.clientX ?? null)}
      onTouchEnd={(e) => {
        if (touchX === null || count < 2) return;
        const dx = (e.changedTouches[0]?.clientX ?? touchX) - touchX;
        if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1);
        setTouchX(null);
      }}
    >
      {slides.map((s, i) =>
        s.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={i}
            src={s.imageUrl}
            alt=""
            aria-hidden={i !== active}
            className={cn(
              "absolute inset-0 -z-20 size-full object-cover transition-opacity duration-700",
              i === active ? "opacity-100" : "opacity-0",
            )}
            style={{ objectPosition: `${s.focalX}% ${s.focalY}%` }}
          />
        ) : null,
      )}
      {hasImage ? null : (
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
        key={active}
        aria-live={count > 1 && !rotate ? "polite" : undefined}
        className={cn(
          "flex w-full flex-col gap-3",
          pick("p-5 sm:p-8", "p-5", "p-8"),
          count > 1 && pick("px-12 pb-8 sm:px-16", "px-12 pb-8", "px-16 pb-8"),
          b.align === "left" && "items-start",
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
          <img
            src={logoUrl}
            alt={name}
            className={cn("w-auto max-w-[180px] object-contain", pick("max-h-10 sm:max-h-12", "max-h-10", "max-h-12"))}
          />
        ) : null}
        {current.title ? (
          <h2
            className={cn(
              "max-w-2xl leading-tight font-semibold tracking-tight text-balance",
              pick("text-xl sm:text-3xl", "text-xl", "text-3xl"),
            )}
          >
            {current.title}
          </h2>
        ) : null}
        {current.subtitle ? (
          <p
            className={cn(
              "max-w-xl leading-relaxed",
              pick("text-sm sm:text-base", "text-sm", "text-base"),
              darkText ? "opacity-80" : "opacity-90",
            )}
          >
            {current.subtitle}
          </p>
        ) : null}
        {href && current.buttonLabel ? (
          <a
            href={preview ? undefined : href}
            target={external ? "_blank" : undefined}
            rel={external ? "noopener noreferrer" : undefined}
            aria-disabled={preview || undefined}
            className="mt-1 inline-flex h-10 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-accent-fg shadow-sm transition-colors hover:bg-accent-hover"
          >
            {current.buttonLabel} <ArrowRight className="size-4" />
          </a>
        ) : null}
      </div>
      {count > 1 ? (
        <>
          <button
            type="button"
            aria-label="Banner anterior"
            onClick={() => go(-1)}
            className={cn(
              "absolute top-1/2 left-2 inline-flex size-9 -translate-y-1/2 items-center justify-center rounded-full backdrop-blur-sm transition-colors focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:outline-none",
              control,
            )}
          >
            <ChevronLeft className="size-5" />
          </button>
          <button
            type="button"
            aria-label="Próximo banner"
            onClick={() => go(1)}
            className={cn(
              "absolute top-1/2 right-2 inline-flex size-9 -translate-y-1/2 items-center justify-center rounded-full backdrop-blur-sm transition-colors focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:outline-none",
              control,
            )}
          >
            <ChevronRight className="size-5" />
          </button>
          <div className="absolute inset-x-0 bottom-2 flex justify-center gap-1.5" role="tablist" aria-label="Banners">
            {slides.map((_, i) => (
              <button
                key={i}
                type="button"
                role="tab"
                aria-selected={i === active}
                aria-label={`Banner ${i + 1} de ${count}`}
                onClick={() => setIndex(i)}
                className={cn(
                  "size-2 rounded-full transition-colors",
                  darkText
                    ? i === active
                      ? "bg-[#161513]"
                      : "bg-[#161513]/40 hover:bg-[#161513]/70"
                    : i === active
                      ? "bg-white"
                      : "bg-white/50 hover:bg-white/80",
                )}
              />
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}
