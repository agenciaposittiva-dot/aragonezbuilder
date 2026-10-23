"use client";

import { ArrowRight, Layers, RectangleVertical, Sparkles } from "lucide-react";
import Link from "next/link";
import { NewDesignDialog } from "./new-design-dialog";

type DialogData = Pick<
  React.ComponentProps<typeof NewDesignDialog>,
  "clients" | "projects" | "templates" | "canManageTemplates"
>;

/**
 * Entrada do Estúdio Criador: destaque "Criar posts com IA" (abre o gerador
 * real de carrosséis) e dois cartões de criação rápida que abrem o editor no
 * formato certo. Os cartões são botões de verdade (teclado, foco e hover).
 */
export function StudioHero({ base, canAi, dialog }: { base: string; canAi: boolean; dialog: DialogData }) {
  return (
    <section aria-label="Começar" className="grid gap-4" data-testid="studio-hero">
      {canAi ? (
        <Link
          href={`${base}/gerar`}
          className="group flex items-center gap-4 rounded-2xl border border-border bg-surface p-4 shadow-xs transition-colors hover:border-accent focus-visible:border-accent focus-visible:outline-none sm:p-5"
          data-testid="studio-ai-card"
        >
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-soft-fg">
            <Sparkles className="size-5" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-base font-semibold text-fg">Criar posts com IA</span>
            <span className="block text-sm text-fg-muted">
              Escolha o cliente, diga o tema, o objetivo e o estilo e receba um carrossel editável no estilo dele.
            </span>
          </span>
          <ArrowRight
            className="size-5 shrink-0 text-fg-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-fg"
            aria-hidden="true"
          />
        </Link>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <QuickCard
          dialog={dialog}
          preset="story"
          title="Novo vertical"
          subtitle="9:16 · Stories e Reels"
          description="Abre o editor em 1080 × 1920."
          icon={<RectangleVertical className="size-5" aria-hidden="true" />}
          testId="studio-new-vertical"
        />
        <QuickCard
          dialog={dialog}
          preset="ig-portrait"
          title="Novo post"
          subtitle="4:5 · post ou carrossel"
          description="Abre o editor em 1080 × 1350; escolha a quantidade de slides se for carrossel."
          icon={<Layers className="size-5" aria-hidden="true" />}
          testId="studio-new-post"
        />
      </div>
    </section>
  );
}

function QuickCard({
  dialog,
  preset,
  title,
  subtitle,
  description,
  icon,
  testId,
}: {
  dialog: DialogData;
  preset: string;
  title: string;
  subtitle: string;
  description: string;
  icon: React.ReactNode;
  testId: string;
}) {
  return (
    <NewDesignDialog
      {...dialog}
      defaultPreset={preset}
      title={title}
      description={`${subtitle}. Dê um nome, escolha o cliente e abra o editor já no formato certo.`}
      trigger={
        <button
          type="button"
          data-testid={testId}
          className="group flex min-h-28 flex-col items-start justify-between gap-4 rounded-2xl border border-border bg-surface p-4 text-left shadow-xs transition-colors hover:border-border-strong hover:bg-surface-2/40 focus-visible:border-accent focus-visible:outline-none sm:p-5"
        >
          <span className="flex size-10 items-center justify-center rounded-lg border border-dashed border-border-strong text-fg-muted group-hover:border-accent group-hover:text-fg">
            {icon}
          </span>
          <span>
            <span className="block text-base font-semibold text-fg">{title}</span>
            <span className="block text-sm text-fg-muted">{subtitle}</span>
            <span className="mt-1 block text-xs text-fg-subtle">{description}</span>
          </span>
        </button>
      }
    />
  );
}
