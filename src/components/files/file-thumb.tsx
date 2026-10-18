"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { extensionLabel, FileIcon, fileUrl } from "./file-icon";

/** Miniatura gerada no servidor; sem miniatura, mostra ícone e extensão. */
export function FileThumb({
  versionId,
  mimeType,
  name,
  hasThumbnail,
  className,
  rounded = "rounded-lg",
}: {
  versionId: string | null;
  mimeType: string | null;
  name: string;
  hasThumbnail: boolean;
  className?: string;
  rounded?: string;
}) {
  const [failed, setFailed] = useState(false);
  // Sem miniatura (ainda não processada pelo worker), imagens leves usam o original.
  const inlineImage = !!mimeType && /^image\/(png|jpeg|webp|gif|avif)$/.test(mimeType);
  const showImage = versionId && (hasThumbnail || inlineImage) && !failed;
  return (
    <div className={cn("relative flex items-center justify-center overflow-hidden bg-surface-2", rounded, className)}>
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={hasThumbnail ? fileUrl(versionId, { thumb: true }) : fileUrl(versionId)}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className="size-full object-cover"
        />
      ) : (
        <div className="flex flex-col items-center gap-1">
          <FileIcon mime={mimeType} className="size-6" />
          <span className="text-[10px] font-semibold tracking-wide text-fg-subtle">
            {extensionLabel(mimeType, name)}
          </span>
        </div>
      )}
    </div>
  );
}
