import Link from "next/link";
import { Logo } from "@/components/brand/logo";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_minmax(0,560px)]">
      <aside className="relative hidden overflow-hidden bg-sidebar text-sidebar-fg lg:flex lg:flex-col lg:justify-between lg:p-10">
        <Link href="/" aria-label="Início">
          <Logo tone="inverse" />
        </Link>
        <div className="relative z-10 max-w-md">
          <p className="text-2xl leading-snug font-semibold tracking-tight text-sidebar-fg">
            Da solicitação à entrega aprovada, com cada etapa registrada.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-sidebar-muted">
            Clientes, briefings, produção, aprovações por versão, arquivos, IA e financeiro no mesmo lugar, com acesso
            exclusivo para os seus clientes.
          </p>
        </div>
        <ul className="relative z-10 grid gap-2 text-sm text-sidebar-muted">
          {[
            "Aprovação vinculada a cada versão do arquivo",
            "Dados isolados por agência e por cliente",
            "Rentabilidade por projeto a partir das horas registradas",
          ].map((t) => (
            <li key={t} className="flex items-center gap-2">
              <span className="size-1.5 rounded-full bg-accent" aria-hidden="true" />
              {t}
            </li>
          ))}
        </ul>
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-24 -bottom-24 size-96 rounded-full border border-sidebar-border"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-8 -bottom-8 size-64 rounded-full border border-accent/25"
        />
      </aside>
      <main className="flex flex-col px-4 py-8 sm:px-10">
        <div className="lg:hidden">
          <Logo />
        </div>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">{children}</div>
      </main>
    </div>
  );
}
