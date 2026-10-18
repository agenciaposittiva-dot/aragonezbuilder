import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { essentialConfigPresent } from "@/server/config-ready";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Entrar" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  if (!essentialConfigPresent()) redirect("/setup");
  const { getSession } = await import("@/server/auth/session");
  const session = await getSession();
  const params = await searchParams;
  const next =
    typeof params.next === "string" && params.next.startsWith("/") && !params.next.startsWith("//") ? params.next : "/";
  if (session) redirect(next);
  return <LoginForm next={next} reset={params.reset === "1"} />;
}
