"use client";

import { AlertCircle, CheckCircle2, ImageIcon, RefreshCw, Trash2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { formatBytes } from "@/lib/format";
import {
  ORG_LOGO_ACCEPT,
  ORG_LOGO_MIN_SIDE,
  ORG_LOGO_TYPES,
  type OrgLogoBackground,
  type OrgLogoCrop,
} from "@/lib/org-logo";
import { cn, initials } from "@/lib/utils";
import {
  clampCrop,
  CropPreview,
  initialCrop,
  LogoCropper,
  toCrop,
  type CropState,
  type SourceImage,
} from "./logo-cropper";

/** Logo escolhida e enquadrada, ainda não enviada (ex.: antes de a agência existir). */
export type PendingLogo = {
  file: File;
  img: SourceImage;
  crop: CropState;
  background: OrgLogoBackground;
};

type UploadResult = { ok: true; src: string } | { ok: false; error: string };

/** Envia a logo enquadrada. Só devolve ok depois que o servidor gravou arquivo e banco. */
export async function uploadOrgLogo(
  orgSlug: string,
  logo: { file: File; crop: OrgLogoCrop; background: OrgLogoBackground },
): Promise<UploadResult> {
  const body = new FormData();
  body.set("orgSlug", orgSlug);
  body.set("file", logo.file);
  body.set("crop", JSON.stringify(logo.crop));
  body.set("background", logo.background);
  try {
    const res = await fetch("/api/org-logo", { method: "POST", body });
    const json = (await res.json().catch(() => null)) as { ok?: boolean; src?: string; error?: string } | null;
    if (res.ok && json?.ok && json.src) return { ok: true, src: json.src };
    if (res.status === 413) return { ok: false, error: json?.error ?? "Imagem grande demais para a logo." };
    return { ok: false, error: json?.error ?? "Não foi possível salvar a logo. Tente novamente." };
  } catch {
    return { ok: false, error: "Sem conexão com o servidor. A logo não foi salva; tente novamente." };
  }
}

/** Abre a imagem no navegador para medir e validar antes de enquadrar. */
function loadImage(file: File, maxBytes: number): Promise<SourceImage> {
  return new Promise((resolve, reject) => {
    const typeOk = (ORG_LOGO_TYPES as readonly string[]).includes(file.type) || /\.(png|jpe?g|webp)$/i.test(file.name);
    if (!typeOk) return reject(new Error("Formato não aceito. Use PNG (recomendado), JPG ou WebP."));
    if (file.size > maxBytes) {
      return reject(new Error(`A imagem tem ${formatBytes(file.size)}; o limite é ${formatBytes(maxBytes)}.`));
    }
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const { naturalWidth: width, naturalHeight: height } = image;
      if (Math.min(width, height) < ORG_LOGO_MIN_SIDE) {
        URL.revokeObjectURL(url);
        reject(
          new Error(`A imagem tem ${width}×${height} px; o mínimo é ${ORG_LOGO_MIN_SIDE}×${ORG_LOGO_MIN_SIDE} px.`),
        );
        return;
      }
      resolve({ url, width, height });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(
        new Error("Não foi possível abrir a imagem. O arquivo pode estar corrompido ou não ser PNG, JPG ou WebP."),
      );
    };
    image.src = url;
  });
}

type Status =
  { kind: "idle" } | { kind: "uploading" } | { kind: "saved"; message: string } | { kind: "error"; message: string };

/**
 * Área "Logo da agência": enviar, enquadrar (arrastar + zoom), confirmar ou
 * cancelar, substituir e remover. No modo `immediate` grava no servidor ao
 * confirmar; no modo `deferred` só devolve a escolha (o envio acontece
 * depois, por exemplo quando a agência acabou de ser criada).
 */
export function OrgLogoEditor({
  orgName,
  src,
  maxBytes,
  mode = "immediate",
  orgSlug,
  canEdit = true,
  pending,
  onPendingChange,
}: {
  orgName: string;
  src: string | null;
  maxBytes: number;
  mode?: "immediate" | "deferred";
  orgSlug?: string;
  canEdit?: boolean;
  pending?: PendingLogo | null;
  onPendingChange?: (logo: PendingLogo | null) => void;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [current, setCurrent] = useState(src);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [draft, setDraft] = useState<PendingLogo | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const uploading = status.kind === "uploading";

  // Nova logo vinda do servidor (após router.refresh): passa a ser a atual.
  const [lastSrc, setLastSrc] = useState(src);
  if (lastSrc !== src) {
    setLastSrc(src);
    setCurrent(src);
  }

  /** Fecha o enquadramento e libera a imagem da memória (se ela não virou a escolha pendente). */
  function discardDraft() {
    if (draft && draft.img.url !== pending?.img.url) URL.revokeObjectURL(draft.img.url);
    setDraft(null);
    setDialogError(null);
  }

  async function pick(file: File) {
    setDialogError(null);
    try {
      const img = await loadImage(file, maxBytes);
      setDraft({ file, img, crop: initialCrop(img), background: "transparent" });
      if (status.kind !== "uploading") setStatus({ kind: "idle" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Imagem inválida.";
      setStatus({ kind: "error", message });
      toast.error(message);
    }
  }

  async function confirm() {
    if (!draft || uploading) return;
    if (mode === "deferred") {
      if (pending && pending.img.url !== draft.img.url) URL.revokeObjectURL(pending.img.url);
      onPendingChange?.(draft);
      setDraft(null);
      return;
    }
    if (!orgSlug) return;
    setStatus({ kind: "uploading" });
    setDialogError(null);
    const res = await uploadOrgLogo(orgSlug, {
      file: draft.file,
      crop: toCrop(draft.img, draft.crop),
      background: draft.background,
    });
    if (res.ok) {
      setCurrent(res.src);
      discardDraft();
      setStatus({ kind: "saved", message: "Logo salva" });
      toast.success("Logo salva");
      router.refresh();
    } else {
      setStatus({ kind: "error", message: res.error });
      setDialogError(res.error);
    }
  }

  async function remove() {
    if (mode === "deferred") {
      if (pending) URL.revokeObjectURL(pending.img.url);
      onPendingChange?.(null);
      return;
    }
    if (!orgSlug) return;
    setStatus({ kind: "uploading" });
    try {
      const res = await fetch(`/api/org-logo?org=${encodeURIComponent(orgSlug)}`, { method: "DELETE" });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !json?.ok) throw new Error(json?.error ?? "Não foi possível remover a logo.");
      setCurrent(null);
      setStatus({ kind: "saved", message: "Logo removida" });
      toast.success("Logo removida");
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Não foi possível remover a logo.";
      setStatus({ kind: "error", message });
      toast.error(message);
    }
  }

  const shown = mode === "deferred" ? null : current;
  const has = mode === "deferred" ? !!pending : !!current;

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
      <div className="flex items-end gap-3">
        {mode === "deferred" && pending ? (
          <CropPreview
            img={pending.img}
            crop={pending.crop}
            background={pending.background}
            size={96}
            className="rounded-xl"
          />
        ) : shown ? (
          <span className="inline-flex size-24 shrink-0 overflow-hidden rounded-xl bg-white ring-1 ring-black/10">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={shown}
              alt={`Logo de ${orgName}`}
              className="size-full object-contain"
              data-testid="org-logo-current"
            />
          </span>
        ) : (
          <span
            className="inline-flex size-24 shrink-0 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border-strong bg-surface-2 text-fg-subtle"
            data-testid="org-logo-placeholder"
          >
            {orgName.trim() ? (
              <span className="text-xl font-semibold text-fg-muted">{initials(orgName)}</span>
            ) : (
              <ImageIcon className="size-6" />
            )}
            <span className="text-[10px]">Sem logo</span>
          </span>
        )}
      </div>

      <div className="grid min-w-0 flex-1 gap-2.5">
        <p className="text-xs text-fg-muted">
          PNG com fundo transparente (recomendado), JPG ou WebP · até {formatBytes(maxBytes)} · mínimo{" "}
          {ORG_LOGO_MIN_SIDE}×{ORG_LOGO_MIN_SIDE} px. A logo é enquadrada em um quadrado.
        </p>
        {canEdit ? (
          <div className="flex flex-wrap gap-2">
            <input
              ref={input}
              type="file"
              accept={ORG_LOGO_ACCEPT}
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              data-testid="org-logo-input"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void pick(file);
              }}
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={uploading}
              onClick={() => input.current?.click()}
            >
              {has ? <RefreshCw /> : <Upload />}
              {has ? "Alterar logo" : "Enviar logo"}
            </Button>
            {has ? (
              mode === "deferred" ? (
                <Button
                  type="button"
                  variant="danger-ghost"
                  size="sm"
                  disabled={uploading}
                  onClick={() => void remove()}
                >
                  <Trash2 /> Remover logo
                </Button>
              ) : (
                <ConfirmDialog
                  title="Remover a logo da agência?"
                  description={`A logo deixa de aparecer no menu, no seletor de agências e nos demais lugares. Os dados de ${orgName} não são alterados. Você pode enviar outra logo quando quiser.`}
                  confirmLabel="Remover logo"
                  onConfirm={remove}
                  trigger={
                    <Button type="button" variant="danger-ghost" size="sm" disabled={uploading}>
                      <Trash2 /> Remover logo
                    </Button>
                  }
                />
              )
            ) : null}
          </div>
        ) : (
          <p className="text-xs text-fg-subtle">Só quem gerencia a agência pode alterar a logo.</p>
        )}
        <StatusLine status={status} onRetry={draft ? () => void confirm() : undefined} />
      </div>

      <Dialog
        open={!!draft}
        onOpenChange={(open) => {
          if (!open && !uploading) {
            discardDraft();
            if (status.kind === "error") setStatus({ kind: "idle" });
          }
        }}
      >
        <DialogContent size="md" onInteractOutside={(e) => uploading && e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>Ajustar logo</DialogTitle>
            <DialogDescription>
              Arraste para posicionar e use o zoom para centralizar a marca no quadrado.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            {draft ? (
              <LogoCropper
                img={draft.img}
                crop={draft.crop}
                onCropChange={(crop) => setDraft((d) => (d ? { ...d, crop: clampCrop(d.img, crop) } : d))}
                background={draft.background}
                onBackgroundChange={(background) => setDraft((d) => (d ? { ...d, background } : d))}
                disabled={uploading}
              />
            ) : null}
            {dialogError ? (
              <p
                role="alert"
                className="mt-4 flex items-start gap-2 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger"
              >
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                <span>{dialogError} A logo anterior foi mantida.</span>
              </p>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              disabled={uploading}
              onClick={() => {
                discardDraft();
                if (status.kind === "error") setStatus({ kind: "idle" });
              }}
            >
              Cancelar
            </Button>
            <Button type="button" variant="primary" loading={uploading} onClick={() => void confirm()}>
              {uploading ? "Enviando…" : mode === "deferred" ? "Usar esta logo" : "Confirmar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatusLine({ status, onRetry }: { status: Status; onRetry?: () => void }) {
  if (status.kind === "idle") return null;
  return (
    <p
      role={status.kind === "error" ? "alert" : "status"}
      aria-live="polite"
      data-testid="org-logo-status"
      className={cn(
        "flex items-center gap-1.5 text-xs",
        status.kind === "error" ? "text-danger" : status.kind === "saved" ? "text-success" : "text-fg-muted",
      )}
    >
      {status.kind === "uploading" ? <Spinner className="size-3.5" /> : null}
      {status.kind === "saved" ? <CheckCircle2 className="size-3.5" /> : null}
      {status.kind === "error" ? <AlertCircle className="size-3.5" /> : null}
      {status.kind === "uploading" ? "Enviando…" : status.message}
      {status.kind === "error" && onRetry ? (
        <button type="button" className="ml-1 font-medium underline underline-offset-2" onClick={onRetry}>
          Tentar de novo
        </button>
      ) : null}
    </p>
  );
}
