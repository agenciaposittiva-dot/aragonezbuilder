import Link from "next/link";
import { LogoMark } from "@/components/brand/logo";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-5 px-4 text-center">
      <LogoMark className="size-10" />
      <div>
        <p className="text-sm font-medium text-accent-text">404</p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">Página não encontrada</h1>
        <p className="mt-2 text-sm text-fg-muted">
          O endereço pode estar errado, o registro foi arquivado ou você não tem acesso a ele.
        </p>
      </div>
      <Link
        href="/"
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-fg hover:bg-primary-hover"
      >
        Ir para o início
      </Link>
    </main>
  );
}
