"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { SOCIAL_SPECS, type NetworkKey, type PlacementKey, type PlacementSpec } from "@/lib/social-specs";
import { cn } from "@/lib/utils";
import {
  Caption,
  Dots,
  MediaViewport,
  PostActions,
  PostHeader,
  SafeAreaOverlay,
  StoriesPlayer,
  type MediaItem,
  type Profile,
} from "./frames";

export type ViewMode = "post" | "art" | "enlarged" | "strip";
export type Device = "mobile" | "desktop";
export type Highlight = { slideKey: string; box: { x: number; y: number; width: number; height: number } } | null;

export const VIEW_MODE_LABEL: Record<ViewMode, string> = {
  post: "Publicação simulada",
  art: "Só a arte",
  enlarged: "Ampliada",
  strip: "Composição contínua",
};

/** Proporção do quadro da rede: a do formato (feed/Stories) ou, no carrossel, a aceita mais próxima da 1ª página. */
export function frameRatio(spec: PlacementSpec, first: { width: number; height: number } | undefined) {
  if (spec.kind !== "carousel" || !first) return spec.ratios[0]!.value;
  const r = first.width / Math.max(1, first.height);
  return spec.ratios.reduce(
    (best, x) => (Math.abs(Math.log(x.value / r)) < Math.abs(Math.log(best / r)) ? x.value : best),
    spec.ratios[0]!.value,
  );
}

/** Onde a imagem (w × h) fica dentro de um quadro com a proporção dada (em % do quadro). */
function placeImage(w: number, h: number, ratio: number, fit: "cover" | "contain"): CSSProperties {
  const fh = 1 / ratio;
  const scale = fit === "cover" ? Math.max(1 / w, fh / h) : Math.min(1 / w, fh / h);
  const dw = w * scale;
  const dh = h * scale;
  return {
    left: `${((1 - dw) / 2) * 100}%`,
    top: `${((fh - dh) / 2 / fh) * 100}%`,
    width: `${dw * 100}%`,
    height: `${(dh / fh) * 100}%`,
  };
}

function Overlay({
  item,
  ratio,
  fit,
  spec,
  safeArea,
  highlight,
}: {
  item: MediaItem;
  ratio: number;
  fit: "cover" | "contain";
  spec: PlacementSpec;
  safeArea: boolean;
  highlight: Highlight;
}) {
  const hl = highlight?.slideKey === item.key ? highlight.box : null;
  if (!safeArea && !hl) return null;
  return (
    <div className="pointer-events-none absolute" style={placeImage(item.width, item.height, ratio, fit)}>
      {safeArea ? (
        <SafeAreaOverlay
          safeArea={spec.safeArea}
          edgeMargin={spec.edgeMargin}
          width={item.width}
          height={item.height}
        />
      ) : null}
      {hl ? (
        <div
          className="absolute rounded-sm outline-2 outline-offset-2 outline-amber-400 [outline-style:solid] motion-safe:animate-pulse"
          style={{
            left: `${(hl.x / item.width) * 100}%`,
            top: `${(hl.y / item.height) * 100}%`,
            width: `${(hl.width / item.width) * 100}%`,
            height: `${(hl.height / item.height) * 100}%`,
          }}
          data-testid="preview-highlight"
        />
      ) : null}
    </div>
  );
}

export function PreviewStage({
  network,
  placement,
  items,
  index,
  onIndex,
  profile,
  caption,
  hashtags,
  cta,
  plannedDate,
  hasCaption,
  mode,
  device,
  zoom,
  safeArea,
  highlight,
}: {
  network: NetworkKey;
  placement: PlacementKey;
  items: MediaItem[];
  index: number;
  onIndex: (i: number) => void;
  profile: Profile;
  caption: string | null;
  hashtags: string[];
  cta: string | null;
  plannedDate?: string | null;
  hasCaption: boolean;
  mode: ViewMode;
  device: Device;
  zoom: number;
  safeArea: boolean;
  highlight: Highlight;
}) {
  const net = SOCIAL_SPECS[network];
  const spec = net.placements[placement];
  if (!spec) {
    return <p className="p-8 text-center text-sm text-fg-muted">{net.label} não tem este formato.</p>;
  }
  if (!items.length) {
    return (
      <p className="p-8 text-center text-sm text-fg-muted">
        Nenhuma arte ou mídia para mostrar. Crie a arte no editor ou anexe uma imagem à peça.
      </p>
    );
  }
  const current = items[Math.min(index, items.length - 1)]!;
  const fit = spec.outOfRange === "crop" ? "cover" : "contain";
  const overlay = (ratio: number, f: "cover" | "contain") =>
    function OverlayFor(item: MediaItem) {
      return <Overlay item={item} ratio={ratio} fit={f} spec={spec} safeArea={safeArea} highlight={highlight} />;
    };

  if (mode === "strip") {
    // Páginas lado a lado, sem espaço: confere a continuidade da composição do carrossel.
    const h = Math.round(300 * zoom);
    return (
      <div className="max-w-full overflow-x-auto pb-2" data-testid="preview-strip">
        <div className="flex w-max">
          {items.map((it, i) => (
            <button
              key={it.key}
              type="button"
              onClick={() => onIndex(i)}
              className={cn(
                "relative shrink-0 outline-none focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-accent",
                i === index && "z-10 ring-2 ring-accent",
              )}
              style={{ height: h, width: Math.round((h * it.width) / it.height) }}
              aria-label={`${it.label}${i === index ? " (selecionada)" : ""}`}
            >
              {it.src && it.kind === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={it.src} alt="" className="size-full object-fill" draggable={false} />
              ) : (
                <span className="flex size-full items-center justify-center bg-neutral-200 text-xs text-neutral-500">
                  {it.kind === "video" ? "Vídeo" : "…"}
                </span>
              )}
              <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 text-[10px] text-white tabular-nums">
                {i + 1}
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (mode === "art" || mode === "enlarged") {
    const ratio = current.width / Math.max(1, current.height);
    const style: CSSProperties =
      mode === "enlarged"
        ? { width: `min(100%, calc(78vh * ${ratio}))`, maxWidth: Math.round(1100 * zoom) }
        : { width: Math.round(Math.min(440, 440 * ratio) * zoom) };
    return (
      <Wrap>
        <div style={{ ...style, maxWidth: style.maxWidth ?? "100%" }} className="max-w-full">
          <MediaViewport
            items={items}
            index={index}
            onIndex={onIndex}
            ratio={ratio}
            fit="contain"
            overlay={overlay(ratio, "contain")}
            className="rounded-md shadow-md ring-1 ring-black/5"
          />
          <p className="mt-2 text-center text-xs text-fg-muted">
            {current.label} · {current.width} × {current.height} px
          </p>
        </div>
      </Wrap>
    );
  }

  if (spec.kind === "stories") {
    const width = Math.round((device === "desktop" ? 340 : 300) * zoom);
    return (
      <Wrap>
        <StoriesPlayer
          items={items}
          index={index}
          onIndex={onIndex}
          profile={profile}
          fit={fit}
          width={width}
          overlay={overlay(9 / 16, fit)}
        />
      </Wrap>
    );
  }

  const ratio = frameRatio(spec, items[0]);
  const captionBlock = hasCaption ? (
    <Caption
      network={network}
      profile={profile}
      caption={caption}
      hashtags={hashtags}
      cta={cta}
      previewChars={net.caption.preview}
      plannedDate={plannedDate}
    />
  ) : null;
  const media = (
    <MediaViewport
      items={items}
      index={index}
      onIndex={onIndex}
      ratio={ratio}
      fit={fit}
      overlay={overlay(ratio, fit)}
    />
  );

  if (device === "desktop" && network === "instagram") {
    // Publicação aberta no computador: mídia à esquerda, perfil e legenda à direita.
    const w = Math.round(480 * zoom);
    return (
      <Wrap>
        <div
          className="flex max-w-full flex-col overflow-hidden rounded-md border border-neutral-200 bg-white text-neutral-900 shadow-lg sm:flex-row"
          style={{ width: w + 256 }}
          data-testid="preview-post"
        >
          <div className="min-w-0 flex-1 bg-black">
            <div className="flex h-full items-center">{media}</div>
          </div>
          <div className="flex flex-col border-t border-neutral-200 sm:w-64 sm:shrink-0 sm:border-t-0 sm:border-l">
            <div className="border-b border-neutral-200">
              <PostHeader network={network} profile={profile} />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">{captionBlock}</div>
            <div className="border-t border-neutral-200 pb-2">
              <PostActions network={network} />
            </div>
          </div>
        </div>
      </Wrap>
    );
  }

  const w = Math.round((device === "desktop" ? 500 : 375) * zoom);
  return (
    <Wrap>
      <div
        className={cn(
          "max-w-full overflow-hidden bg-white text-neutral-900 shadow-lg",
          device === "mobile"
            ? "rounded-[1.6rem] border-[8px] border-neutral-900"
            : "rounded-md border border-neutral-200",
        )}
        style={{ width: w + (device === "mobile" ? 16 : 0) }}
        data-testid="preview-post"
      >
        {device === "mobile" ? <div className="h-5 bg-white" aria-hidden /> : null}
        {network === "instagram" ? <PostHeader network={network} profile={profile} /> : null}
        {network !== "instagram" ? (
          <>
            <PostHeader network={network} profile={profile} />
            {captionBlock}
          </>
        ) : null}
        {media}
        {network === "instagram" ? <Dots count={items.length} index={index} /> : null}
        <PostActions network={network} />
        {network === "instagram" ? captionBlock : null}
        <div className="h-3" aria-hidden />
      </div>
    </Wrap>
  );
}

function Wrap({ children }: { children: ReactNode }) {
  return <div className="flex w-full justify-center overflow-x-auto py-2">{children}</div>;
}

/** Faixa de miniaturas numeradas (ordem das páginas), com o total de alertas por página. */
export function Thumbnails({
  items,
  index,
  onIndex,
  counts,
  editHref,
}: {
  items: MediaItem[];
  index: number;
  onIndex: (i: number) => void;
  counts?: Record<string, { error: number; warning: number }>;
  editHref?: (item: MediaItem) => string | null;
}) {
  if (items.length < 2) return null;
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold text-fg-muted">Ordem das páginas ({items.length})</h2>
        <div className="flex gap-1">
          <button
            type="button"
            className="flex size-7 items-center justify-center rounded-md border border-border bg-surface hover:bg-surface-2 disabled:opacity-40"
            onClick={() => onIndex(index - 1)}
            disabled={index === 0}
            aria-label="Página anterior"
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            type="button"
            className="flex size-7 items-center justify-center rounded-md border border-border bg-surface hover:bg-surface-2 disabled:opacity-40"
            onClick={() => onIndex(index + 1)}
            disabled={index === items.length - 1}
            aria-label="Próxima página"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>
      <ol className="flex scrollbar-thin gap-2 overflow-x-auto pb-1" aria-label="Miniaturas">
        {items.map((it, i) => {
          const c = counts?.[it.key];
          const href = editHref?.(it);
          return (
            <li key={it.key} className="grid w-20 shrink-0 gap-1">
              <button
                type="button"
                onClick={() => onIndex(i)}
                aria-current={i === index ? "true" : undefined}
                aria-label={`${it.label}${c?.error ? `, ${c.error} erro(s)` : ""}${c?.warning ? `, ${c.warning} aviso(s)` : ""}`}
                className={cn(
                  "relative overflow-hidden rounded-md border bg-surface-2 outline-none focus-visible:ring-2 focus-visible:ring-accent",
                  i === index ? "border-accent ring-1 ring-accent" : "border-border",
                )}
                style={{ aspectRatio: String(it.width / Math.max(1, it.height)) }}
              >
                {it.src && it.kind === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={it.src} alt="" className="size-full object-cover" loading="lazy" draggable={false} />
                ) : (
                  <span className="flex size-full items-center justify-center text-[10px] text-fg-subtle">
                    {it.kind === "video" ? "Vídeo" : "…"}
                  </span>
                )}
                <span className="absolute top-0.5 left-0.5 rounded bg-black/60 px-1 text-[10px] text-white tabular-nums">
                  {i + 1}
                </span>
                {c?.error || c?.warning ? (
                  <span
                    className={cn(
                      "absolute top-0.5 right-0.5 rounded px-1 text-[10px] font-semibold text-white",
                      c.error ? "bg-danger" : "bg-warning",
                    )}
                    aria-hidden
                  >
                    {c.error || c.warning}
                  </span>
                ) : null}
              </button>
              {href ? (
                <Link
                  href={href}
                  className="truncate text-center text-[11px] text-fg-muted hover:text-fg hover:underline"
                >
                  Editar
                </Link>
              ) : (
                <span className="truncate text-center text-[11px] text-fg-subtle">{it.label}</span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
