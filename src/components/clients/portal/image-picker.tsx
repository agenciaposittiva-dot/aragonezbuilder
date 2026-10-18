"use client";

import { ImageIcon, Images, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";

export type PortalImageOption = {
  id: string;
  name: string;
  versionId: string;
  width: number | null;
  height: number | null;
};

const ACCEPTED = ["image/png", "image/jpeg", "image/webp"];

/** URL autenticada (equipe) da versão atual de uma imagem do cliente. */
export const imageVersionUrl = (versionId: string) => `/api/files/${versionId}`;

type UploadResponse = {
  ok: boolean;
  error?: string;
  results?: { ok: boolean; fileId?: string; versionId?: string; error?: string }[];
};

/**
 * Escolha de imagem da marca: envia um arquivo novo (PNG, JPEG ou WebP) para
 * a biblioteca do cliente ou reaproveita uma imagem existente. Sem imagem,
 * mostra um espaço reservado (nunca uma imagem quebrada).
 */
export function ImagePicker({
  id,
  label,
  recommendation,
  value,
  onChange,
  images,
  onUploaded,
  orgSlug,
  clientId,
  category,
  maxBytes,
  aspect = "aspect-[3/1]",
  contain,
  disabled,
  canUpload,
  error,
}: {
  id: string;
  label: string;
  recommendation: string;
  value: string | null;
  onChange: (fileId: string | null) => void;
  images: PortalImageOption[];
  onUploaded: (img: PortalImageOption) => void;
  orgSlug: string;
  clientId: string;
  category: "brand_logo" | "brand_asset";
  maxBytes: number;
  aspect?: string;
  /** Logotipos: mostrar inteiro, sem recorte. */
  contain?: boolean;
  disabled?: boolean;
  canUpload: boolean;
  error?: string | string[];
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const current = value ? images.find((i) => i.id === value) : null;

  async function upload(file: File) {
    if (!ACCEPTED.includes(file.type)) {
      toast.error("Use uma imagem PNG, JPEG ou WebP.");
      return;
    }
    if (file.size > maxBytes) {
      toast.error(`A imagem tem ${formatBytes(file.size)}; o limite é ${formatBytes(maxBytes)}.`);
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      form.set("orgSlug", orgSlug);
      form.set("clientId", clientId);
      form.set("category", category);
      form.set("tags", "portal");
      form.append("file", file, file.name);
      const res = await fetch("/api/uploads", { method: "POST", body: form });
      const data = (await res.json().catch(() => ({}))) as UploadResponse;
      const result = data.results?.[0];
      if (!res.ok || !result?.ok || !result.fileId || !result.versionId) {
        toast.error(result?.error ?? data.error ?? "Não foi possível enviar a imagem.");
        return;
      }
      const dims = await readDimensions(file);
      onUploaded({ id: result.fileId, name: file.name, versionId: result.versionId, ...dims });
      onChange(result.fileId);
      toast.success("Imagem enviada");
    } catch {
      toast.error("Falha de conexão ao enviar a imagem.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  const message = Array.isArray(error) ? error[0] : error;
  return (
    <div className="grid content-start gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div
        className={cn(
          "relative overflow-hidden rounded-lg border border-border bg-surface-2",
          aspect,
          contain && "bg-[repeating-conic-gradient(var(--surface-2)_0_25%,var(--surface)_0_50%)] bg-[length:16px_16px]",
        )}
      >
        {current ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageVersionUrl(current.versionId)}
            alt={current.name}
            className={cn("absolute inset-0 size-full", contain ? "object-contain p-3" : "object-cover")}
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-fg-subtle">
            <ImageIcon className="size-5" aria-hidden="true" />
            <span className="text-xs">{value ? "Imagem indisponível" : "Sem imagem"}</span>
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <input
          ref={input}
          id={id}
          type="file"
          accept={ACCEPTED.join(",")}
          className="sr-only"
          disabled={disabled || busy || !canUpload}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
          }}
        />
        {canUpload ? (
          <Button type="button" size="sm" loading={busy} disabled={disabled} onClick={() => input.current?.click()}>
            <Upload /> {current ? "Substituir" : "Enviar"}
          </Button>
        ) : null}
        <Popover>
          <PopoverTrigger asChild>
            <Button type="button" size="sm" disabled={disabled || images.length === 0}>
              <Images /> Biblioteca
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80 p-2" align="start">
            <p className="px-1 pb-2 text-xs text-fg-muted">Imagens deste cliente (PNG, JPEG ou WebP)</p>
            <ul className="grid max-h-72 grid-cols-3 gap-2 overflow-y-auto">
              {images.map((img) => (
                <li key={img.id}>
                  <PopoverClose asChild>
                    <button
                      type="button"
                      title={img.name}
                      onClick={() => onChange(img.id)}
                      className={cn(
                        "relative block aspect-square w-full overflow-hidden rounded-md border border-border bg-surface-2 hover:ring-2 hover:ring-[var(--ring)]",
                        img.id === value && "ring-2 ring-accent",
                      )}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={imageVersionUrl(img.versionId)} alt="" className="size-full object-cover" />
                    </button>
                  </PopoverClose>
                </li>
              ))}
            </ul>
          </PopoverContent>
        </Popover>
        {value ? (
          <Button type="button" size="sm" variant="danger-ghost" disabled={disabled} onClick={() => onChange(null)}>
            <Trash2 /> Remover
          </Button>
        ) : null}
      </div>
      {message ? (
        <p className="text-xs text-danger" role="alert">
          {message}
        </p>
      ) : (
        <p className="text-xs text-fg-subtle">
          {recommendation}
          {current?.width && current.height ? ` · atual: ${current.width}×${current.height}` : ""}
        </p>
      )}
    </div>
  );
}

function readDimensions(file: File): Promise<{ width: number | null; height: number | null }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      resolve({ width: null, height: null });
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });
}
