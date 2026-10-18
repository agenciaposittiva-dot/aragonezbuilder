"use client";

import { Plus, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect } from "@/components/ui/input";
import { contrastRatio, SAFE_URL_RE } from "@/lib/portal-settings";
import { cn } from "@/lib/utils";

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/** Cor da marca: seletor nativo + hexadecimal; vazio = padrão da agência. */
export function ColorField({
  id,
  label,
  hint,
  value,
  fallback,
  onChange,
  error,
}: {
  id: string;
  label: string;
  hint?: string;
  value: string | null;
  /** Cor mostrada quando não há valor (padrão da agência). */
  fallback: string;
  onChange: (v: string | null) => void;
  error?: string | string[];
}) {
  const [text, setText] = useState(value ?? "");
  const [last, setLast] = useState(value);
  if (value !== last) {
    setLast(value);
    setText(value ?? "");
  }
  const invalid = text !== "" && !HEX_RE.test(text);
  return (
    <Field
      label={label}
      htmlFor={id}
      hint={value ? hint : `Padrão da agência${hint ? ` · ${hint}` : ""}`}
      error={invalid ? "Use o formato #RRGGBB" : error}
    >
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label}: seletor`}
          value={value ?? fallback}
          onChange={(e) => onChange(e.target.value.toLowerCase())}
          className="size-9 shrink-0 cursor-pointer rounded-md border border-border bg-surface p-0.5 disabled:cursor-not-allowed"
        />
        <Input
          id={id}
          value={text}
          placeholder={fallback}
          maxLength={7}
          onChange={(e) => {
            const v = e.target.value.trim();
            setText(v);
            if (v === "") onChange(null);
            else if (HEX_RE.test(v)) onChange(v.toLowerCase());
          }}
          className="font-mono uppercase"
        />
        {value ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`${label}: usar o padrão da agência`}
            title="Usar o padrão da agência"
            onClick={() => onChange(null)}
          >
            <RotateCcw />
          </Button>
        ) : null}
      </div>
    </Field>
  );
}

/** Indicador de contraste entre texto e fundo (mínimo 4,5:1, WCAG AA). */
export function ContrastMeter({ text, background }: { text: string; background: string }) {
  const ratio = contrastRatio(text, background);
  const ok = ratio >= 4.5;
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg border px-3 py-2 text-sm",
        ok ? "border-success/30 bg-success-soft" : "border-danger/30 bg-danger-soft",
      )}
      role="status"
    >
      <span
        aria-hidden="true"
        className="inline-flex h-8 w-12 items-center justify-center rounded-md border border-border text-sm font-semibold"
        style={{ background, color: text }}
      >
        Aa
      </span>
      <span className={ok ? "text-success" : "text-danger"}>
        Contraste {ratio.toFixed(1).replace(".", ",")}:1 ·{" "}
        {ok
          ? ratio >= 7
            ? "excelente (AAA)"
            : "legível (AA)"
          : "abaixo do mínimo de 4,5:1 — ajuste as cores para poder salvar"}
      </span>
    </div>
  );
}

export type LinkItem = { label: string; url: string; style?: "primary" | "secondary" };

export function linkUrlError(url: string) {
  if (!url.trim()) return "Informe o link";
  return SAFE_URL_RE.test(url.trim())
    ? null
    : "Use https://, mailto:, tel: ou um caminho do portal (ex.: /requests/new)";
}

/** Lista editável de links (links úteis ou botões de ação). */
export function LinkListEditor({
  idPrefix,
  items,
  max,
  withStyle,
  onChange,
  errors,
  addLabel,
}: {
  idPrefix: string;
  items: LinkItem[];
  max: number;
  withStyle?: boolean;
  onChange: (items: LinkItem[]) => void;
  errors: Record<string, string[]>;
  addLabel: string;
}) {
  const update = (i: number, patch: Partial<LinkItem>) =>
    onChange(items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  return (
    <div className="grid gap-3">
      {items.length === 0 ? <p className="text-sm text-fg-muted">Nenhum item.</p> : null}
      {items.map((it, i) => {
        const urlErr = errors[`${idPrefix}.${i}.url`] ?? (it.url ? linkUrlError(it.url) : null) ?? undefined;
        return (
          <div
            key={i}
            className={cn(
              "grid gap-2 rounded-lg border border-border p-3",
              withStyle ? "sm:grid-cols-[1fr_1.4fr_auto_auto]" : "sm:grid-cols-[1fr_1.6fr_auto]",
            )}
          >
            <Field label="Texto" htmlFor={`${idPrefix}-${i}-label`} error={errors[`${idPrefix}.${i}.label`]}>
              <Input
                id={`${idPrefix}-${i}-label`}
                value={it.label}
                maxLength={60}
                onChange={(e) => update(i, { label: e.target.value })}
              />
            </Field>
            <Field label="Link" htmlFor={`${idPrefix}-${i}-url`} error={urlErr}>
              <Input
                id={`${idPrefix}-${i}-url`}
                value={it.url}
                maxLength={500}
                placeholder="https://… ou /requests/new"
                onChange={(e) => update(i, { url: e.target.value })}
              />
            </Field>
            {withStyle ? (
              <Field label="Estilo" htmlFor={`${idPrefix}-${i}-style`}>
                <NativeSelect
                  id={`${idPrefix}-${i}-style`}
                  value={it.style ?? "primary"}
                  onChange={(e) => update(i, { style: e.target.value as "primary" | "secondary" })}
                >
                  <option value="primary">Primário</option>
                  <option value="secondary">Secundário</option>
                </NativeSelect>
              </Field>
            ) : null}
            <div className="flex items-end">
              <Button
                type="button"
                variant="danger-ghost"
                size="icon"
                aria-label="Remover"
                onClick={() => onChange(items.filter((_, idx) => idx !== i))}
              >
                <Trash2 />
              </Button>
            </div>
          </div>
        );
      })}
      {items.length < max ? (
        <div>
          <Button
            type="button"
            size="sm"
            onClick={() =>
              onChange([...items, withStyle ? { label: "", url: "", style: "primary" } : { label: "", url: "" }])
            }
          >
            <Plus /> {addLabel}
          </Button>
        </div>
      ) : (
        <p className="text-xs text-fg-subtle">Limite de {max} itens atingido.</p>
      )}
    </div>
  );
}

/**
 * Renderiza o conteúdo numa tela virtual (largura × altura) e reduz a escala
 * para caber no contêiner, sem deformar: a prévia mostra a composição real.
 */
export function ScaledFrame({
  width,
  height,
  maxHeight,
  className,
  children,
}: {
  width: number;
  height: number;
  /** Altura máxima disponível (px) para a prévia. */
  maxHeight?: number;
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setAvailable(entry?.contentRect.width ?? 0));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const byWidth = available ? available / width : 0;
  const byHeight = maxHeight ? maxHeight / height : Infinity;
  const scale = Math.min(1, byWidth, byHeight);
  return (
    <div ref={ref} className={cn("w-full", className)}>
      {scale > 0 ? (
        <div
          className="mx-auto overflow-hidden rounded-xl border border-border bg-bg shadow-sm"
          style={{ width: width * scale, height: height * scale }}
        >
          <div style={{ width, height, transform: `scale(${scale})`, transformOrigin: "top left" }}>{children}</div>
        </div>
      ) : (
        <div className="h-40 animate-pulse rounded-xl bg-surface-2" />
      )}
    </div>
  );
}
