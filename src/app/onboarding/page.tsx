import type { Metadata } from "next";
import { Logo } from "@/components/brand/logo";
import { accessKeyRequired } from "@/server/access-key";
import { requireSession } from "@/server/auth/session";
import { OnboardingForm } from "./onboarding-form";

export const metadata: Metadata = { title: "Criar agência" };

export default async function OnboardingPage() {
  const session = await requireSession();
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-8 px-4 py-10">
      <Logo />
      <div>
        <h1 className="text-xl font-semibold tracking-tight">
          Olá, {session.user.name.split(" ")[0]}. Vamos criar a sua agência.
        </h1>
        <p className="mt-1 text-sm text-fg-muted">Você será o proprietário. Depois, convide a equipe e os clientes.</p>
      </div>
      <OnboardingForm needsAccessKey={accessKeyRequired(session.user.email)} />
    </main>
  );
}
