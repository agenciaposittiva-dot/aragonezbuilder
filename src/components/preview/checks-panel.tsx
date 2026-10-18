"use client";

import { AlertCircle, AlertTriangle, CheckCircle2, Lightbulb, PenLine } from "lucide-react";
import Link from "next/link";
import { CHECK_LEVEL_LABEL, type CheckIssue, type CheckLevel } from "@/lib/preview-check";
import { cn } from "@/lib/utils";

const ICON: Record<CheckLevel, typeof AlertCircle> = {
  error: AlertCircle,
  warning: AlertTriangle,
  suggestion: Lightbulb,
};

const CAPTION_CODES = /^(caption_|hashtags_|cta_)/;

const TONE: Record<CheckLevel, string> = {
  error: "text-danger",
  warning: "text-warning",
  suggestion: "text-info",
};

/**
 * Resultado do verificador, separado em erros, avisos e sugestões. Cada item
 * leva para a página na prévia e, quando a camada é conhecida, para o editor
 * já com ela selecionada.
 */
export function ChecksPanel({
  issues,
  onShow,
  editHref,
  onEditCaption,
  networkLabel,
}: {
  issues: CheckIssue[];
  onShow: (issue: CheckIssue) => void;
  editHref: (issue: CheckIssue) => string | null;
  /** Problemas da legenda abrem a aba de legenda da própria prévia. */
  onEditCaption?: () => void;
  networkLabel: string;
}) {
  const groups = (["error", "warning", "suggestion"] as const).map((level) => ({
    level,
    list: issues.filter((i) => i.level === level),
  }));
  return (
    <div className="grid gap-4" data-testid="preview-checks">
      <div className="flex flex-wrap gap-2 text-xs" aria-live="polite">
        {groups.map(({ level, list }) => {
          const Icon = ICON[level];
          return (
            <span
              key={level}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-2 px-2 py-1"
              data-testid={`checks-count-${level}`}
            >
              <Icon className={cn("size-3.5", TONE[level])} aria-hidden />
              {CHECK_LEVEL_LABEL[level]}: {list.length}
            </span>
          );
        })}
      </div>
      {!issues.length ? (
        <p className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-3 text-sm">
          <CheckCircle2 className="size-4 text-success" aria-hidden /> Nenhum problema encontrado pela verificação da
          plataforma.
        </p>
      ) : null}
      {groups.map(({ level, list }) =>
        list.length ? (
          <section key={level} className="grid gap-1.5" aria-label={CHECK_LEVEL_LABEL[level]}>
            <h3 className={cn("text-xs font-semibold", TONE[level])}>{CHECK_LEVEL_LABEL[level]}</h3>
            <ul className="grid gap-1.5">
              {list.map((issue, i) => {
                const Icon = ICON[level];
                const href = editHref(issue);
                const captionFix = onEditCaption && CAPTION_CODES.test(issue.code);
                return (
                  <li
                    key={`${issue.code}-${issue.slideKey ?? ""}-${issue.objectId ?? ""}-${i}`}
                    className="grid gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-[13px]"
                    data-code={issue.code}
                  >
                    <p className="flex gap-2">
                      <Icon className={cn("mt-0.5 size-4 shrink-0", TONE[level])} aria-hidden />
                      <span>{issue.message}</span>
                    </p>
                    {issue.slideKey || href || captionFix ? (
                      <div className="flex flex-wrap gap-3 pl-6 text-xs">
                        {issue.slideKey ? (
                          <button
                            type="button"
                            className="text-fg-muted hover:text-fg hover:underline focus-visible:underline focus-visible:outline-none"
                            onClick={() => onShow(issue)}
                          >
                            Mostrar na prévia
                          </button>
                        ) : null}
                        {captionFix ? (
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 font-medium text-accent-text hover:underline"
                            onClick={onEditCaption}
                          >
                            <PenLine className="size-3" aria-hidden /> Editar legenda
                          </button>
                        ) : null}
                        {href ? (
                          <Link
                            href={href}
                            className="inline-flex items-center gap-1 font-medium text-accent-text hover:underline"
                          >
                            <PenLine className="size-3" aria-hidden /> Corrigir no editor
                          </Link>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null,
      )}
      <p className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-fg-muted">
        Esta é a verificação interna da plataforma, com medidas de referência{" "}
        {networkLabel ? `para ${networkLabel}` : ""}. Passar por ela não significa aprovação da rede social: as regras
        oficiais podem mudar e ser aplicadas só na hora de publicar.
      </p>
    </div>
  );
}
