"use client";

import { ExternalLink, Eye, Monitor, Smartphone } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ApprovalStatusBadge } from "@/components/approvals/approval-status";
import { ApprovalsPanel } from "@/components/approvals/approvals-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/format";
import type { PortalPreview } from "@/lib/preview-data";
import { defaultPlacement, SOCIAL_SPECS } from "@/lib/social-specs";
import { cn } from "@/lib/utils";
import type { ApprovalRow } from "@/server/services/approvals";
import type { MediaItem } from "./frames";
import { PreviewStage, Thumbnails, VIEW_MODE_LABEL, type Device, type ViewMode } from "./preview-stage";

/**
 * Prévia no portal do cliente: as páginas que a agência compartilhou, na
 * simulação da rede, com a legenda. Aprovar ou pedir ajustes usa o mesmo
 * fluxo dos materiais (uma rodada por arquivo/página).
 */
export function PortalPreviewView({
  data,
  base,
  rounds,
}: {
  data: PortalPreview;
  base: string;
  rounds: Record<string, ApprovalRow[]>;
}) {
  const versions = data.versions;
  const c = data.content;
  const network = c.network;
  const first = data.slides[0];
  const placement =
    c.placement && SOCIAL_SPECS[network].placements[c.placement]
      ? c.placement
      : defaultPlacement(network, {
          contentFormat: c.format,
          pages: data.slides.length,
          width: first?.width ?? 1080,
          height: first?.height ?? 1350,
        });
  const [index, setIndex] = useState(0);
  const [mode, setMode] = useState<ViewMode>("post");
  const [device, setDevice] = useState<Device>("mobile");
  const items: MediaItem[] = data.slides.map((s) => ({
    key: s.key,
    label: s.label,
    src: `/api/files/${s.versionId}`,
    kind: s.mimeType.startsWith("video/") ? "video" : "image",
    width: s.width,
    height: s.height,
  }));
  const current = data.slides[Math.min(index, data.slides.length - 1)]!;
  const statusOf = (fileId: string) => {
    const v = versions[fileId];
    return rounds[fileId]?.find((r) => r.versionId === v?.id && r.stage === "client")?.status ?? null;
  };
  const net = SOCIAL_SPECS[network];

  return (
    <div className="grid gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{c.title}</h1>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-fg-muted">
          <Badge tone="info">
            <Eye className="size-3" aria-hidden /> Simulação
          </Badge>
          <span>
            {net.placements[placement]?.label} · {net.label}
          </span>
          {c.plannedDate ? <span>· planejado para {formatDate(c.plannedDate)}</span> : null}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="Controles da prévia">
        <div
          className="inline-flex gap-0.5 rounded-lg border border-border bg-surface-2 p-0.5"
          role="radiogroup"
          aria-label="Visualização"
        >
          {(["post", "art", "enlarged"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              onClick={() => setMode(m)}
              className={cn(
                "h-7 rounded-md px-2.5 text-[13px] font-medium text-fg-muted hover:text-fg focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none",
                mode === m && "bg-surface text-fg shadow-xs",
              )}
            >
              {VIEW_MODE_LABEL[m]}
            </button>
          ))}
        </div>
        <Button
          size="icon-sm"
          variant={device === "mobile" ? "secondary" : "ghost"}
          aria-pressed={device === "mobile"}
          aria-label="Celular"
          onClick={() => setDevice("mobile")}
        >
          <Smartphone />
        </Button>
        <Button
          size="icon-sm"
          variant={device === "desktop" ? "secondary" : "ghost"}
          aria-pressed={device === "desktop"}
          aria-label="Computador"
          onClick={() => setDevice("desktop")}
        >
          <Monitor />
        </Button>
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-3">
          <section
            className="rounded-xl border border-border bg-surface-2 p-3 sm:p-6"
            aria-label="Prévia"
            data-testid="preview-stage"
          >
            <PreviewStage
              network={network}
              placement={placement}
              items={items}
              index={index}
              onIndex={(i) => setIndex(Math.max(0, i))}
              profile={{ name: data.client.name, avatarUrl: null }}
              caption={c.caption}
              hashtags={c.hashtags}
              cta={c.cta}
              plannedDate={c.plannedDate}
              hasCaption
              mode={mode}
              device={device}
              zoom={1}
              safeArea={false}
              highlight={null}
            />
          </section>
          <Thumbnails items={items} index={index} onIndex={(i) => setIndex(Math.max(0, i))} />
          <p className="text-xs text-fg-muted">
            Simulação ilustrativa: a aparência final depende do aplicativo da rede. Curtidas e comentários não são
            reais.
          </p>
        </div>
        <aside className="grid content-start gap-4 rounded-xl border border-border bg-surface p-4 shadow-xs">
          {data.slides.length > 1 ? (
            <section className="grid gap-2" aria-label="Páginas">
              <h2 className="text-sm font-semibold">Páginas</h2>
              <ul className="grid gap-1.5 text-[13px]">
                {data.slides.map((s, i) => {
                  const st = statusOf(s.fileId);
                  return (
                    <li key={s.key}>
                      <button
                        type="button"
                        onClick={() => setIndex(i)}
                        className={cn(
                          "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left hover:bg-surface-2",
                          i === index && "bg-surface-2 font-medium",
                        )}
                        aria-current={i === index ? "true" : undefined}
                      >
                        <span className="truncate">{s.label}</span>
                        {st ? <ApprovalStatusBadge status={st} /> : <Badge tone="outline">Sem pedido</Badge>}
                      </button>
                    </li>
                  );
                })}
              </ul>
              <p className="text-xs text-fg-muted">Cada página é aprovada separadamente.</p>
            </section>
          ) : null}
          <div className="grid gap-1">
            <p className="text-xs text-fg-muted">{current.label}</p>
            <ApprovalsPanel
              fileId={current.fileId}
              rounds={rounds[current.fileId] ?? []}
              currentVersion={versions[current.fileId] ?? null}
              hasClient
            />
          </div>
          <Button asChild size="sm" variant="ghost" className="justify-self-start">
            <Link href={`${base}/files/${current.fileId}`}>
              Abrir material e comentários <ExternalLink />
            </Link>
          </Button>
        </aside>
      </div>
    </div>
  );
}
