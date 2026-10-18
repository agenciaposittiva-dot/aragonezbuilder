"use client";

import {
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Globe,
  Heart,
  MessageCircle,
  MoreHorizontal,
  Pause,
  Play,
  Repeat2,
  RotateCcw,
  Send,
  Share2,
  ThumbsUp,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatDate } from "@/lib/format";
import type { NetworkKey } from "@/lib/social-specs";
import { cn, initials } from "@/lib/utils";

/*
 * Molduras próprias da prévia (sem imagens nem marcas das redes): cabeçalho
 * com o perfil do cliente, mídia, ações ilustrativas e legenda. Nada de
 * curtidas, comentários ou números: a interface é só ilustrativa.
 */

export type MediaItem = {
  key: string;
  label: string;
  /** null = ainda desenhando. */
  src: string | null;
  kind: "image" | "video";
  width: number;
  height: number;
};

export type Profile = { name: string; avatarUrl: string | null };

export function ProfileAvatar({ profile, size = 32, ring }: { profile: Profile; size?: number; ring?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-neutral-200 font-semibold text-neutral-700",
        ring && "ring-2 ring-pink-500 ring-offset-2 ring-offset-white",
      )}
      style={{ width: size, height: size, fontSize: Math.max(9, size * 0.36) }}
      aria-hidden
    >
      {profile.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={profile.avatarUrl} alt="" className="size-full object-cover" />
      ) : (
        initials(profile.name)
      )}
    </span>
  );
}

const handle = (name: string) =>
  name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.|\.$/g, "")
    .slice(0, 30) || "perfil";

export function PostHeader({ network, profile }: { network: NetworkKey; profile: Profile }) {
  if (network === "instagram") {
    return (
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <ProfileAvatar profile={profile} ring />
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{handle(profile.name)}</span>
        <MoreHorizontal className="size-4 text-neutral-500" aria-hidden />
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2.5 px-3 py-2.5">
      <ProfileAvatar profile={profile} size={40} />
      <div className="min-w-0 flex-1 leading-tight">
        <p className="truncate text-[13px] font-semibold">{profile.name}</p>
        <p className="flex items-center gap-1 text-[11px] text-neutral-500">
          {network === "linkedin" ? "Página da empresa" : "Publicação"} · <Globe className="size-3" aria-hidden />
        </p>
      </div>
      <MoreHorizontal className="size-4 text-neutral-500" aria-hidden />
    </div>
  );
}

export function PostActions({ network }: { network: NetworkKey }) {
  const item = "flex items-center gap-1.5 text-[12px] font-medium text-neutral-600";
  return (
    <div aria-label="Ações ilustrativas da rede (sem dados reais)" className="px-3 pt-2">
      {network === "instagram" ? (
        <div className="flex items-center gap-3.5 text-neutral-800">
          <Heart className="size-5" aria-hidden />
          <MessageCircle className="size-5" aria-hidden />
          <Send className="size-5" aria-hidden />
          <Bookmark className="ml-auto size-5" aria-hidden />
        </div>
      ) : network === "facebook" ? (
        <div className="flex items-center justify-around border-t border-neutral-200 pt-2">
          <span className={item}>
            <ThumbsUp className="size-4" aria-hidden /> Curtir
          </span>
          <span className={item}>
            <MessageCircle className="size-4" aria-hidden /> Comentar
          </span>
          <span className={item}>
            <Share2 className="size-4" aria-hidden /> Compartilhar
          </span>
        </div>
      ) : (
        <div className="flex items-center justify-around border-t border-neutral-200 pt-2">
          <span className={item}>
            <ThumbsUp className="size-4" aria-hidden /> Gostei
          </span>
          <span className={item}>
            <MessageCircle className="size-4" aria-hidden /> Comentar
          </span>
          <span className={item}>
            <Repeat2 className="size-4" aria-hidden /> Compartilhar
          </span>
          <span className={item}>
            <Send className="size-4" aria-hidden /> Enviar
          </span>
        </div>
      )}
      <p className="mt-1.5 text-[10px] text-neutral-400">Interface ilustrativa · sem curtidas ou comentários reais</p>
    </div>
  );
}

/** Legenda com "mais" / "menos" no ponto em que a rede costuma cortar. */
export function Caption({
  network,
  profile,
  caption,
  hashtags,
  cta,
  previewChars,
  plannedDate,
}: {
  network: NetworkKey;
  profile: Profile;
  caption: string | null;
  hashtags: string[];
  cta: string | null;
  previewChars: number;
  plannedDate?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const text = (caption ?? "").trim();
  const ctaLine = cta?.trim() && !text.includes(cta.trim()) ? cta.trim() : null;
  const full = [text, ctaLine].filter(Boolean).join("\n\n");
  const cut = full.length > previewChars;
  const shown = open || !cut ? full : `${full.slice(0, previewChars).trimEnd()}…`;
  const tags = hashtags.filter(Boolean);
  if (!full && !tags.length) {
    return <p className="px-3 py-2 text-[12px] text-neutral-400 italic">Sem legenda.</p>;
  }
  return (
    <div className="px-3 py-2 text-[13px] leading-snug" data-testid="preview-caption">
      <p className="break-words whitespace-pre-wrap">
        {network === "instagram" ? <span className="mr-1 font-semibold">{handle(profile.name)}</span> : null}
        {shown}
        {cut ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="ml-1 text-neutral-500 hover:text-neutral-800 focus-visible:underline focus-visible:outline-none"
            aria-expanded={open}
          >
            {open ? "menos" : "mais"}
          </button>
        ) : null}
      </p>
      {tags.length && (open || !cut) ? <p className="mt-1 break-words text-sky-700">{tags.join(" ")}</p> : null}
      {plannedDate ? (
        <p className="mt-1.5 text-[10px] tracking-wide text-neutral-400 uppercase">
          Planejado para {formatDate(plannedDate)}
        </p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Mídia (post único e carrossel)                                      */
/* ------------------------------------------------------------------ */

function Media({ item, fit, eager }: { item: MediaItem; fit: "cover" | "contain"; eager?: boolean }) {
  if (!item.src) {
    return <div className="size-full animate-pulse bg-neutral-200" aria-label="Desenhando a página…" role="img" />;
  }
  if (item.kind === "video") {
    return (
      <video
        src={item.src}
        className={cn("size-full", fit === "cover" ? "object-cover" : "object-contain")}
        controls
        playsInline
        preload="metadata"
        aria-label={item.label}
      />
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={item.src}
      alt={item.label}
      loading={eager ? "eager" : "lazy"}
      draggable={false}
      className={cn("size-full select-none", fit === "cover" ? "object-cover" : "object-contain")}
    />
  );
}

/**
 * Área da mídia com navegação: setas, teclado (← →), arrastar com o dedo e
 * indicador de página. Só a página atual e as vizinhas são montadas, para o
 * carrossel longo continuar leve.
 */
export function MediaViewport({
  items,
  index,
  onIndex,
  ratio,
  fit,
  overlay,
  className,
}: {
  items: MediaItem[];
  index: number;
  onIndex: (i: number) => void;
  /** Largura ÷ altura do quadro. */
  ratio: number;
  fit: "cover" | "contain";
  overlay?: (item: MediaItem) => React.ReactNode;
  className?: string;
}) {
  const touch = useRef<{ x: number; y: number } | null>(null);
  const many = items.length > 1;
  const go = useCallback((i: number) => onIndex(Math.max(0, Math.min(items.length - 1, i))), [items.length, onIndex]);
  return (
    <div
      className={cn("relative w-full overflow-hidden bg-neutral-100 outline-none", className)}
      style={{ aspectRatio: String(ratio) }}
      tabIndex={many ? 0 : -1}
      role={many ? "region" : undefined}
      aria-roledescription={many ? "carrossel" : undefined}
      aria-label={many ? `Página ${index + 1} de ${items.length}. Use as setas para navegar.` : undefined}
      onKeyDown={(e) => {
        if (!many) return;
        if (e.key === "ArrowRight") {
          e.preventDefault();
          go(index + 1);
        } else if (e.key === "ArrowLeft") {
          e.preventDefault();
          go(index - 1);
        }
      }}
      onTouchStart={(e) => {
        const t = e.touches[0];
        if (t) touch.current = { x: t.clientX, y: t.clientY };
      }}
      onTouchEnd={(e) => {
        const start = touch.current;
        const t = e.changedTouches[0];
        touch.current = null;
        if (!start || !t) return;
        const dx = t.clientX - start.x;
        if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(t.clientY - start.y)) go(index + (dx < 0 ? 1 : -1));
      }}
    >
      <div
        className="flex h-full transition-transform duration-300 ease-out"
        style={{ transform: `translateX(-${index * 100}%)` }}
      >
        {items.map((it, i) => (
          <div
            key={it.key}
            className="relative h-full w-full shrink-0"
            aria-hidden={i !== index}
            data-testid={i === index ? "preview-current-media" : undefined}
          >
            {Math.abs(i - index) <= 1 ? <Media item={it} fit={fit} eager={i === index} /> : null}
            {i === index && overlay ? overlay(it) : null}
          </div>
        ))}
      </div>
      {many ? (
        <>
          <span className="absolute top-2.5 right-2.5 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-medium text-white tabular-nums">
            {index + 1}/{items.length}
          </span>
          {index > 0 ? (
            <button
              type="button"
              onClick={() => go(index - 1)}
              className="absolute top-1/2 left-2 flex size-7 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-neutral-800 shadow focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none"
              aria-label="Página anterior"
            >
              <ChevronLeft className="size-4" />
            </button>
          ) : null}
          {index < items.length - 1 ? (
            <button
              type="button"
              onClick={() => go(index + 1)}
              className="absolute top-1/2 right-2 flex size-7 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-neutral-800 shadow focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none"
              aria-label="Próxima página"
            >
              <ChevronRight className="size-4" />
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

export function Dots({ count, index }: { count: number; index: number }) {
  if (count < 2) return null;
  // Como nas redes: no máximo ~7 pontos, o resto encolhe.
  return (
    <div className="flex items-center justify-center gap-1 pt-2" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          className={cn(
            "rounded-full transition-all",
            i === index ? "size-1.5 bg-sky-500" : "size-1.5 bg-neutral-300",
            Math.abs(i - index) > 3 && "size-1",
          )}
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Stories                                                             */
/* ------------------------------------------------------------------ */

const IMAGE_SECONDS = 5;

/**
 * Sequência de Stories numa moldura de celular 9:16: barras de progresso
 * ilustrativas, avançar/voltar (toque nas laterais ou setas), pausar e
 * reiniciar. Vídeos usam a própria duração.
 */
export function StoriesPlayer({
  items,
  index,
  onIndex,
  profile,
  fit,
  overlay,
  width,
}: {
  items: MediaItem[];
  index: number;
  onIndex: (i: number) => void;
  profile: Profile;
  fit: "cover" | "contain";
  overlay?: (item: MediaItem) => React.ReactNode;
  width: number;
}) {
  const [playing, setPlaying] = useState(true);
  const [restarts, setRestarts] = useState(0);
  const item = items[index];
  // Progresso e duração valem para a tela atual (trocar de tela recomeça do zero).
  const [prog, setProg] = useState<{ key: string; value: number }>({ key: "", value: 0 });
  const [dur, setDur] = useState<{ key: string; value: number }>({ key: "", value: IMAGE_SECONDS });
  const progress = prog.key === item?.key ? prog.value : 0;
  const duration = dur.key === item?.key ? dur.value : IMAGE_SECONDS;
  // Ref para retomar do ponto certo depois de pausar.
  const progressRef = useRef(prog);
  const setProgress = useCallback((key: string, value: number) => {
    progressRef.current = { key, value };
    setProg({ key, value });
  }, []);
  const videoRef = useRef<HTMLVideoElement>(null);
  const go = useCallback((i: number) => onIndex(Math.max(0, Math.min(items.length - 1, i))), [items.length, onIndex]);

  // Imagens: avança sozinho a cada 5 s enquanto estiver tocando.
  useEffect(() => {
    if (!playing || !item || item.kind === "video" || !item.src) return;
    const from = progressRef.current.key === item.key ? progressRef.current.value : 0;
    const started = performance.now() - from * duration * 1000;
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - started) / (duration * 1000));
      setProgress(item.key, p);
      if (p >= 1) {
        if (index < items.length - 1) go(index + 1);
        else setPlaying(false);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, index, item?.key, item?.src, item?.kind, duration, restarts]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (playing) void v.play().catch(() => undefined);
    else v.pause();
  }, [playing, index]);

  const restart = () => {
    if (items[0]) setProgress(items[0].key, 0);
    if (videoRef.current) videoRef.current.currentTime = 0;
    onIndex(0);
    setPlaying(true);
    setRestarts((n) => n + 1);
  };

  if (!item) return null;
  const height = Math.round(width * (16 / 9));
  return (
    <div className="grid justify-items-center gap-3">
      <div
        className="relative overflow-hidden rounded-[2.2rem] border-[10px] border-neutral-900 bg-black shadow-xl outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
        style={{ width: width + 20, height: height + 20 }}
        tabIndex={0}
        role="region"
        aria-roledescription="sequência de Stories"
        aria-label={`Tela ${index + 1} de ${items.length}. Espaço pausa, setas navegam.`}
        data-testid="stories-player"
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") go(index + 1);
          else if (e.key === "ArrowLeft") go(index - 1);
          else if (e.key === " ") {
            e.preventDefault();
            setPlaying((p) => !p);
          } else return;
          e.preventDefault();
        }}
      >
        <div className="relative size-full">
          {item.src ? (
            item.kind === "video" ? (
              <video
                ref={videoRef}
                key={item.key}
                src={item.src}
                className={cn("size-full", fit === "cover" ? "object-cover" : "object-contain")}
                playsInline
                muted
                autoPlay={playing}
                aria-label={item.label}
                onLoadedMetadata={(e) => setDur({ key: item.key, value: e.currentTarget.duration || IMAGE_SECONDS })}
                onTimeUpdate={(e) =>
                  setProgress(item.key, e.currentTarget.currentTime / (e.currentTarget.duration || 1))
                }
                onEnded={() => (index < items.length - 1 ? go(index + 1) : setPlaying(false))}
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={item.src}
                alt={item.label}
                className={cn("size-full select-none", fit === "cover" ? "object-cover" : "object-contain")}
                draggable={false}
                data-testid="preview-current-media"
              />
            )
          ) : (
            <div className="size-full animate-pulse bg-neutral-800" role="img" aria-label="Desenhando a tela…" />
          )}
          {overlay ? overlay(item) : null}
          {/* Barras e perfil: interface ilustrativa por cima da arte. */}
          <div className="pointer-events-none absolute inset-x-0 top-0 bg-gradient-to-b from-black/40 to-transparent px-2 pt-2 pb-6">
            <div className="flex gap-1" aria-hidden>
              {items.map((it, i) => (
                <span key={it.key} className="h-0.5 flex-1 overflow-hidden rounded-full bg-white/40">
                  <span
                    className="block h-full bg-white"
                    style={{ width: `${i < index ? 100 : i === index ? Math.round(progress * 100) : 0}%` }}
                  />
                </span>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-2 text-white">
              <ProfileAvatar profile={profile} size={26} />
              <span className="truncate text-[12px] font-semibold">{handle(profile.name)}</span>
              <span className="text-[11px] text-white/70">exemplo</span>
              <X className="ml-auto size-4" aria-hidden />
            </div>
          </div>
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-2 px-3 pb-3"
            aria-hidden
          >
            <span className="flex-1 rounded-full border border-white/60 px-3 py-1.5 text-[11px] text-white/80">
              Enviar mensagem
            </span>
            <Heart className="size-5 text-white" />
            <Send className="size-5 text-white" />
          </div>
          {/* Toques nas laterais: voltar / avançar (como no aplicativo). */}
          <button
            type="button"
            tabIndex={-1}
            aria-hidden
            className="absolute inset-y-16 left-0 w-1/3"
            onClick={() => go(index - 1)}
          />
          <button
            type="button"
            tabIndex={-1}
            aria-hidden
            className="absolute inset-y-16 right-0 w-1/3"
            onClick={() => go(index + 1)}
          />
        </div>
      </div>
      <div className="flex items-center gap-1" role="group" aria-label="Controles da sequência">
        <button
          type="button"
          className="flex size-8 items-center justify-center rounded-full border border-border bg-surface text-fg hover:bg-surface-2 disabled:opacity-40"
          onClick={() => go(index - 1)}
          disabled={index === 0}
          aria-label="Tela anterior"
        >
          <ChevronLeft className="size-4" />
        </button>
        <button
          type="button"
          className="flex size-8 items-center justify-center rounded-full border border-border bg-surface text-fg hover:bg-surface-2"
          onClick={() => setPlaying((p) => !p)}
          aria-label={playing ? "Pausar" : "Reproduzir"}
          aria-pressed={!playing}
        >
          {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
        </button>
        <button
          type="button"
          className="flex size-8 items-center justify-center rounded-full border border-border bg-surface text-fg hover:bg-surface-2"
          onClick={restart}
          aria-label="Reiniciar sequência"
        >
          <RotateCcw className="size-4" />
        </button>
        <button
          type="button"
          className="flex size-8 items-center justify-center rounded-full border border-border bg-surface text-fg hover:bg-surface-2 disabled:opacity-40"
          onClick={() => go(index + 1)}
          disabled={index === items.length - 1}
          aria-label="Próxima tela"
        >
          <ChevronRight className="size-4" />
        </button>
        <span className="ml-2 text-xs text-fg-muted tabular-nums">
          {index + 1} de {items.length} ·{" "}
          {item.kind === "video" ? `${Math.round(duration)} s` : `${IMAGE_SECONDS} s por tela`}
        </span>
      </div>
    </div>
  );
}

/** Faixas que a interface costuma cobrir (Stories) e margem de segurança das bordas. */
export function SafeAreaOverlay({
  safeArea,
  edgeMargin,
  width,
  height,
}: {
  safeArea?: { top: number; bottom: number };
  edgeMargin: number;
  width: number;
  height: number;
}) {
  const m = (edgeMargin * Math.min(width, height)) / width;
  const mv = (edgeMargin * Math.min(width, height)) / height;
  return (
    <div className="pointer-events-none absolute inset-0" data-testid="safe-area-overlay" aria-hidden>
      {safeArea ? (
        <>
          <div
            className="absolute inset-x-0 top-0 flex items-end justify-center bg-rose-500/25 pb-1 text-[10px] font-medium text-white [text-shadow:0_1px_2px_rgb(0_0_0/0.6)]"
            style={{ height: `${safeArea.top * 100}%` }}
          >
            Coberto pela interface (aprox.)
          </div>
          <div
            className="absolute inset-x-0 bottom-0 flex items-start justify-center bg-rose-500/25 pt-1 text-[10px] font-medium text-white [text-shadow:0_1px_2px_rgb(0_0_0/0.6)]"
            style={{ height: `${safeArea.bottom * 100}%` }}
          >
            Coberto pela interface (aprox.)
          </div>
        </>
      ) : null}
      <div
        className="absolute border border-dashed border-sky-400/90"
        style={{ left: `${m * 100}%`, right: `${m * 100}%`, top: `${mv * 100}%`, bottom: `${mv * 100}%` }}
      />
    </div>
  );
}
