import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/server/auth/session";
import { SignupForm } from "./signup-form";

export const metadata: Metadata = { title: "Criar conta" };

export default async function SignupPage() {
  if (await getSession()) redirect("/onboarding");
  return <SignupForm />;
}
