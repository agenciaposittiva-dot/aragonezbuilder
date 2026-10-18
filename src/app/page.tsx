import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { LogoMark } from "@/components/brand/logo";
import { Avatar } from "@/components/ui/avatar";
import { essentialConfigPresent } from "@/server/config-ready";

function homeOf(org: { slug: string; kind: string }) {
  return org.kind === "client" ? `/portal/${org.slug}` : `/w/${org.slug}`;
}

/** Entrada: leva o usuário à última organização usada ou mostra o seletor. */
export default async function Home() {
  // Instalação sem banco ou segredo: mostra o que falta em vez de um erro.
  // Sempre dinâmica: a configuração é lida na requisição, não no build.
  await connection();
  if (!essentialConfigPresent()) redirect("/setup");
  const [{ requireSession }, { listUserOrganizations }] = await Promise.all([
    import("@/server/auth/session"),
    import("@/server/authz/actor"),
  ]);
  const session = await requireSession();
  const orgs = await listUserOrganizations(session.user.id);
  if (orgs.length === 0) redirect("/onboarding");
  const last = (await cookies()).get("last_org")?.value;
  const preferred = orgs.find((o) => o.slug === last) ?? (orgs.length === 1 ? orgs[0] : undefined);
  if (preferred) redirect(homeOf(preferred));

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-4">
      <LogoMark className="size-9" />
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Escolha a organização</h1>
        <p className="mt-1 text-sm text-fg-muted">Você tem acesso a mais de uma agência.</p>
      </div>
      <ul className="grid gap-2">
        {orgs.map((o) => (
          <li key={o.id}>
            <Link
              href={homeOf(o)}
              className="flex items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3 transition-colors hover:bg-surface-2"
            >
              <Avatar name={o.name} src={o.logoUrl} square />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{o.name}</span>
                <span className="block text-xs text-fg-muted">{o.roleName}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <Link href="/onboarding" className="text-sm text-fg-muted hover:text-fg">
        + Criar outra agência
      </Link>
    </main>
  );
}
