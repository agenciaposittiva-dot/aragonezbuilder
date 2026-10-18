"use client";

import { AlertCircle, Camera, CheckCircle2, RefreshCw, Trash2, Upload } from "lucide-react";
import { useRef, useState, useSyncExternalStore } from "react";
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
import { ORG_LOGO_ACCEPT, ORG_LOGO_MIN_SIDE, type OrgLogoCrop } from "@/lib/org-logo";
import { cn } from "@/lib/utils";
import { clampCrop, LogoCropper, toCrop, zoomLimits, type CropState, type SourceImage } from "./logo-cropper";
import { loadImage } from "./org-logo-editor";

type Draft = { file: File; img: SourceImage; crop: CropState };
type Status =
  { kind: "idle" } | { kind: "uploading" } | { kind: "saved"; message: string } | { kind: "error"; message: string };

export type PhotoUploadResult = { ok: true; src: string } | { ok: false; error: string };

/** Foto começa preenchendo o quadro (o usuário pode afastar com o zoom). */
function coverCrop(img: SourceImage): CropState {
  return clampCrop(img, { zoom: zoomLimits(img).cover, cx: img.width / 2, cy: img.height / 2 });
}

/** Envia multipart e só devolve ok depois que o servidor confirmou a gravação. */
export async function postPhoto(
  url: string,
  fields: Record<string, string>,
  file: File,
  crop: OrgLogoCrop,
  tooBig: string,
): Promise<PhotoUploadResult> {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  body.set("file", file);
  body.set("crop", JSON.stringify(crop));
  try {
    const res = await fetch(url, { method: "POST", body });
    const json = (await res.json().catch(() => null)) as {
      ok?: boolean;
      src?: string;
      data?: { src?: string };
      error?: string;
    } | null;
    const src = json?.src ?? json?.data?.src;
    if (res.ok && json?.ok && src) return { ok: true, src };
    return {
      ok: false,
      error: json?.error ?? (res.status === 413 ? tooBig : "Não foi possível salvar a foto. Tente novamente."),
    };
  } catch {
    return { ok: false, error: "Sem conexão com o servidor. A foto não foi salva; tente novamente." };
  }
}

// "Tirar foto" só onde a câmera costuma estar disponível pelo seletor de arquivos (celular/tablet).
const coarse = "(pointer: coarse)";
function subscribeCoarse(cb: () => void) {
  const mq = window.matchMedia(coarse);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
const isCoarse = () => window.matchMedia(coarse).matches;

export type PhotoEditorLabels = {
  saved: string;
  /** Frase mostrada quando o envio falha ("A foto anterior foi mantida."). */
  kept: string;
  removed: string;
  removeTitle: string;
  removeDescription: string;
  dialogDescription: string;
  /** Onde a foto aparece (vai na dica de formatos). */
  where: string;
};

/**
 * Enviar, tirar (celular), enquadrar com zoom e posição, salvar ou cancelar,
 * alterar e remover uma foto quadrada. Usado pela foto de perfil e pela foto
 * dos grupos do chat. Só mostra "salva" depois que o servidor confirmou.
 */
export function PhotoEditor({
  current,
  placeholder,
  alt,
  maxBytes,
  labels,
  variant,
  testId,
  layout = "row",
  upload,
  remove,
  onChange,
}: {
  current: string | null;
  placeholder: React.ReactNode;
  alt: string;
  maxBytes: number;
  labels: PhotoEditorLabels;
  variant: "avatar" | "group";
  /** Prefixo dos data-testid (profile-photo, group-photo…). */
  testId: string;
  layout?: "row" | "stack";
  upload: (file: File, crop: OrgLogoCrop) => Promise<PhotoUploadResult>;
  /** Lança erro com mensagem se não conseguir remover. */
  remove: () => Promise<void>;
  onChange: (src: string | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const canCapture = useSyncExternalStore(subscribeCoarse, isCoarse, () => false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const busy = status.kind === "uploading";
  const round = variant === "avatar";

  function discardDraft() {
    if (draft) URL.revokeObjectURL(draft.img.url);
    setDraft(null);
    setDialogError(null);
  }

  async function pick(file: File) {
    setDialogError(null);
    try {
      const img = await loadImage(file, maxBytes);
      setDraft({ file, img, crop: coverCrop(img) });
      setStatus({ kind: "idle" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Imagem inválida.";
      setStatus({ kind: "error", message });
      toast.error(message);
    }
  }

  async function save() {
    if (!draft || busy) return;
    setStatus({ kind: "uploading" });
    setDialogError(null);
    const res = await upload(draft.file, toCrop(draft.img, draft.crop));
    if (res.ok) {
      discardDraft();
      setStatus({ kind: "saved", message: labels.saved });
      toast.success(labels.saved);
      onChange(res.src);
      return;
    }
    setStatus({ kind: "error", message: res.error });
    setDialogError(res.error);
  }

  async function removeNow() {
    setStatus({ kind: "uploading" });
    try {
      await remove();
      setStatus({ kind: "saved", message: labels.removed });
      toast.success(labels.removed);
      onChange(null);
    } catch (err) {
      const message =
        err instanceof TypeError
          ? "Sem conexão com o servidor. A foto não foi removida."
          : err instanceof Error
            ? err.message
            : "Não foi possível remover a foto.";
      setStatus({ kind: "error", message });
      toast.error(message);
    }
  }

  return (
    <div className={cn("flex flex-col gap-4", layout === "row" && "sm:flex-row sm:items-center")}>
      {current ? (
        <span
          className={cn(
            "inline-flex size-24 shrink-0 overflow-hidden bg-surface-2 ring-1 ring-border",
            round ? "rounded-full" : "rounded-xl",
          )}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={current} alt={alt} className="size-full object-cover" data-testid={`${testId}-current`} />
        </span>
      ) : (
        <span data-testid={`${testId}-placeholder`} className="shrink-0">
          {placeholder}
        </span>
      )}

      <div className="grid min-w-0 flex-1 gap-2.5">
        <p className="text-xs text-fg-muted">
          JPG, PNG ou WebP · até {formatBytes(maxBytes)} · mínimo {ORG_LOGO_MIN_SIDE}×{ORG_LOGO_MIN_SIDE} px.{" "}
          {labels.where}
        </p>
        <div className="flex flex-wrap gap-2">
          <PhotoInput ref={input} testId={`${testId}-input`} onPick={pick} />
          {canCapture ? <PhotoInput ref={camera} testId={`${testId}-camera`} capture="user" onPick={pick} /> : null}
          <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => input.current?.click()}>
            {current ? <RefreshCw /> : <Upload />}
            {current ? "Alterar foto" : "Enviar foto"}
          </Button>
          {canCapture ? (
            <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => camera.current?.click()}>
              <Camera /> Tirar foto
            </Button>
          ) : null}
          {current ? (
            <ConfirmDialog
              title={labels.removeTitle}
              description={labels.removeDescription}
              confirmLabel="Remover foto"
              onConfirm={removeNow}
              trigger={
                <Button type="button" variant="danger-ghost" size="sm" disabled={busy}>
                  <Trash2 /> Remover foto
                </Button>
              }
            />
          ) : null}
        </div>
        <StatusLine status={status} testId={`${testId}-status`} onRetry={draft ? () => void save() : undefined} />
      </div>

      <Dialog
        open={!!draft}
        onOpenChange={(open) => {
          if (!open && !busy) {
            discardDraft();
            if (status.kind === "error") setStatus({ kind: "idle" });
          }
        }}
      >
        <DialogContent size="md" onInteractOutside={(e) => busy && e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>Ajustar foto</DialogTitle>
            <DialogDescription>{labels.dialogDescription}</DialogDescription>
          </DialogHeader>
          <DialogBody>
            {draft ? (
              <LogoCropper
                variant={variant}
                img={draft.img}
                crop={draft.crop}
                onCropChange={(crop) => setDraft((d) => (d ? { ...d, crop: clampCrop(d.img, crop) } : d))}
                background="transparent"
                onBackgroundChange={() => {}}
                disabled={busy}
              />
            ) : null}
            {dialogError ? (
              <p
                role="alert"
                className="mt-4 flex items-start gap-2 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger"
              >
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                <span>
                  {dialogError} {labels.kept}
                </span>
              </p>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => {
                discardDraft();
                if (status.kind === "error") setStatus({ kind: "idle" });
              }}
            >
              Cancelar
            </Button>
            <Button type="button" variant="primary" loading={busy} onClick={() => void save()}>
              {busy ? "Enviando…" : "Salvar foto"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PhotoInput({
  ref,
  testId,
  capture,
  onPick,
}: {
  ref: React.Ref<HTMLInputElement>;
  testId: string;
  capture?: "user";
  onPick: (file: File) => Promise<void>;
}) {
  return (
    <input
      ref={ref}
      type="file"
      accept={ORG_LOGO_ACCEPT}
      capture={capture}
      className="sr-only"
      tabIndex={-1}
      aria-hidden="true"
      data-testid={testId}
      onChange={(e) => {
        const file = e.target.files?.[0];
        e.target.value = "";
        if (file) void onPick(file);
      }}
    />
  );
}

function StatusLine({ status, testId, onRetry }: { status: Status; testId: string; onRetry?: () => void }) {
  if (status.kind === "idle") return null;
  return (
    <p
      role={status.kind === "error" ? "alert" : "status"}
      aria-live="polite"
      data-testid={testId}
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
