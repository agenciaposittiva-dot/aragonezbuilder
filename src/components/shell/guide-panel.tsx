"use client";

import { ArrowLeft, ArrowRight, CheckCircle2, Circle, Compass, EyeOff, Lightbulb, RotateCcw } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { TOUR, tipsFor } from "@/lib/guide";
import { cn } from "@/lib/utils";
import { guideAction } from "@/server/actions/shell";
import type { GuideStep } from "@/server/services/guide";
import { useWorkspace } from "./workspace-context";

/*
 * Preferências do botão e do tour ficam no aparelho (são de quem está vendo,
 * não dados da agência). Os passos vêm sempre do servidor.
 */
const HIDDEN_KEY = "guide:hidden";
const TOUR_KEY = "guide:tour";
const VISIBILITY_EVENT = "guide-visibility";

function readPref(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writePref(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Sem armazenamento (aba anônima): a preferência vale só nesta página.
  }
}

/** Botão "Me guie" escondido pela pessoa (e como mostrar de novo). */
export function useGuideHidden(): [boolean, (hidden: boolean) => void] {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const sync = () => setHidden(readPref(HIDDEN_KEY) === "1");
    sync();
    window.addEventListener(VISIBILITY_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(VISIBILITY_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  const set = useCallback((value: boolean) => {
    writePref(HIDDEN_KEY, value ? "1" : null);
    setHidden(value);
    window.dispatchEvent(new Event(VISIBILITY_EVENT));
  }, []);
  return [hidden, set];
}

export function GuideButton({ base }: { base: string }) {
  const [hidden, setHidden] = useGuideHidden();
  const [open, setOpen] = useState(false);
  if (hidden) return null;
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)} aria-label="Me guie" data-testid="guide-button">
        <Compass /> <span className="hidden md:inline">Me guie</span>
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent width="sm" className="max-w-md">
          {open ? (
            <GuideContent
              base={base}
              onNavigate={() => setOpen(false)}
              onHide={() => {
                setOpen(false);
                setHidden(true);
              }}
            />
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  );
}

function GuideContent({ base, onNavigate, onHide }: { base: string; onNavigate: () => void; onHide: () => void }) {
  const { orgSlug, permissions } = useWorkspace();
  const pathname = usePathname();
  const [steps, setSteps] = useState<GuideStep[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const load = useCallback(() => {
    start(async () => {
      const res = await guideAction(orgSlug, {});
      if (res.ok) {
        setSteps(res.data);
        setError(null);
      } else setError(res.error);
    });
  }, [orgSlug]);
  useEffect(load, [load]);

  const relative = pathname.startsWith(base) ? pathname.slice(base.length) : pathname;
  const screen = tipsFor(relative);
  const done = steps?.filter((s) => s.done).length ?? 0;
  const total = steps?.length ?? 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-border px-5 pt-4 pr-12 pb-3">
        <SheetTitle className="flex items-center gap-2 text-base font-semibold">
          <Compass className="size-4 text-accent" aria-hidden="true" /> Me guie
        </SheetTitle>
        <SheetDescription className="mt-0.5 text-sm text-fg-muted">
          Primeiros passos da agência, dicas desta tela e um tour rápido.
        </SheetDescription>
      </div>
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-4">
        <section aria-labelledby="guide-steps">
          <div className="flex items-baseline justify-between gap-2">
            <h3 id="guide-steps" className="text-sm font-semibold">
              Primeiros passos
            </h3>
            {steps ? (
              <span className="text-xs text-fg-muted" data-testid="guide-progress">
                {done} de {total} concluídos
              </span>
            ) : null}
          </div>
          {steps && total ? (
            <div
              className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2"
              role="progressbar"
              aria-label="Progresso dos primeiros passos"
              aria-valuemin={0}
              aria-valuemax={total}
              aria-valuenow={done}
            >
              <div
                className="h-full rounded-full bg-accent transition-all"
                style={{ width: `${(done / total) * 100}%` }}
              />
            </div>
          ) : null}
          {error ? (
            <p className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
              Não foi possível carregar os passos: {error}{" "}
              <button type="button" className="font-medium underline" onClick={load}>
                Tentar de novo
              </button>
            </p>
          ) : !steps ? (
            <p className="mt-3 text-sm text-fg-muted">{pending ? "Carregando…" : ""}</p>
          ) : !total ? (
            <p className="mt-3 text-sm text-fg-muted">Nenhum passo de configuração depende de você.</p>
          ) : (
            <ol className="mt-3 space-y-2" data-testid="guide-steps">
              {steps.map((s) => (
                <li
                  key={s.key}
                  data-step={s.key}
                  data-done={s.done ? "true" : "false"}
                  className="flex items-start gap-2.5 rounded-lg border border-border p-3"
                >
                  {s.done ? (
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-label="Concluído" />
                  ) : (
                    <Circle className="mt-0.5 size-4 shrink-0 text-fg-subtle" aria-label="Pendente" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className={cn("text-sm font-medium", s.done && "text-fg-muted")}>{s.title}</p>
                    {!s.done ? <p className="mt-0.5 text-xs text-fg-muted">{s.description}</p> : null}
                  </div>
                  {!s.done ? (
                    <Button asChild variant="secondary" size="xs" className="shrink-0">
                      <Link href={`${base}${s.path}`} onClick={onNavigate}>
                        Ir agora
                      </Link>
                    </Button>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
          {steps && total > 0 && done === total ? (
            <p className="mt-3 text-sm text-success">Tudo pronto — a agência está configurada.</p>
          ) : null}
        </section>

        {screen ? (
          <section aria-labelledby="guide-screen" data-testid="guide-screen">
            <h3 id="guide-screen" className="flex items-center gap-1.5 text-sm font-semibold">
              <Lightbulb className="size-4 text-warning" aria-hidden="true" /> Nesta tela: {screen.title}
            </h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-fg-muted">
              {screen.tips.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </section>
        ) : null}

        <QuickTour base={base} permissions={permissions} onNavigate={onNavigate} />
      </div>
      <div className="border-t border-border px-5 py-3">
        <Button variant="ghost" size="sm" onClick={onHide}>
          <EyeOff /> Esconder o botão
        </Button>
        <p className="mt-1 text-xs text-fg-subtle">Para mostrar de novo, use o menu do seu perfil.</p>
      </div>
    </div>
  );
}

function QuickTour({
  base,
  permissions,
  onNavigate,
}: {
  base: string;
  permissions: readonly string[];
  onNavigate: () => void;
}) {
  const stops = TOUR.filter((t) => !t.permission || permissions.includes(t.permission));
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const saved = Number(readPref(TOUR_KEY));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- preferência só existe no navegador
    if (Number.isInteger(saved) && saved >= 0) setIndex(saved);
  }, []);
  const go = (i: number) => {
    setIndex(i);
    writePref(TOUR_KEY, String(i));
  };
  if (!stops.length) return null;
  const finished = index >= stops.length;
  const stop = stops[Math.min(index, stops.length - 1)]!;
  return (
    <section aria-labelledby="guide-tour" data-testid="guide-tour">
      <div className="flex items-baseline justify-between gap-2">
        <h3 id="guide-tour" className="text-sm font-semibold">
          Tour rápido
        </h3>
        {!finished ? (
          <span className="text-xs text-fg-muted">
            {index + 1} de {stops.length}
          </span>
        ) : null}
      </div>
      {finished ? (
        <div className="mt-2 rounded-lg border border-border p-3">
          <p className="text-sm">Tour concluído. Você conheceu as áreas principais.</p>
          <Button variant="secondary" size="sm" className="mt-2" onClick={() => go(0)}>
            <RotateCcw /> Refazer o tour
          </Button>
        </div>
      ) : (
        <div className="mt-2 rounded-lg border border-border p-3" data-tour-stop={index}>
          <p className="text-sm font-medium">{stop.title}</p>
          <p className="mt-0.5 text-sm text-fg-muted">{stop.text}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => go(index - 1)} disabled={index === 0}>
              <ArrowLeft /> Anterior
            </Button>
            <Button variant="secondary" size="sm" onClick={() => go(index + 1)}>
              {index === stops.length - 1 ? "Concluir" : "Próximo"} <ArrowRight />
            </Button>
            <Button asChild variant="ghost" size="sm" className="ml-auto">
              <Link href={`${base}${stop.path}`} onClick={onNavigate}>
                Ir agora
              </Link>
            </Button>
          </div>
          {index > 0 ? (
            <button type="button" className="mt-2 text-xs text-fg-muted underline" onClick={() => go(0)}>
              Refazer o tour
            </button>
          ) : null}
        </div>
      )}
    </section>
  );
}
