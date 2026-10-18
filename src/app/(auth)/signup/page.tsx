import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { essentialConfigPresent } from "@/server/config-ready";
import { SignupForm } from "./signup-form";

export const metadata: Metadata = { title: "Criar conta" };

export default async function SignupPage() {
  if (!essentialConfigPresent()) redirect("/setup");
  const { getSession } = await import("@/server/auth/session");
  if (await getSession()) redirect("/onboarding");
  return <SignupForm />;
}
