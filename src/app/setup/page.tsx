import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Logo } from "@/components/brand/logo";
import { cn } from "@/lib/utils";
import { runSetupChecks, type CheckStatus } from "@/server/setup-check";

export const metadata: Metadata = { title: "Diagnóstico da instalação", robots: { index: false } };

const ICON: Record<CheckStatus, typeof CheckCircle2> = { ok: CheckCircle2, warn: AlertTriangle, error: XCircle };
const TONE: Record<CheckStatus, string> = { ok: "text-success", warn: "text-warning", error: "text-danger" };

/**
 * Mostra o que falta configurar (variáveis, banco, migrações) sem expor
 * valores. Útil logo após o primeiro deploy, quando o site ainda não abre.
 */
export default async function SetupPage() {
  await connection();
  const { checks, ready } = await runSetupChecks();
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-6 px-4 py-10">
      <Logo />
      <div>
        <h1 className="text-xl font-semibold tracking-tight">
          {ready ? "Instalação pronta" : "Falta configurar a instalação"}
        </h1>
        <p className="mt-1 text-sm text-fg-muted">
          {ready
            ? "O essencial está configurado. Itens em amarelo são opcionais."
            : "Corrija os itens em vermelho nas variáveis de ambiente da hospedagem e faça um novo deploy."}
        </p>
      </div>
      <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
        {checks.map((c) => {
          const Icon = ICON[c.status];
          return (
            <li key={c.label} className="flex items-start gap-3 px-4 py-3">
              <Icon className={cn("mt-0.5 size-4 shrink-0", TONE[c.status])} aria-hidden />
              <div className="min-w-0">
                <p className="text-sm font-medium">{c.label}</p>
                <p className="text-sm text-fg-muted">{c.detail}</p>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="text-sm text-fg-muted">
        Passo a passo em <span className="font-mono text-xs">docs/DEPLOY.md</span> no repositório.
        {ready ? (
          <>
            {" "}
            <Link href="/login" className="font-medium text-accent-text hover:underline">
              Ir para o login
            </Link>
          </>
        ) : null}
      </p>
    </main>
  );
}
