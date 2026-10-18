import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { formatDate } from "@/lib/format";
import { agencyCreationAccess } from "@/server/access-key";
import { requireSession } from "@/server/auth/session";
import { listUserOrganizations } from "@/server/authz/actor";
import { env } from "@/server/env";
import { INVITE_ONLY_MESSAGE } from "@/lib/invite-only";
import { listTrashedOrganizations } from "@/server/services/trash";
import { OnboardingForm } from "./onboarding-form";
import { TrashedOrganizations } from "./trashed-organizations";

export const metadata: Metadata = { title: "Criar agência" };

export default async function OnboardingPage({ searchParams }: PageProps<"/onboarding">) {
  const session = await requireSession();
  const sp = await searchParams;
  const [trashed, active, access] = await Promise.all([
    listTrashedOrganizations(session.user.id),
    listUserOrganizations(session.user.id),
    agencyCreationAccess(session.user.id, session.user.email),
  ]);
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-8 px-4 py-10">
      <Logo />
      {sp.excluida ? (
        <p role="status" className="rounded-lg bg-surface-2 px-3 py-2 text-sm">
          A agência foi para a lixeira. Você pode restaurá-la abaixo nos próximos 30 dias.
        </p>
      ) : null}
      <TrashedOrganizations
        items={trashed.map((o) => ({
          id: o.id,
          name: o.name,
          purgeLabel: formatDate(o.purgeAt),
          daysLeft: o.daysLeft,
        }))}
      />
      {active.length ? (
        <Link href="/" className="text-sm font-medium text-accent-text hover:underline">
          Ir para minhas agências ({active.length})
        </Link>
      ) : null}
      {access === "denied" ? (
        <div className="grid gap-2" data-testid="no-agency-access">
          {active.length ? (
            <>
              <h1 className="text-xl font-semibold tracking-tight">Criar agências é restrito</h1>
              <p className="text-sm text-fg-muted">
                Só quem administra uma agência pode criar outra. Se precisar, peça ao administrador da plataforma.
              </p>
            </>
          ) : (
            <>
              <h1 className="text-xl font-semibold tracking-tight">
                Olá, {session.user.name.split(" ")[0]}. Você ainda não tem acesso a uma agência.
              </h1>
              <p className="text-sm text-fg-muted">{INVITE_ONLY_MESSAGE}</p>
              <p className="text-sm text-fg-muted">
                Se você recebeu um convite, abra o link do e-mail com esta conta ({session.user.email}).
              </p>
            </>
          )}
        </div>
      ) : (
        <>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              Olá, {session.user.name.split(" ")[0]}. Vamos criar a sua agência.
            </h1>
            <p className="mt-1 text-sm text-fg-muted">
              Você será o proprietário. Depois, convide a equipe e os clientes.
            </p>
          </div>
          <OnboardingForm needsAccessKey={access === "key"} logoMaxBytes={env.LOGO_MAX_BYTES} />
        </>
      )}
    </main>
  );
}
