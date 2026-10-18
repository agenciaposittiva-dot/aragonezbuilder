"use client";

import { Download, Maximize2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { extensionLabel, FileIcon, fileUrl } from "./file-icon";

const INLINE_IMAGE = /^image\/(png|jpeg|gif|webp|avif)$/;

/** Pré-visualização conforme o tipo: imagem, PDF, vídeo, áudio ou ícone. */
export function FilePreview({ versionId, mimeType, name }: { versionId: string; mimeType: string; name: string }) {
  const [zoom, setZoom] = useState(false);
  const src = fileUrl(versionId);

  let body: React.ReactNode;
  if (INLINE_IMAGE.test(mimeType)) {
    body = (
      <button
        type="button"
        onClick={() => setZoom(true)}
        className="group relative flex size-full items-center justify-center"
        aria-label="Ampliar imagem"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={name} className="max-h-[70vh] max-w-full object-contain" />
        <span className="absolute top-3 right-3 rounded-md bg-surface/90 p-1.5 text-fg-muted opacity-0 shadow-xs transition-opacity group-hover:opacity-100">
          <Maximize2 className="size-4" />
        </span>
      </button>
    );
  } else if (mimeType === "application/pdf") {
    body = (
      <iframe
        src={src}
        title={`Pré-visualização de ${name}`}
        className="h-[70vh] w-full rounded-lg border-0 bg-white"
      />
    );
  } else if (mimeType.startsWith("video/")) {
    body = (
      <video src={src} controls preload="metadata" className="max-h-[70vh] w-full rounded-lg bg-black">
        <track kind="captions" />
      </video>
    );
  } else if (mimeType.startsWith("audio/")) {
    body = (
      <div className="flex w-full flex-col items-center gap-4 p-8">
        <FileIcon mime={mimeType} className="size-10" />
        <audio src={src} controls preload="metadata" className="w-full max-w-md" />
      </div>
    );
  } else {
    body = (
      <div className="flex flex-col items-center gap-3 p-10 text-center">
        <div className="flex size-16 items-center justify-center rounded-2xl border border-border bg-surface">
          <FileIcon mime={mimeType} className="size-7" />
        </div>
        <p className="text-sm font-medium">{extensionLabel(mimeType, name)}</p>
        <p className="max-w-xs text-xs text-fg-muted">
          Pré-visualização indisponível para este tipo. Baixe o arquivo para abrir.
        </p>
        <Button asChild variant="secondary" size="sm">
          <a href={fileUrl(versionId, { download: true })}>
            <Download /> Baixar
          </a>
        </Button>
      </div>
    );
  }

  return (
    <>
      <div className="flex min-h-64 items-center justify-center overflow-hidden rounded-xl border border-border bg-[repeating-conic-gradient(var(--surface-2)_0%_25%,var(--surface)_0%_50%)] bg-[length:20px_20px] p-2">
        {body}
      </div>
      <Dialog open={zoom} onOpenChange={setZoom}>
        <DialogContent size="xl" className="max-w-[min(96vw,1400px)] bg-surface p-2">
          <DialogTitle className="sr-only">{name}</DialogTitle>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={name} className="max-h-[88vh] w-full object-contain" />
        </DialogContent>
      </Dialog>
    </>
  );
}
