"use client";

import { Maximize, Minus, Plus, Scan } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ORG_LOGO_BACKGROUNDS, type OrgLogoBackground, type OrgLogoCrop } from "@/lib/org-logo";
import { cn } from "@/lib/utils";

/*
 * Enquadramento quadrado da logo. O estado é o centro do quadro (em pixels da
 * imagem original) e o zoom relativo ao "caber inteira" (zoom 1). Assim o
 * recorte não depende do tamanho da tela: a mesma escolha gera o mesmo
 * arquivo no celular e no computador.
 */

export type CropState = { zoom: number; cx: number; cy: number };
export type SourceImage = { url: string; width: number; height: number };

/** Xadrez para indicar transparência. */
export const CHECKER =
  "repeating-conic-gradient(var(--color-surface-3, #e6e4de) 0% 25%, var(--color-surface, #ffffff) 0% 50%) 50% / 16px 16px";

export function initialCrop(img: SourceImage): CropState {
  return { zoom: 1, cx: img.width / 2, cy: img.height / 2 };
}

export function zoomLimits(img: SourceImage) {
  const long = Math.max(img.width, img.height);
  const short = Math.min(img.width, img.height);
  const cover = long / short;
  return { min: 1, cover, max: Math.max(1, Math.min(cover * 4, long / 16)) };
}

/** Mantém o quadro coerente: imagem menor que o quadro fica inteira dentro dele; maior, cobre o quadro. */
export function clampCrop(img: SourceImage, c: CropState): CropState {
  const { min, max } = zoomLimits(img);
  const zoom = Math.min(max, Math.max(min, c.zoom));
  const size = Math.max(img.width, img.height) / zoom;
  const axis = (v: number, len: number) => {
    const lo = Math.min(size / 2, len - size / 2);
    const hi = Math.max(size / 2, len - size / 2);
    return Math.min(hi, Math.max(lo, v));
  };
  return { zoom, cx: axis(c.cx, img.width), cy: axis(c.cy, img.height) };
}

/** Converte o estado em frações da imagem (formato que o servidor recebe). */
export function toCrop(img: SourceImage, c: CropState): OrgLogoCrop {
  const size = Math.max(img.width, img.height) / c.zoom;
  return { x: (c.cx - size / 2) / img.width, y: (c.cy - size / 2) / img.height, size: size / img.width };
}

function placement(img: SourceImage, c: CropState, frame: number) {
  const s = (frame / Math.max(img.width, img.height)) * c.zoom;
  return { left: frame / 2 - c.cx * s, top: frame / 2 - c.cy * s, width: img.width * s, height: img.height * s, s };
}

function backgroundStyle(bg: OrgLogoBackground) {
  const color = ORG_LOGO_BACKGROUNDS[bg].color;
  return color ? { background: color } : { background: CHECKER };
}

/** Prévia do resultado (mesma conta do recorte final), quadrada ou circular. */
export function CropPreview({
  img,
  crop,
  background,
  size,
  round,
  className,
}: {
  img: SourceImage;
  crop: CropState;
  background: OrgLogoBackground;
  size: number;
  round?: boolean;
  className?: string;
}) {
  const p = placement(img, crop, size);
  return (
    <span
      className={cn(
        "relative inline-block shrink-0 overflow-hidden ring-1 ring-border",
        round ? "rounded-full" : "rounded-md",
        className,
      )}
      style={{ width: size, height: size, ...backgroundStyle(background) }}
      aria-hidden="true"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={img.url}
        alt=""
        draggable={false}
        className="pointer-events-none absolute max-w-none select-none"
        style={{ left: p.left, top: p.top, width: p.width, height: p.height }}
      />
    </span>
  );
}

const ZOOM_STEPS = 200;

export function LogoCropper({
  img,
  crop,
  onCropChange,
  background,
  onBackgroundChange,
  disabled,
  variant = "logo",
}: {
  img: SourceImage;
  crop: CropState;
  onCropChange: (c: CropState) => void;
  background: OrgLogoBackground;
  onBackgroundChange: (b: OrgLogoBackground) => void;
  disabled?: boolean;
  /** "avatar": foto de perfil — prévias redondas e sem escolha de fundo. */
  variant?: "logo" | "avatar";
}) {
  const avatar = variant === "avatar";
  const frameRef = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState(280);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; zoom: number } | null>(null);
  const cropRef = useRef(crop);
  useEffect(() => {
    cropRef.current = crop;
  }, [crop]);

  const update = useCallback((next: CropState) => onCropChange(clampCrop(img, next)), [img, onCropChange]);

  // Mede o quadro (ele encolhe em telas estreitas).
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setFrame(Math.round(entry.contentRect.width));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Roda do mouse/trackpad: zoom (listener não passivo para não rolar a página).
  useEffect(() => {
    const el = frameRef.current;
    if (!el || disabled) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const c = cropRef.current;
      update({ ...c, zoom: c.zoom * Math.exp(-e.deltaY * 0.0015) });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [update, disabled]);

  const limits = zoomLimits(img);
  const p = placement(img, crop, frame);
  const logMin = Math.log(limits.min);
  const logMax = Math.log(limits.max);
  const sliderValue =
    logMax > logMin ? Math.round(((Math.log(crop.zoom) - logMin) / (logMax - logMin)) * ZOOM_STEPS) : 0;

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (disabled) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: cropRef.current.zoom };
    }
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const c = cropRef.current;
    if (pointers.current.size >= 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch.current.dist > 0) update({ ...c, zoom: pinch.current.zoom * (dist / pinch.current.dist) });
      return;
    }
    const s = placement(img, c, frame).s;
    update({ ...c, cx: c.cx - (e.clientX - prev.x) / s, cy: c.cy - (e.clientY - prev.y) / s });
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (disabled) return;
    const step = (e.shiftKey ? 1 : 10) / p.s;
    const c = crop;
    const moves: Record<string, CropState> = {
      ArrowLeft: { ...c, cx: c.cx + step },
      ArrowRight: { ...c, cx: c.cx - step },
      ArrowUp: { ...c, cy: c.cy + step },
      ArrowDown: { ...c, cy: c.cy - step },
      "+": { ...c, zoom: c.zoom * 1.1 },
      "=": { ...c, zoom: c.zoom * 1.1 },
      "-": { ...c, zoom: c.zoom / 1.1 },
      "0": initialCrop(img),
    };
    const next = moves[e.key];
    if (next) {
      e.preventDefault();
      update(next);
    }
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
        <div
          ref={frameRef}
          role="group"
          tabIndex={disabled ? -1 : 0}
          aria-label="Enquadramento da logo. Arraste ou use as setas para mover; + e − ajustam o zoom; 0 centraliza."
          className={cn(
            "relative aspect-square w-full max-w-[280px] shrink-0 touch-none overflow-hidden rounded-lg ring-1 ring-border outline-none select-none focus-visible:ring-2 focus-visible:ring-accent",
            disabled ? "cursor-default opacity-70" : "cursor-grab active:cursor-grabbing",
          )}
          style={backgroundStyle(background)}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onKeyDown={onKeyDown}
          data-testid="logo-crop-frame"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={img.url}
            alt={avatar ? "Foto em edição" : "Logo em edição"}
            draggable={false}
            className="pointer-events-none absolute max-w-none select-none"
            style={{ left: p.left, top: p.top, width: p.width, height: p.height }}
          />
          {/* Guia do recorte circular (avatares redondos). */}
          <span
            className="pointer-events-none absolute inset-0 rounded-full ring-1 [box-shadow:0_0_0_1px_rgba(0,0,0,0.15)_inset] ring-white/70 ring-inset"
            aria-hidden="true"
          />
        </div>
        <div className="grid w-full gap-3 sm:w-auto">
          <p className="text-xs font-medium text-fg-muted">Prévia</p>
          <div className="flex items-end gap-3">
            <CropPreview img={img} crop={crop} background={background} size={72} round={avatar} />
            <CropPreview img={img} crop={crop} background={background} size={44} round />
            <CropPreview img={img} crop={crop} background={background} size={24} round={avatar} />
          </div>
          <p className="max-w-[14rem] text-xs text-fg-subtle">
            {avatar ? "Perfil, chat e comentários." : "Perfil, avatar redondo e menu lateral."}
          </p>
        </div>
      </div>

      <div className="grid gap-1.5">
        <div className="flex items-center justify-between text-sm">
          <label htmlFor="logo-zoom" className="font-medium">
            Zoom
          </label>
          <span className="tabular text-xs text-fg-muted">{Math.round(crop.zoom * 100)}%</span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Diminuir zoom"
            disabled={disabled || crop.zoom <= limits.min}
            onClick={() => update({ ...crop, zoom: crop.zoom / 1.15 })}
          >
            <Minus />
          </Button>
          <input
            id="logo-zoom"
            type="range"
            min={0}
            max={ZOOM_STEPS}
            step={1}
            value={sliderValue}
            disabled={disabled || limits.max <= limits.min}
            onChange={(e) =>
              update({
                ...crop,
                zoom: Math.exp(logMin + (Number(e.target.value) / ZOOM_STEPS) * (logMax - logMin)),
              })
            }
            className="min-w-0 flex-1 accent-[var(--accent-text)] disabled:opacity-50"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Aumentar zoom"
            disabled={disabled || crop.zoom >= limits.max}
            onClick={() => update({ ...crop, zoom: crop.zoom * 1.15 })}
          >
            <Plus />
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="xs"
            variant="secondary"
            disabled={disabled}
            onClick={() => update(initialCrop(img))}
          >
            <Scan /> {avatar ? "Foto inteira" : "Logo inteira"}
          </Button>
          <Button
            type="button"
            size="xs"
            variant="secondary"
            disabled={disabled}
            onClick={() => update({ ...crop, zoom: limits.cover, cx: img.width / 2, cy: img.height / 2 })}
          >
            <Maximize /> Preencher o quadro
          </Button>
        </div>
      </div>

      {avatar ? null : (
        <fieldset className="grid gap-1.5" disabled={disabled}>
          <legend className="mb-1.5 text-sm font-medium">Fundo</legend>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(ORG_LOGO_BACKGROUNDS) as OrgLogoBackground[]).map((key) => (
              <label
                key={key}
                className={cn(
                  "inline-flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs transition-colors has-focus-visible:ring-2 has-focus-visible:ring-accent",
                  background === key
                    ? "border-accent bg-accent-soft text-fg"
                    : "border-border text-fg-muted hover:bg-surface-2",
                )}
              >
                <input
                  type="radio"
                  name="logo-background"
                  value={key}
                  checked={background === key}
                  onChange={() => onBackgroundChange(key)}
                  className="sr-only"
                />
                <span
                  className="size-4 rounded-sm ring-1 ring-border"
                  style={backgroundStyle(key)}
                  aria-hidden="true"
                />
                {ORG_LOGO_BACKGROUNDS[key].label}
              </label>
            ))}
          </div>
          <p className="text-xs text-fg-subtle">
            Transparente preserva o PNG original. Use escuro para logos claras e branco para logos escuras.
          </p>
        </fieldset>
      )}
    </div>
  );
}
