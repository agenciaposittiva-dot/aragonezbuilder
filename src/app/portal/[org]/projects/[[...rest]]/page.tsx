import { redirect } from "next/navigation";

/** Endereço antigo da área do cliente: encaminha para o portal do cliente certo. */
export default async function LegacyPortalRedirect({ params }: PageProps<"/portal/[org]/projects/[[...rest]]">) {
  const { org, rest = [] } = await params;
  redirect(`/portal/${org}/ir/projects${rest.length ? `/${rest.join("/")}` : ""}`);
}
