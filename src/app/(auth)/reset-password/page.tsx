import type { Metadata } from "next";
import Link from "next/link";
import { ResetForm } from "./reset-form";

export const metadata: Metadata = { title: "Nova senha" };

export default async function ResetPasswordPage({ searchParams }: PageProps<"/reset-password">) {
  const params = await searchParams;
  const token = typeof params.token === "string" ? params.token : null;
  if (!token || params.error) {
    return (
      <div className="grid gap-4">
        <h1 className="text-xl font-semibold tracking-tight">Link inválido ou expirado</h1>
        <p className="text-sm text-fg-muted">Peça um novo link de redefinição de senha.</p>
        <Link href="/forgot-password" className="text-sm font-medium text-accent-text hover:underline">
          Pedir novo link
        </Link>
      </div>
    );
  }
  return <ResetForm token={token} />;
}
