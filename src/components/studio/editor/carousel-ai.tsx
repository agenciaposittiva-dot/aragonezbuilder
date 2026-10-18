"use client";

import { AlertTriangle, Copy, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/input";
import { fontsOf, SLIDE_ROLE_LABEL, type DesignOp } from "@/lib/design-doc";
import {
  carouselVariantAction,
  regenerateCarouselSlideAction,
  restyleCarouselAction,
} from "@/server/actions/carousel-generator";
import { ensureFonts } from "./fonts";
import { useEditor, type EditorStore } from "./store";

export type CarouselAiMode = "slide" | "direction" | "variant" | "plan";

const needsConfirm = (r: { ok: boolean; code?: string; error?: string }) =>
  !r.ok && r.code === "conflict" && /Confirme para continuar/.test(r.error ?? "");

/**
 * Ações do gerador de carrosséis dentro do editor. O servidor grava uma versão
 * "Antes de…" e aplica as operações com controle de revisão; o editor aplica
 * as mesmas operações localmente (entram no desfazer) e passa a usar a nova
 * revisão — nada é perdido nem salvo duas vezes.
 */
export function CarouselAiDialog({
  mode,
  onClose,
  store,
  designId,
  orgSlug,
  getRevision,
  setRevision,
  flush,
}: {
  mode: CarouselAiMode | null;
  onClose: () => void;
  store: EditorStore;
  designId: string;
  orgSlug: string;
  getRevision: () => number;
  setRevision: (r: number) => void;
  /** Garante que o servidor tem o estado atual antes de alterar (false = não continuar). */
  flush: () => Promise<boolean>;
}) {
  const router = useRouter();
  const meta = useEditor(store, (s) => s.doc.meta?.generator ?? null);
  const activePageId = useEditor(store, (s) => s.activePageId);
  const [instruction, setInstruction] = useState("");
  const [keepImage, setKeepImage] = useState(true);
  const [busy, setBusy] = useState(false);
  const [costPrompt, setCostPrompt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!meta) return null;
  const slideIndex = meta.slides.findIndex((s) => s.pageId === activePageId);
  const slide = slideIndex >= 0 ? meta.slides[slideIndex] : null;

  const apply = (ops: DesignOp[], revision: number, label: string) => {
    // Mesmo lote que o servidor aplicou sobre o mesmo documento: sem novo salvamento.
    store.dispatch(ops, { label, reason: "silent" });
    setRevision(revision);
    // Fontes novas (outra direção visual): mede e desenha de novo quando carregarem.
    const families = fontsOf(store.doc);
    void ensureFonts(families).then(() => store.scene?.refreshFonts(families));
  };

  const close = () => {
    setCostPrompt(null);
    setError(null);
    setInstruction("");
    onClose();
  };

  async function run(confirmCost = false) {
    setError(null);
    setCostPrompt(null);
    if (!(await flush())) return;
    setBusy(true);
    try {
      if (mode === "slide" && slide) {
        const res = await regenerateCarouselSlideAction(orgSlug, {
          designId,
          revision: getRevision(),
          pageId: slide.pageId,
          instruction: instruction.trim() || undefined,
          keepImage,
          confirmCost,
        });
        if (needsConfirm(res)) return setCostPrompt((res as { error: string }).error);
        if (!res.ok) return setError(res.error);
        apply(res.data.ops, res.data.revision, `Regenerar slide ${slideIndex + 1}`);
        if (res.data.notice) toast.warning(res.data.notice);
        toast.success(`Slide ${slideIndex + 1} regenerado. A versão anterior ficou no histórico.`);
        close();
      } else if (mode === "direction") {
        const res = await restyleCarouselAction(orgSlug, { designId, revision: getRevision() });
        if (!res.ok) return setError(res.error);
        apply(res.data.ops, res.data.revision, "Nova direção visual");
        toast.success(`Nova direção visual: ${res.data.direction}. A anterior ficou no histórico.`);
        close();
      } else if (mode === "variant") {
        const res = await carouselVariantAction(orgSlug, { designId });
        if (!res.ok) return setError(res.error);
        toast.success("Segunda versão criada. Abrindo…");
        close();
        router.push(`/w/${orgSlug}/studio/${res.data.id}`);
      }
    } finally {
      setBusy(false);
    }
  }

  const titles: Record<CarouselAiMode, [string, string]> = {
    slide: [
      "Regenerar este slide",
      "A IA reescreve o texto e refaz a composição deste slide, mantendo a continuidade do carrossel.",
    ],
    direction: [
      "Nova direção visual",
      "Troca estilo, tipografia, composição e elemento de continuidade. Os textos (inclusive os que você editou) e as imagens ficam.",
    ],
    variant: [
      "Gerar segunda versão",
      "Cria uma arte nova com os mesmos textos e outra composição em cada slide. Esta arte não muda.",
    ],
    plan: ["Plano do carrossel", "Roteiro, direção de arte e dados que precisam de confirmação antes de publicar."],
  };
  const [title, description] = mode ? titles[mode] : ["", ""];

  return (
    <Dialog open={!!mode} onOpenChange={(v) => (!v ? close() : undefined)}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-4 text-sm">
          {mode === "slide" ? (
            slide ? (
              <>
                <p>
                  <span className="text-fg-muted">
                    Slide {slideIndex + 1} · {SLIDE_ROLE_LABEL[slide.role]}:
                  </span>{" "}
                  {slide.title}
                </p>
                <Field
                  label="Pedido de ajuste (opcional)"
                  htmlFor="cg-instruction"
                  hint="Ex.: mais curto, mais direto, foque no benefício."
                >
                  <Textarea
                    id="cg-instruction"
                    value={instruction}
                    onChange={(e) => setInstruction(e.target.value)}
                    rows={3}
                    maxLength={500}
                    disabled={busy}
                  />
                </Field>
                {slide.visual.image ? (
                  <label className="flex items-center gap-2">
                    <Checkbox
                      checked={keepImage}
                      onCheckedChange={(v) => setKeepImage(v === true)}
                      aria-label="Manter a imagem"
                    />
                    Manter a imagem do slide
                  </label>
                ) : null}
                <p className="text-xs text-fg-muted">
                  Usa a IA padrão do módulo Carrosséis (Configurações → Inteligência artificial).
                </p>
              </>
            ) : (
              <p className="text-fg-muted">Esta página não foi criada pelo gerador. Selecione um slide gerado.</p>
            )
          ) : null}
          {mode === "plan" ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{meta.plan.title}</span>
                {meta.ai.demo ? <Badge tone="warning">Demonstração</Badge> : null}
                <Badge>{meta.visuals === "images" ? "Com imagens" : "Somente vetores"}</Badge>
                <Badge tone="outline">Versão {meta.version}</Badge>
              </div>
              <p className="text-fg-muted">Direção de arte: {meta.direction.name}</p>
              {meta.direction.notes.length ? (
                <ul className="grid gap-1 text-xs text-fg-muted">
                  {meta.direction.notes.map((n) => (
                    <li key={n}>• {n}</li>
                  ))}
                </ul>
              ) : null}
              <section className="grid gap-1.5" data-testid="carousel-claims">
                <h3 className="font-medium">Dados a confirmar antes de publicar</h3>
                {meta.claims.length ? (
                  <ul className="grid gap-1.5">
                    {meta.claims.map((c, i) => (
                      <li key={i} className="rounded-md bg-warning-soft p-2 text-xs">
                        <span className="font-medium">{c.text}</span>
                        <span className="block text-fg-muted">{c.reason}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-fg-muted">Nenhum dado numérico ou afirmação a confirmar foi encontrado.</p>
                )}
              </section>
              {meta.warnings.length ? (
                <ul className="grid gap-1 text-xs text-warning">
                  {meta.warnings.map((w) => (
                    <li key={w} className="flex gap-1.5">
                      <AlertTriangle className="mt-0.5 size-3 shrink-0" /> {w}
                    </li>
                  ))}
                </ul>
              ) : null}
              <section className="grid gap-1.5">
                <h3 className="font-medium">Roteiro</h3>
                <ol className="grid gap-1 text-xs">
                  {meta.slides.map((s, i) => (
                    <li key={s.key}>
                      {i + 1}. <span className="text-fg-muted">{SLIDE_ROLE_LABEL[s.role]}</span> — {s.title}
                    </li>
                  ))}
                </ol>
              </section>
              {meta.plan.caption ? (
                <section className="grid gap-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-medium">Legenda sugerida</h3>
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() =>
                        void navigator.clipboard
                          .writeText([meta.plan.caption, meta.plan.hashtags.join(" ")].filter(Boolean).join("\n\n"))
                          .then(() => toast.success("Legenda copiada"))
                      }
                    >
                      <Copy /> Copiar
                    </Button>
                  </div>
                  <p className="text-xs whitespace-pre-wrap">{meta.plan.caption}</p>
                  {meta.plan.hashtags.length ? (
                    <p className="text-xs text-fg-muted">{meta.plan.hashtags.join(" ")}</p>
                  ) : null}
                </section>
              ) : null}
            </>
          ) : null}
          {costPrompt ? (
            <div
              role="alert"
              className="flex flex-col gap-2 rounded-lg bg-warning-soft p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <span>{costPrompt}</span>
              <Button size="sm" variant="primary" onClick={() => void run(true)}>
                Confirmar
              </Button>
            </div>
          ) : null}
          {error ? (
            <p role="alert" className="rounded-lg bg-danger-soft p-3 text-danger">
              {error}
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={close} disabled={busy}>
            {mode === "plan" ? "Fechar" : "Cancelar"}
          </Button>
          {mode && mode !== "plan" ? (
            <Button variant="primary" onClick={() => void run()} loading={busy} disabled={mode === "slide" && !slide}>
              <Sparkles />{" "}
              {mode === "slide" ? "Regenerar slide" : mode === "direction" ? "Trocar direção" : "Criar segunda versão"}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
