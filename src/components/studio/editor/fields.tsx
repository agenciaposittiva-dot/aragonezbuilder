"use client";

import { useEffect, useId, useRef, useState } from "react";
import { fieldBase } from "@/components/ui/input";
import type { Gradient, Paint } from "@/lib/design-doc";
import { cn } from "@/lib/utils";

/*
 * Campos do painel de propriedades. Números são confirmados ao sair do campo,
 * com Enter ou com as setas (↑/↓, Shift = ×10) — nada de uma operação por tecla.
 */

export function Section({
  title,
  children,
  actions,
}: {
  title: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <section className="grid gap-2.5 border-b border-border px-4 py-3.5 last:border-b-0">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-semibold tracking-wide text-fg-subtle uppercase">{title}</h3>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function NumberField({
  label,
  value,
  onCommit,
  min,
  max,
  step = 1,
  suffix,
  className,
  ariaLabel,
}: {
  label: string;
  value: number | null;
  onCommit: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  className?: string;
  ariaLabel?: string;
}) {
  const id = useId();
  const shown = value === null || !Number.isFinite(value) ? "" : String(Math.round(value * 100) / 100);
  const [text, setText] = useState(shown);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(shown);
  }, [shown]);
  const clamp = (n: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
  const commit = (raw: string) => {
    const n = Number(raw.replace(",", "."));
    if (raw.trim() === "" || !Number.isFinite(n)) return setText(shown);
    const v = clamp(n);
    setText(String(Math.round(v * 100) / 100));
    if (value === null || Math.abs(v - value) > 1e-9) onCommit(v);
  };
  return (
    <label htmlFor={id} className={cn("grid min-w-0 gap-1 text-[11px] text-fg-subtle", className)}>
      {label}
      <span className="relative">
        <input
          id={id}
          inputMode="decimal"
          aria-label={ariaLabel ?? label}
          value={text}
          onFocus={(e) => {
            focused.current = true;
            e.currentTarget.select();
          }}
          onBlur={(e) => {
            focused.current = false;
            commit(e.currentTarget.value);
          }}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              commit(e.currentTarget.value);
              e.currentTarget.blur();
            } else if (e.key === "Escape") {
              setText(shown);
              e.currentTarget.blur();
            } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
              e.preventDefault();
              const base = Number(text.replace(",", ".")) || 0;
              const next = clamp(base + (e.key === "ArrowUp" ? 1 : -1) * step * (e.shiftKey ? 10 : 1));
              setText(String(Math.round(next * 100) / 100));
              onCommit(next);
            }
          }}
          className={cn(fieldBase, "h-8 w-full min-w-0 px-2 text-sm tabular-nums", suffix && "pr-7")}
        />
        {suffix ? (
          <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-[11px] text-fg-subtle">
            {suffix}
          </span>
        ) : null}
      </span>
    </label>
  );
}

export function RangeField({
  label,
  value,
  min,
  max,
  step = 0.01,
  onChange,
  format = (v) => String(v),
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}) {
  return (
    <label className="grid gap-1 text-[11px] text-fg-subtle">
      <span className="flex justify-between">
        {label}
        <span className="tabular-nums">{format(value)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
        className="accent-[var(--accent)]"
      />
    </label>
  );
}

export function SelectField({
  label,
  value,
  onChange,
  options,
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  className?: string;
}) {
  const id = useId();
  return (
    <label htmlFor={id} className={cn("grid min-w-0 gap-1 text-[11px] text-fg-subtle", className)}>
      {label}
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(fieldBase, "h-8 w-full min-w-0 px-2 text-sm")}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function IconToggle({
  label,
  pressed,
  onClick,
  children,
  disabled,
}: {
  label: string;
  pressed?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-md border text-fg-muted transition-colors disabled:opacity-40 [&_svg]:size-4",
        pressed ? "border-accent bg-accent-soft text-fg" : "border-border bg-surface hover:bg-surface-2 hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}

const DEFAULT_SWATCHES = ["#121110", "#ffffff", "#F4BF2F", "#e5562a", "#2563eb", "#16a34a", "#9333ea", "#f1f0ec"];
const HEX = /^#[0-9a-f]{6}$/i;

function toHex(c: string) {
  if (HEX.test(c)) return c;
  if (/^#[0-9a-f]{3}$/i.test(c))
    return `#${c
      .slice(1)
      .split("")
      .map((x) => x + x)
      .join("")}`;
  const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/i.exec(c);
  if (m) return `#${[m[1], m[2], m[3]].map((x) => Number(x).toString(16).padStart(2, "0")).join("")}`;
  return "#000000";
}

/** Cor sólida com amostras (cores da marca primeiro), seletor e campo hexadecimal. */
export function ColorField({
  label,
  value,
  onChange,
  swatches = [],
  allowNone,
}: {
  label: string;
  value: string | null;
  onChange: (v: string | null, live?: boolean) => void;
  swatches?: string[];
  allowNone?: boolean;
}) {
  const [text, setText] = useState(value ?? "");
  const [shownValue, setShownValue] = useState(value);
  if (shownValue !== value) {
    setShownValue(value);
    setText(value ?? "");
  }
  const all = [...new Set([...swatches, ...DEFAULT_SWATCHES])].slice(0, 14);
  return (
    <div className="grid gap-1.5 text-[11px] text-fg-subtle">
      <span>{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label}: escolher cor`}
          value={toHex(value ?? "#000000")}
          onChange={(e) => onChange(e.target.value, true)}
          className="size-8 shrink-0 cursor-pointer rounded-md border border-border bg-surface p-0.5"
        />
        <input
          aria-label={`${label}: código da cor`}
          value={text}
          placeholder={allowNone ? "nenhuma" : "#000000"}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            const v = text.trim();
            if (!v && allowNone) onChange(null);
            else if (/^(#[0-9a-f]{3,8}|rgba?\([^)]*\)|transparent)$/i.test(v)) onChange(v);
            else setText(value ?? "");
          }}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          className={cn(fieldBase, "h-8 w-full min-w-0 px-2 font-mono text-xs")}
        />
        {allowNone ? (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="shrink-0 rounded-md border border-border px-2 py-1 text-[11px] text-fg-muted hover:bg-surface-2"
          >
            Nenhuma
          </button>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-1">
        {all.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onChange(c)}
            className={cn(
              "size-5 rounded border border-border shadow-xs",
              value?.toLowerCase() === c.toLowerCase() && "ring-2 ring-accent",
            )}
            style={{ background: c }}
            aria-label={`Usar a cor ${c}`}
            title={c}
          />
        ))}
      </div>
    </div>
  );
}

/** Preenchimento: cor sólida ou degradê linear/radial (duas cores). */
export function PaintField({
  label,
  value,
  onChange,
  swatches,
  allowNone,
}: {
  label: string;
  value: Paint | null;
  onChange: (v: Paint | null, live?: boolean) => void;
  swatches?: string[];
  allowNone?: boolean;
}) {
  const gradient = value && typeof value === "object" ? value : null;
  const solid = typeof value === "string" ? value : null;
  const setGradient = (g: Gradient, live?: boolean) => onChange(g, live);
  return (
    <div className="grid gap-2">
      <div className="flex gap-1 text-[11px]">
        {(["solid", "linear", "radial"] as const).map((k) => {
          const active = k === "solid" ? !gradient : gradient?.type === k;
          return (
            <button
              key={k}
              type="button"
              aria-pressed={active}
              onClick={() => {
                if (k === "solid") onChange(gradient ? gradient.stops[0]!.color : (solid ?? "#121110"));
                else
                  setGradient({
                    type: k,
                    angle: gradient?.angle ?? 90,
                    stops: gradient?.stops ?? [
                      { offset: 0, color: solid ?? "#F4BF2F" },
                      { offset: 1, color: "#e5562a" },
                    ],
                  });
              }}
              className={cn(
                "rounded-md border px-2 py-1",
                active ? "border-accent bg-accent-soft text-fg" : "border-border text-fg-muted hover:bg-surface-2",
              )}
            >
              {{ solid: "Sólido", linear: "Degradê", radial: "Radial" }[k]}
            </button>
          );
        })}
      </div>
      {gradient ? (
        <div className="grid gap-2">
          <div className="h-5 rounded border border-border" style={{ background: cssPaint(gradient) }} />
          <div className="grid grid-cols-2 gap-2">
            {gradient.stops.slice(0, 2).map((s, i) => (
              <ColorField
                key={i}
                label={i === 0 ? "Início" : "Fim"}
                value={s.color}
                swatches={swatches}
                onChange={(c, live) => {
                  if (!c) return;
                  const stops = gradient.stops.map((x, j) => (j === i ? { ...x, color: c } : x));
                  setGradient({ ...gradient, stops }, live);
                }}
              />
            ))}
          </div>
          {gradient.type === "linear" ? (
            <RangeField
              label="Direção"
              value={gradient.angle ?? 0}
              min={0}
              max={360}
              step={1}
              format={(v) => `${Math.round(v)}°`}
              onChange={(v) => setGradient({ ...gradient, angle: v }, true)}
            />
          ) : null}
        </div>
      ) : (
        <ColorField label={label} value={solid} onChange={onChange} swatches={swatches} allowNone={allowNone} />
      )}
    </div>
  );
}

export function cssPaint(p: Paint | null | undefined): string {
  if (!p) return "transparent";
  if (typeof p === "string") return p;
  const stops = p.stops.map((s) => `${s.color} ${Math.round(s.offset * 100)}%`).join(", ");
  return p.type === "radial"
    ? `radial-gradient(circle, ${stops})`
    : `linear-gradient(${(p.angle ?? 0) + 90}deg, ${stops})`;
}
