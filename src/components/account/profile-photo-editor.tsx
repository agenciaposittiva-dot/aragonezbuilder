"use client";

import { AlertCircle, Camera, CheckCircle2, RefreshCw, Trash2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import {
  clampCrop,
  LogoCropper,
  toCrop,
  zoomLimits,
  type CropState,
  type SourceImage,
} from "@/components/brand/logo-cropper";
import { loadImage } from "@/components/brand/org-logo-editor";
import { Avatar } from "@/components/ui/avatar";
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
import { ORG_LOGO_ACCEPT, ORG_LOGO_MIN_SIDE } from "@/lib/org-logo";
import { cn } from "@/lib/utils";

type Draft = { file: File; img: SourceImage; crop: CropState };
type Status =
  { kind: "idle" } | { kind: "uploading" } | { kind: "saved"; message: string } | { kind: "error"; message: string };

/** Foto começa preenchendo o círculo (o usuário pode afastar com o zoom). */
function coverCrop(img: SourceImage): CropState {
  return clampCrop(img, { zoom: zoomLimits(img).cover, cx: img.width / 2, cy: img.height / 2 });
}

// "Tirar foto" só onde a câmera costuma estar disponível pelo seletor de arquivos (celular/tablet).
const coarse = "(pointer: coarse)";
function subscribeCoarse(cb: () => void) {
  const mq = window.matchMedia(coarse);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
const isCoarse = () => window.matchMedia(coarse).matches;

/**
 * "Foto de perfil": enviar, tirar (celular), enquadrar com zoom e posição,
 * salvar ou cancelar, alterar e remover. A foto é da pessoa logada; só
 * aparece como salva depois que o servidor gravou o arquivo e o perfil.
 */
export function ProfilePhotoEditor({ name, src, maxBytes }: { name: string; src: string | null; maxBytes: number }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const canCapture = useSyncExternalStore(subscribeCoarse, isCoarse, () => false);
  const [current, setCurrent] = useState(src);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const busy = status.kind === "uploading";

  const [lastSrc, setLastSrc] = useState(src);
  if (lastSrc !== src) {
    setLastSrc(src);
    setCurrent(src);
  }

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
    const body = new FormData();
    body.set("file", draft.file);
    body.set("crop", JSON.stringify(toCrop(draft.img, draft.crop)));
    let error: string;
    try {
      const res = await fetch("/api/user-avatar", { method: "POST", body });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; src?: string; error?: string } | null;
      if (res.ok && json?.ok && json.src) {
        setCurrent(json.src);
        discardDraft();
        setStatus({ kind: "saved", message: "Foto salva" });
        toast.success("Foto de perfil salva");
        router.refresh();
        return;
      }
      error =
        json?.error ??
        (res.status === 413 ? "Imagem grande demais para a foto." : "Não foi possível salvar a foto. Tente novamente.");
    } catch {
      error = "Sem conexão com o servidor. A foto não foi salva; tente novamente.";
    }
    setStatus({ kind: "error", message: error });
    setDialogError(error);
  }

  async function remove() {
    setStatus({ kind: "uploading" });
    try {
      const res = await fetch("/api/user-avatar", { method: "DELETE" });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !json?.ok) throw new Error(json?.error ?? "Não foi possível remover a foto.");
      setCurrent(null);
      setStatus({ kind: "saved", message: "Foto removida" });
      toast.success("Foto de perfil removida");
      router.refresh();
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
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
      {current ? (
        <span className="inline-flex size-24 shrink-0 overflow-hidden rounded-full bg-surface-2 ring-1 ring-border">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={current}
            alt={`Foto de ${name}`}
            className="size-full object-cover"
            data-testid="profile-photo-current"
          />
        </span>
      ) : (
        <span data-testid="profile-photo-placeholder" className="shrink-0">
          <Avatar name={name} size="xl" className="size-24 text-2xl" />
        </span>
      )}

      <div className="grid min-w-0 flex-1 gap-2.5">
        <p className="text-xs text-fg-muted">
          JPG, PNG ou WebP · até {formatBytes(maxBytes)} · mínimo {ORG_LOGO_MIN_SIDE}×{ORG_LOGO_MIN_SIDE} px. A foto é
          enquadrada em um quadrado e aparece redonda no menu, no chat, nos comentários e nas tarefas.
        </p>
        <div className="flex flex-wrap gap-2">
          <PhotoInput ref={input} testId="profile-photo-input" onPick={pick} />
          {canCapture ? <PhotoInput ref={camera} testId="profile-photo-camera" capture="user" onPick={pick} /> : null}
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
              title="Remover a foto de perfil?"
              description="No lugar da foto passam a aparecer as suas iniciais. Você pode enviar outra quando quiser."
              confirmLabel="Remover foto"
              onConfirm={remove}
              trigger={
                <Button type="button" variant="danger-ghost" size="sm" disabled={busy}>
                  <Trash2 /> Remover foto
                </Button>
              }
            />
          ) : null}
        </div>
        <StatusLine status={status} onRetry={draft ? () => void save() : undefined} />
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
            <DialogDescription>
              Arraste para posicionar e use o zoom para enquadrar o rosto no círculo.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            {draft ? (
              <LogoCropper
                variant="avatar"
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
                <span>{dialogError} A foto anterior foi mantida.</span>
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

function StatusLine({ status, onRetry }: { status: Status; onRetry?: () => void }) {
  if (status.kind === "idle") return null;
  return (
    <p
      role={status.kind === "error" ? "alert" : "status"}
      aria-live="polite"
      data-testid="profile-photo-status"
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
